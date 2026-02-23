const express = require('express');
const db = require('../db/schema');
const { requireAuth, requireWorkspace } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

router.use(requireAuth, requireWorkspace);

// ─── Get Activity Feed ───────────────────────────────────────────────────────

router.get('/', (req, res) => {
    const { limit = 50, type } = req.query;
    const workspaceId = req.params.workspaceId;

    let query = 'SELECT * FROM activity WHERE workspace_id = ?';
    const params = [workspaceId];

    if (type) {
        query += ' AND type = ?';
        params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const activities = db.prepare(query).all(...params);
    res.json({ activities });
});

module.exports = router;
