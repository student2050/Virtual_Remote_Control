/**
 * Agent API Routes
 * Used by the LOCAL agent running on the user's Mac
 * Auth: API Key (x-api-key header)
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/schema');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

// All agent routes require API key
router.use(requireApiKey);

// ─── Post Message (agent → mobile) ───────────────────────────────────────────

router.post('/message', (req, res) => {
    const { content, messageType = 'text', metadata = {} } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

    const workspaceId = req.workspaceId;
    const message = {
        id: uuidv4(),
        workspace_id: workspaceId,
        content: content.trim(),
        role: 'agent',
        message_type: messageType,
        metadata: JSON.stringify(metadata),
        created_at: new Date().toISOString()
    };

    db.prepare(`
    INSERT INTO messages (id, workspace_id, content, role, message_type, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(message.id, message.workspace_id, message.content, message.role, message.message_type, message.metadata, message.created_at);

    // Broadcast to mobile
    const { getIO } = require('../socket');
    const io = getIO();
    if (io) {
        io.to(`workspace:${workspaceId}`).emit('new_message', message);
    }

    res.status(201).json({ message });
});

// ─── Create Approval Request (agent → mobile for permission) ─────────────────

router.post('/approval', (req, res) => {
    const { title, description, command, riskLevel = 'low', expiresInMinutes = 10, metadata = {} } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });

    const workspaceId = req.workspaceId;
    const approvalId = uuidv4();

    db.prepare(`
    INSERT INTO approvals (id, workspace_id, title, description, command, risk_level, expires_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?), ?)
  `).run(
        approvalId, workspaceId, title, description || '', command || '',
        riskLevel, `+${expiresInMinutes} minutes`,
        JSON.stringify(metadata)
    );

    const approval = db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId);

    // Push to mobile via socket
    const { getIO } = require('../socket');
    const io = getIO();
    if (io) {
        io.to(`workspace:${workspaceId}`).emit('approval_request', approval);
    }

    // Also send as a system message so it appears in chat
    const sysMessage = {
        id: uuidv4(),
        workspace_id: workspaceId,
        content: `🔐 **Permission Required**: ${title}\n${description || ''}\n\nRisk: ${riskLevel.toUpperCase()}`,
        role: 'system',
        message_type: 'approval',
        metadata: JSON.stringify({ approvalId }),
        created_at: new Date().toISOString()
    };
    db.prepare(`
    INSERT INTO messages (id, workspace_id, content, role, message_type, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sysMessage.id, sysMessage.workspace_id, sysMessage.content, sysMessage.role, sysMessage.message_type, sysMessage.metadata, sysMessage.created_at);

    if (io) io.to(`workspace:${workspaceId}`).emit('new_message', sysMessage);

    res.status(201).json({ approval });
});

// ─── Poll Approval Status (agent polls until resolved) ───────────────────────

router.get('/approval/:approvalId', (req, res) => {
    const approval = db.prepare(`
    SELECT * FROM approvals WHERE id = ? AND workspace_id = ?
  `).get(req.params.approvalId, req.workspaceId);

    if (!approval) return res.status(404).json({ error: 'Approval not found' });

    // Auto-expire
    if (approval.status === 'pending' && new Date(approval.expires_at) < new Date()) {
        db.prepare("UPDATE approvals SET status = 'expired' WHERE id = ?").run(req.params.approvalId);
        approval.status = 'expired';
    }

    res.json({ approval });
});

// ─── Log Activity ─────────────────────────────────────────────────────────────

router.post('/activity', (req, res) => {
    const { title, description, icon = '📌', type = 'info', metadata = {} } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });

    const workspaceId = req.workspaceId;
    const activityId = uuidv4();

    db.prepare(`
    INSERT INTO activity (id, workspace_id, title, description, icon, type, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(activityId, workspaceId, title, description || '', icon, type, JSON.stringify(metadata));

    const activity = db.prepare('SELECT * FROM activity WHERE id = ?').get(activityId);

    const { getIO } = require('../socket');
    const io = getIO();
    if (io) io.to(`workspace:${workspaceId}`).emit('new_activity', activity);

    res.status(201).json({ activity });
});

// ─── Update Stats ─────────────────────────────────────────────────────────────

router.post('/stats', (req, res) => {
    const workspaceId = req.workspaceId;
    const { getIO } = require('../socket');
    const io = getIO();
    if (io) io.to(`workspace:${workspaceId}`).emit('stats_update', req.body);
    res.json({ success: true });
});

// ─── Agent Ping / Heartbeat ───────────────────────────────────────────────────

router.post('/ping', (req, res) => {
    const { hostname, platform, agentVersion } = req.body;
    const workspaceId = req.workspaceId;

    db.prepare(`
    UPDATE agent_sessions 
    SET last_ping_at = datetime('now'), is_online = 1, hostname = ?, platform = ?, agent_version = ?
    WHERE workspace_id = ? AND api_key_id = ?
  `).run(hostname || '', platform || '', agentVersion || '', workspaceId, req.apiKey.id);

    // Notify mobile of agent status
    const { getIO } = require('../socket');
    const io = getIO();
    if (io) io.to(`workspace:${workspaceId}`).emit('agent_status', { online: true, hostname, platform });

    res.json({ success: true, timestamp: new Date().toISOString() });
});

// ─── Get Pending User Messages (agent polls for new messages) ─────────────────

router.get('/inbox', (req, res) => {
    const workspaceId = req.workspaceId;
    const { since } = req.query;

    let query = "SELECT * FROM messages WHERE workspace_id = ? AND role = 'user'";
    const params = [workspaceId];

    if (since) {
        query += ' AND created_at > ?';
        params.push(since);
    }

    query += ' ORDER BY created_at ASC';
    const messages = db.prepare(query).all(...params);

    res.json({ messages });
});

module.exports = router;
