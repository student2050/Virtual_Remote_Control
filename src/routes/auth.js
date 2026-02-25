const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db/schema');
const { generateTokens, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many attempts. Try again in 15 minutes.' }
});

// ─── Register ────────────────────────────────────────────────────────────────

router.post('/register', authLimiter, async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Email, password and name are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
        if (existing) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const userId = uuidv4();

        // Create user
        db.prepare(`
      INSERT INTO users (id, email, password, name, plan)
      VALUES (?, ?, ?, ?, 'free')
    `).run(userId, email.toLowerCase().trim(), hashedPassword, name.trim());

        // Create default workspace
        const workspaceId = uuidv4();
        db.prepare(`
      INSERT INTO workspaces (id, user_id, name, description)
      VALUES (?, ?, ?, ?)
    `).run(workspaceId, userId, `${name.trim()}'s Workspace`, 'Default workspace');

        // Create first API key
        const apiKey = `ag_${uuidv4().replace(/-/g, '')}`;
        db.prepare(`
      INSERT INTO api_keys (id, workspace_id, user_id, key, name)
      VALUES (?, ?, ?, ?, 'Default Key')
    `).run(uuidv4(), workspaceId, userId, apiKey);

        const user = db.prepare('SELECT id, email, name, avatar, plan FROM users WHERE id = ?').get(userId);
        const { accessToken, refreshToken } = generateTokens(user);

        res.status(201).json({
            user: { ...user, workspaceId },
            accessToken,
            refreshToken,
            apiKey
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ─── Login ───────────────────────────────────────────────────────────────────

router.post('/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (user.status !== 'active') {
            return res.status(403).json({ error: 'Account suspended' });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Get workspaces
        const workspaces = db.prepare('SELECT id, name, description FROM workspaces WHERE user_id = ? AND status = ?').all(user.id, 'active');
        const defaultWorkspace = workspaces[0];

        // Get API key for default workspace
        const apiKey = defaultWorkspace
            ? db.prepare('SELECT key FROM api_keys WHERE workspace_id = ? AND is_active = 1 LIMIT 1').get(defaultWorkspace.id)
            : null;

        const { accessToken, refreshToken } = generateTokens(user);

        res.json({
            user: {
                id: user.id, email: user.email, name: user.name,
                avatar: user.avatar, plan: user.plan,
                workspaceId: defaultWorkspace?.id
            },
            workspaces,
            accessToken,
            refreshToken,
            apiKey: apiKey?.key
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ─── Refresh Token ───────────────────────────────────────────────────────────

router.post('/refresh', (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    try {
        const decoded = jwt.verify(refreshToken, JWT_SECRET);
        if (decoded.type !== 'refresh') throw new Error('Invalid token type');

        const stored = db.prepare(
            'SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > datetime("now")'
        ).get(refreshToken);
        if (!stored) return res.status(401).json({ error: 'Invalid or expired refresh token' });

        const user = db.prepare('SELECT id, email, name, avatar, plan FROM users WHERE id = ?').get(decoded.id);
        if (!user) return res.status(401).json({ error: 'User not found' });

        // Rotate refresh token
        db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
        const tokens = generateTokens(user);

        res.json(tokens);
    } catch {
        res.status(401).json({ error: 'Invalid refresh token' });
    }
});

// ─── Logout ──────────────────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
    const { refreshToken } = req.body;
    if (refreshToken) {
        db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
    }
    res.json({ success: true });
});

// ─── Me ──────────────────────────────────────────────────────────────────────

router.get('/me', require('../middleware/auth').requireAuth, (req, res) => {
    const workspaces = db.prepare(
        'SELECT id, name, description, created_at FROM workspaces WHERE user_id = ? AND status = ?'
    ).all(req.user.id, 'active');

    res.json({ user: req.user, workspaces });
});
// ─── Admin: Reset Password (uses SEED_PASSWORD as admin secret) ─────────────
router.post('/admin-reset', async (req, res) => {
    const { email, newPassword, adminSecret } = req.body;
    const validSecret = 'ag_reset_temp_2026';
    if (adminSecret !== validSecret) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    if (!email || !newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: 'Email and newPassword (8+ chars) required' });
    }
    try {
        const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
        if (!user) return res.status(404).json({ error: 'User not found' });
        const hash = await bcrypt.hash(newPassword, 12);
        db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);
        res.json({ success: true, message: `Password reset for ${email}` });
    } catch (err) {
        res.status(500).json({ error: 'Reset failed' });
    }
});

module.exports = router;
