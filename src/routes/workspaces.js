const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/schema');
const { requireAuth, requireWorkspace } = require('../middleware/auth');

const router = express.Router();

// All routes require auth
router.use(requireAuth);

// ─── List Workspaces ─────────────────────────────────────────────────────────

router.get('/', (req, res) => {
    const workspaces = db.prepare(`
    SELECT w.*, 
      (SELECT COUNT(*) FROM messages m WHERE m.workspace_id = w.id) as message_count,
      (SELECT COUNT(*) FROM approvals a WHERE a.workspace_id = w.id AND a.status = 'pending') as pending_approvals,
      (SELECT is_online FROM agent_sessions s WHERE s.workspace_id = w.id AND s.is_online = 1 LIMIT 1) as agent_online
    FROM workspaces w
    WHERE w.user_id = ? AND w.status = 'active'
    ORDER BY w.created_at ASC
  `).all(req.user.id);

    res.json({ workspaces });
});

// ─── Create Workspace (Pro plan) ─────────────────────────────────────────────

router.post('/', (req, res) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Workspace name required' });

    // Free plan: max 1 workspace
    if (req.user.plan === 'free') {
        const count = db.prepare('SELECT COUNT(*) as c FROM workspaces WHERE user_id = ? AND status = ?').get(req.user.id, 'active');
        if (count.c >= 1) {
            return res.status(403).json({ error: 'Free plan allows 1 workspace. Upgrade to Pro for more.', code: 'PLAN_LIMIT' });
        }
    }

    const workspaceId = uuidv4();
    db.prepare(`
    INSERT INTO workspaces (id, user_id, name, description)
    VALUES (?, ?, ?, ?)
  `).run(workspaceId, req.user.id, name.trim(), description?.trim() || '');

    // Create default API key for new workspace
    const apiKey = `ag_${uuidv4().replace(/-/g, '')}`;
    db.prepare(`
    INSERT INTO api_keys (id, workspace_id, user_id, key, name)
    VALUES (?, ?, ?, ?, 'Default Key')
  `).run(uuidv4(), workspaceId, req.user.id, apiKey);

    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId);
    res.status(201).json({ workspace, apiKey });
});

// ─── Get Workspace ───────────────────────────────────────────────────────────

router.get('/:workspaceId', requireWorkspace, (req, res) => {
    const { workspaceId } = req.params;

    const stats = {
        messages: db.prepare('SELECT COUNT(*) as c FROM messages WHERE workspace_id = ?').get(workspaceId).c,
        pendingApprovals: db.prepare('SELECT COUNT(*) as c FROM approvals WHERE workspace_id = ? AND status = ?').get(workspaceId, 'pending').c,
        activityToday: db.prepare("SELECT COUNT(*) as c FROM activity WHERE workspace_id = ? AND date(created_at) = date('now')").get(workspaceId).c,
        agentOnline: !!db.prepare('SELECT id FROM agent_sessions WHERE workspace_id = ? AND is_online = 1').get(workspaceId)
    };

    const apiKeys = db.prepare(`
    SELECT id, name, key, last_used_at, expires_at, is_active, created_at
    FROM api_keys WHERE workspace_id = ? ORDER BY created_at ASC
  `).all(workspaceId);

    // Mask keys for security (show only last 8 chars)
    const maskedKeys = apiKeys.map(k => ({
        ...k,
        keyPreview: `ag_${'*'.repeat(20)}${k.key.slice(-8)}`
    }));

    res.json({ workspace: req.workspace, stats, apiKeys: maskedKeys });
});

// ─── API Key Management ──────────────────────────────────────────────────────

router.post('/:workspaceId/keys', requireWorkspace, (req, res) => {
    const { name } = req.body;
    const { workspaceId } = req.params;

    const keyCount = db.prepare('SELECT COUNT(*) as c FROM api_keys WHERE workspace_id = ? AND is_active = 1').get(workspaceId);
    const maxKeys = req.user.plan === 'free' ? 1 : 10;
    if (keyCount.c >= maxKeys) {
        return res.status(403).json({ error: `Max ${maxKeys} API keys per workspace on ${req.user.plan} plan` });
    }

    const apiKey = `ag_${uuidv4().replace(/-/g, '')}`;
    db.prepare(`
    INSERT INTO api_keys (id, workspace_id, user_id, key, name)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), workspaceId, req.user.id, apiKey, name || 'New Key');

    res.status(201).json({ key: apiKey, name: name || 'New Key' });
});

router.delete('/:workspaceId/keys/:keyId', requireWorkspace, (req, res) => {
    db.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ? AND workspace_id = ?').run(req.params.keyId, req.params.workspaceId);
    res.json({ success: true });
});

// ─── Reveal API Key (one-time) ───────────────────────────────────────────────

router.get('/:workspaceId/keys/:keyId/reveal', requireWorkspace, (req, res) => {
    const key = db.prepare('SELECT key FROM api_keys WHERE id = ? AND workspace_id = ?').get(req.params.keyId, req.params.workspaceId);
    if (!key) return res.status(404).json({ error: 'Key not found' });
    res.json({ key: key.key });
});

module.exports = router;
