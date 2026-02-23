const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/schema');
const { requireAuth, requireWorkspace } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

// All routes require auth + workspace
router.use(requireAuth, requireWorkspace);

// ─── List Approvals ───────────────────────────────────────────────────────────

router.get('/', (req, res) => {
    const { status = 'pending', limit = 20 } = req.query;
    const workspaceId = req.params.workspaceId;

    const approvals = db.prepare(`
    SELECT * FROM approvals
    WHERE workspace_id = ? ${status !== 'all' ? 'AND status = ?' : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...(status !== 'all' ? [workspaceId, status, parseInt(limit)] : [workspaceId, parseInt(limit)]));

    res.json({ approvals });
});

// ─── Get Single Approval ──────────────────────────────────────────────────────

router.get('/:approvalId', (req, res) => {
    const approval = db.prepare(
        'SELECT * FROM approvals WHERE id = ? AND workspace_id = ?'
    ).get(req.params.approvalId, req.params.workspaceId);

    if (!approval) return res.status(404).json({ error: 'Approval not found' });
    res.json({ approval });
});

// ─── Resolve Approval (approve or reject from mobile) ────────────────────────

router.post('/:approvalId/resolve', (req, res) => {
    const { action, comment } = req.body;
    const { approvalId, workspaceId } = req.params;

    if (!['approved', 'rejected'].includes(action)) {
        return res.status(400).json({ error: 'Action must be "approved" or "rejected"' });
    }

    const approval = db.prepare(
        "SELECT * FROM approvals WHERE id = ? AND workspace_id = ? AND status = 'pending'"
    ).get(approvalId, workspaceId);

    if (!approval) {
        return res.status(404).json({ error: 'Approval not found or already resolved' });
    }

    // Check if expired
    if (new Date(approval.expires_at) < new Date()) {
        db.prepare("UPDATE approvals SET status = 'expired' WHERE id = ?").run(approvalId);
        return res.status(410).json({ error: 'Approval request has expired' });
    }

    const metadata = JSON.parse(approval.metadata || '{}');
    if (comment) metadata.comment = comment;

    db.prepare(`
    UPDATE approvals 
    SET status = ?, resolved_at = datetime('now'), resolved_by = ?, metadata = ?
    WHERE id = ?
  `).run(action, req.user.id, JSON.stringify(metadata), approvalId);

    const updated = db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId);

    // Broadcast resolution to agent
    const { getIO } = require('../socket');
    const io = getIO();
    if (io) {
        io.to(`workspace:${workspaceId}`).emit('approval_resolved', {
            approvalId,
            action,
            approval: updated
        });
    }

    // Create activity log
    db.prepare(`
    INSERT INTO activity (id, workspace_id, title, description, icon, type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
        uuidv4(), workspaceId,
        `Approval ${action}`,
        `"${approval.title}" was ${action} by user`,
        action === 'approved' ? '✅' : '❌',
        action === 'approved' ? 'success' : 'warning'
    );

    res.json({ approval: updated });
});

module.exports = router;
