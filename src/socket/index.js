/**
 * Socket.io Manager
 * Handles real-time connections from:
 *  - Mobile users (JWT auth)
 *  - Local agents (API key auth)
 */

const jwt = require('jsonwebtoken');
const db = require('../db/schema');
const { v4: uuidv4 } = require('uuid');
const { JWT_SECRET } = require('../middleware/auth');

let _io = null;

function getIO() {
    return _io;
}

function initSocket(io) {
    _io = io;

    io.on('connection', async (socket) => {
        const { token, apiKey, workspaceId } = socket.handshake.auth;

        // ─── Authenticate Connection ──────────────────────────────────────

        let context = null; // { type: 'user'|'agent', workspaceId, userId? }

        if (token) {
            // Mobile user connecting
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                const user = db.prepare('SELECT id, email, name, plan FROM users WHERE id = ?').get(decoded.id);
                if (!user) { socket.disconnect(); return; }

                // Verify workspace access  
                const ws = db.prepare('SELECT id FROM workspaces WHERE id = ? AND user_id = ?').get(workspaceId, user.id);
                if (!ws) { socket.disconnect(); return; }

                context = { type: 'user', workspaceId, userId: user.id, user };
                console.log(`  📱 User connected: ${user.email} → workspace:${workspaceId}`);
            } catch {
                socket.disconnect();
                return;
            }
        } else if (apiKey) {
            // Local agent connecting
            const keyRecord = db.prepare(`
        SELECT k.*, w.user_id FROM api_keys k
        JOIN workspaces w ON w.id = k.workspace_id
        WHERE k.key = ? AND k.is_active = 1
      `).get(apiKey);

            if (!keyRecord) { socket.disconnect(); return; }

            context = { type: 'agent', workspaceId: keyRecord.workspace_id, apiKeyId: keyRecord.id };

            // Create or update agent session
            const existing = db.prepare('SELECT id FROM agent_sessions WHERE workspace_id = ? AND api_key_id = ?').get(keyRecord.workspace_id, keyRecord.id);
            if (existing) {
                db.prepare("UPDATE agent_sessions SET socket_id = ?, is_online = 1, last_ping_at = datetime('now') WHERE id = ?").run(socket.id, existing.id);
            } else {
                db.prepare(`
          INSERT INTO agent_sessions (id, workspace_id, api_key_id, socket_id, is_online)
          VALUES (?, ?, ?, ?, 1)
        `).run(uuidv4(), keyRecord.workspace_id, keyRecord.id, socket.id);
            }

            // Notify mobile that agent is online
            io.to(`workspace:${keyRecord.workspace_id}`).emit('agent_status', { online: true });
            console.log(`  🤖 Agent connected → workspace:${keyRecord.workspace_id}`);
        } else {
            socket.disconnect();
            return;
        }

        // ─── Join Workspace Room ──────────────────────────────────────────

        socket.join(`workspace:${context.workspaceId}`);

        // Send initial state
        if (context.type === 'user') {
            const messages = db.prepare('SELECT * FROM messages WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50').all(context.workspaceId).reverse();
            const activities = db.prepare('SELECT * FROM activity WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50').all(context.workspaceId);
            const pendingApprovals = db.prepare("SELECT * FROM approvals WHERE workspace_id = ? AND status = 'pending'").all(context.workspaceId);
            const agentOnline = !!db.prepare('SELECT id FROM agent_sessions WHERE workspace_id = ? AND is_online = 1').get(context.workspaceId);

            socket.emit('init', {
                messages,
                activities,
                pendingApprovals,
                agentOnline
            });

            // Mark messages as read
            db.prepare("UPDATE messages SET read = 1 WHERE workspace_id = ? AND role != 'user'").run(context.workspaceId);
        }

        // ─── User → Agent: Send Message via Socket ────────────────────────

        if (context.type === 'user') {
            socket.on('send_message', (data) => {
                const { content } = data;
                if (!content?.trim()) return;

                const message = {
                    id: uuidv4(),
                    workspace_id: context.workspaceId,
                    content: content.trim(),
                    role: 'user',
                    message_type: 'text',
                    metadata: '{}',
                    created_at: new Date().toISOString()
                };

                db.prepare(`
          INSERT INTO messages (id, workspace_id, content, role, message_type, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(message.id, message.workspace_id, message.content, message.role, message.message_type, message.metadata, message.created_at);

                // Broadcast to everyone in workspace (agent + other user tabs)
                io.to(`workspace:${context.workspaceId}`).emit('new_message', message);
            });

            socket.on('resolve_approval', ({ approvalId, action }) => {
                const approval = db.prepare("SELECT * FROM approvals WHERE id = ? AND workspace_id = ? AND status = 'pending'").get(approvalId, context.workspaceId);
                if (!approval || !['approved', 'rejected'].includes(action)) return;

                db.prepare("UPDATE approvals SET status = ?, resolved_at = datetime('now'), resolved_by = ? WHERE id = ?").run(action, context.userId, approvalId);
                io.to(`workspace:${context.workspaceId}`).emit('approval_resolved', { approvalId, action });

                // Log activity
                db.prepare(`INSERT INTO activity (id, workspace_id, title, icon, type) VALUES (?, ?, ?, ?, ?)`).run(
                    uuidv4(), context.workspaceId,
                    `${approval.title} was ${action}`,
                    action === 'approved' ? '✅' : '❌',
                    action === 'approved' ? 'success' : 'warning'
                );
            });
        }

        // ─── Disconnect ───────────────────────────────────────────────────

        socket.on('disconnect', () => {
            if (context.type === 'agent') {
                db.prepare("UPDATE agent_sessions SET is_online = 0, disconnected_at = datetime('now') WHERE socket_id = ?").run(socket.id);
                io.to(`workspace:${context.workspaceId}`).emit('agent_status', { online: false });
                console.log(`  🤖 Agent disconnected ← workspace:${context.workspaceId}`);
            } else {
                console.log(`  📱 User disconnected ← workspace:${context.workspaceId}`);
            }
        });
    });
}

module.exports = { initSocket, getIO };
