const jwt = require('jsonwebtoken');
const db = require('../db/schema');

const JWT_SECRET = process.env.JWT_SECRET || 'antigravity-dev-secret-change-in-prod';

// ─── JWT Auth Middleware ─────────────────────────────────────────────────────

function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = db.prepare('SELECT id, email, name, avatar, plan, status FROM users WHERE id = ?').get(decoded.id);
        if (!user || user.status !== 'active') {
            return res.status(401).json({ error: 'User not found or inactive' });
        }
        req.user = user;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
        }
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// ─── Workspace Resolution ────────────────────────────────────────────────────

function requireWorkspace(req, res, next) {
    const workspaceId = req.params.workspaceId || req.headers['x-workspace-id'];
    if (!workspaceId) {
        return res.status(400).json({ error: 'Workspace ID required' });
    }

    const workspace = db.prepare(
        'SELECT * FROM workspaces WHERE id = ? AND user_id = ? AND status = ?'
    ).get(workspaceId, req.user.id, 'active');

    if (!workspace) {
        return res.status(403).json({ error: 'Workspace not found or access denied' });
    }

    req.workspace = workspace;
    next();
}

// ─── API Key Middleware (for local agent) ────────────────────────────────────

function requireApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) {
        return res.status(401).json({ error: 'API key required' });
    }

    const keyRecord = db.prepare(`
    SELECT k.*, w.id as workspace_id, w.user_id, w.name as workspace_name
    FROM api_keys k
    JOIN workspaces w ON w.id = k.workspace_id
    WHERE k.key = ? AND k.is_active = 1
  `).get(apiKey);

    if (!keyRecord) {
        return res.status(401).json({ error: 'Invalid or inactive API key' });
    }

    // Check expiry
    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
        return res.status(401).json({ error: 'API key expired' });
    }

    // Update last used
    db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(keyRecord.id);

    req.apiKey = keyRecord;
    req.workspaceId = keyRecord.workspace_id;
    next();
}

// ─── Token Generation ────────────────────────────────────────────────────────

function generateTokens(user) {
    const accessToken = jwt.sign(
        { id: user.id, email: user.email, plan: user.plan },
        JWT_SECRET,
        { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
        { id: user.id, type: 'refresh' },
        JWT_SECRET,
        { expiresIn: '30d' }
    );

    // Store refresh token
    db.prepare(`
    INSERT INTO refresh_tokens (user_id, token, expires_at)
    VALUES (?, ?, datetime('now', '+30 days'))
  `).run(user.id, refreshToken);

    return { accessToken, refreshToken };
}

module.exports = { requireAuth, requireWorkspace, requireApiKey, generateTokens, JWT_SECRET };
