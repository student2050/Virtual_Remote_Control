const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/schema');
const { requireAuth, requireWorkspace } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

// All routes require auth + workspace
router.use(requireAuth, requireWorkspace);

// ─── Get Messages ────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
    const { limit = 50, before } = req.query;
    const workspaceId = req.params.workspaceId;

    let query = 'SELECT * FROM messages WHERE workspace_id = ?';
    const params = [workspaceId];

    if (before) {
        query += ' AND created_at < ?';
        params.push(before);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const messages = db.prepare(query).all(...params).reverse();
    const total = db.prepare('SELECT COUNT(*) as c FROM messages WHERE workspace_id = ?').get(workspaceId).c;
    const unread = db.prepare("SELECT COUNT(*) as c FROM messages WHERE workspace_id = ? AND read = 0 AND role != 'user'").get(workspaceId).c;

    // Mark as read
    db.prepare("UPDATE messages SET read = 1 WHERE workspace_id = ? AND role != 'user'").run(workspaceId);

    res.json({ messages, total, unread });
});

// ─── Send Message (from mobile user) ─────────────────────────────────────────

router.post('/', (req, res) => {
    const { content, messageType = 'text' } = req.body;
    const workspaceId = req.params.workspaceId;

    if (!content?.trim()) return res.status(400).json({ error: 'Message content required' });

    const message = {
        id: uuidv4(),
        workspace_id: workspaceId,
        content: content.trim(),
        role: 'user',
        message_type: messageType,
        metadata: '{}',
        created_at: new Date().toISOString()
    };

    db.prepare(`
    INSERT INTO messages (id, workspace_id, content, role, message_type, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(message.id, message.workspace_id, message.content, message.role, message.message_type, message.metadata, message.created_at);

    // Broadcast to agent via socket
    const { getIO } = require('../socket');
    const io = getIO();
    if (io) {
        io.to(`workspace:${workspaceId}`).emit('user_message', message);
    }

    res.status(201).json({ message });
});

// ─── Clear Messages ───────────────────────────────────────────────────────────

router.delete('/', (req, res) => {
    db.prepare('DELETE FROM messages WHERE workspace_id = ?').run(req.params.workspaceId);
    res.json({ success: true });
});

module.exports = router;
