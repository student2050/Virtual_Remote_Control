require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');

// ─── Bootstrap DB (must be first) ───────────────────────────────────────────
require('./src/db/schema');

// ─── App Setup ────────────────────────────────────────────────────────────────
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3847;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

const app = express();
const server = http.createServer(app);

// ─── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
  transports: ['polling', 'websocket'],
  allowUpgrades: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

const { initSocket } = require('./src/socket');
initSocket(io);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan(IS_PRODUCTION ? 'combined' : 'dev'));
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for PWA
  crossOriginEmbedderPolicy: false
}));

// ─── Static PWA ───────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: IS_PRODUCTION ? '1d' : 0
}));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/workspaces', require('./src/routes/workspaces'));

// Workspace-scoped routes
app.use('/api/workspaces/:workspaceId/messages', require('./src/routes/messages'));
app.use('/api/workspaces/:workspaceId/approvals', require('./src/routes/approvals'));
app.use('/api/workspaces/:workspaceId/activity', require('./src/routes/activity'));

// Agent-facing API (API key auth, no workspace in path — it's derived from the key)
app.use('/api/agent', require('./src/routes/agent'));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: require('./package.json').version,
    environment: IS_PRODUCTION ? 'production' : 'development',
    timestamp: new Date().toISOString()
  });
});

// ─── API 404 ──────────────────────────────────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// ─── SPA Fallback (all non-API routes → PWA) ─────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: IS_PRODUCTION ? 'Internal server error' : err.message
  });
});

// ─── Auto-Seed Default User (survives server restarts on ephemeral DBs) ───────
async function seedDefaultUser() {
  const seedEmail = process.env.SEED_EMAIL;
  const seedPassword = process.env.SEED_PASSWORD;
  const seedName = process.env.SEED_NAME || 'Admin';
  const seedApiKey = process.env.SEED_API_KEY; // optional fixed key

  if (!seedEmail || !seedPassword) return;

  const db = require('./src/db/schema');
  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');

  try {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(seedEmail);
    if (existing) {
      console.log(`  ✓ Seed user already exists: ${seedEmail}`);
      // Always sync password from env (so Render restarts never break login)
      const hash = await bcrypt.hash(seedPassword, 10);
      db.prepare('UPDATE users SET password = ?, name = ? WHERE id = ?').run(hash, seedName, existing.id);
      console.log(`  ✓ Password synced from SEED_PASSWORD`);
      // Ensure API key matches SEED_API_KEY if provided
      if (seedApiKey) {
        const ws = db.prepare('SELECT id FROM workspaces WHERE user_id = ? LIMIT 1').get(existing.id);
        if (ws) {
          const existingKey = db.prepare('SELECT id FROM api_keys WHERE workspace_id = ? AND key = ?').get(ws.id, seedApiKey);
          if (!existingKey) {
            // Deactivate old keys and insert the seed key
            db.prepare('UPDATE api_keys SET is_active = 0 WHERE workspace_id = ?').run(ws.id);
            db.prepare(`INSERT INTO api_keys (id, workspace_id, user_id, key, name, is_active) VALUES (?, ?, ?, ?, 'Default Key', 1)`).run(uuidv4(), ws.id, existing.id, seedApiKey);
            console.log(`  ✓ API Key set to: ${seedApiKey}`);
          }
        }
      }
      // Show their API key
      const key = db.prepare(`
        SELECT k.key FROM api_keys k
        JOIN workspaces w ON w.id = k.workspace_id
        WHERE w.user_id = ? AND k.is_active = 1 LIMIT 1
      `).get(existing.id);
      if (key) console.log(`  ✓ API Key: ${key.key}`);
      return;
    }

    // Create user
    const userId = uuidv4();
    const wsId = uuidv4();
    const apiKeyId = uuidv4();
    const apiKeyVal = seedApiKey || ('ag_' + require('crypto').randomBytes(16).toString('hex'));
    const hash = await bcrypt.hash(seedPassword, 10);

    db.prepare(`INSERT INTO users (id, email, password, name, plan) VALUES (?, ?, ?, ?, 'free')`).run(userId, seedEmail, hash, seedName);
    db.prepare(`INSERT INTO workspaces (id, user_id, name, description) VALUES (?, ?, ?, ?)`).run(wsId, userId, `${seedName}'s Workspace`, 'Default workspace');
    db.prepare(`INSERT INTO api_keys (id, workspace_id, user_id, key, name) VALUES (?, ?, ?, ?, 'Default Key')`).run(apiKeyId, wsId, userId, apiKeyVal);

    console.log(`  ✓ Seed user created: ${seedEmail}`);
    console.log(`  ✓ API Key: ${apiKeyVal}`);
  } catch (err) {
    console.error('  ✕ Seed error:', err.message);
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', async () => {

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║   🚀 ANTIGRAVITY SAAS BACKEND                        ║');
  console.log(`  ║   📡 Port: ${PORT}                                      ║`);
  console.log(`  ║   🌍 URL:  ${APP_URL.padEnd(36)}║`);
  console.log(`  ║   🔧 Mode: ${(IS_PRODUCTION ? 'production' : 'development').padEnd(36)}║`);
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  API Endpoints:');
  console.log('  POST /api/auth/register');
  console.log('  POST /api/auth/login');
  console.log('  GET  /api/workspaces/:id/messages');
  console.log('  GET  /api/workspaces/:id/approvals');
  console.log('  POST /api/agent/message    (API key)');
  console.log('  POST /api/agent/approval   (API key)');
  console.log('  POST /api/agent/ping       (API key)');
  console.log('');

  // Auto-seed default user (for ephemeral DBs like Render free tier)
  await seedDefaultUser();

  // Setup tunnel in dev mode
  if (!IS_PRODUCTION) setupLocalTunnel(PORT);

  // ── Keep-alive ping (production only) ───────────────────────────────────────
  // Render free tier sleeps after 15min of inactivity — self-ping every 10 min
  if (IS_PRODUCTION && APP_URL && !APP_URL.includes('localhost')) {
    const https = require('https');
    setInterval(() => {
      const url = new URL('/health', APP_URL.startsWith('http') ? APP_URL : `https://${APP_URL}`);
      https.get(url.toString(), (res) => {
        // silent ping
      }).on('error', () => { });
    }, 10 * 60 * 1000); // every 10 minutes
    console.log('  ♾️  Keep-alive ping activo (cada 10 min)\n');
  }
});

// ─── Local Tunnel (dev only) ──────────────────────────────────────────────────
function setupLocalTunnel(port) {
  try {
    const { spawn } = require('child_process');
    console.log('  🌍 Starting Cloudflare Tunnel...');
    const cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let found = false;
    const onData = (data) => {
      const match = data.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !found) {
        found = true;
        console.log(`  🌍 TUNNEL: ${match[0]}\n`);
        io.emit('tunnel_url', match[0]);
      }
    };
    cf.stdout.on('data', onData);
    cf.stderr.on('data', onData);
    cf.on('error', (e) => {
      if (e.code === 'ENOENT') console.log('  ⚠️  cloudflared not found. Install: brew install cloudflared\n');
    });
    cf.on('close', (code) => {
      if (code && code !== 0) setTimeout(() => setupLocalTunnel(port), 5000);
    });
    process.on('SIGINT', () => { cf.kill(); process.exit(); });
    process.on('SIGTERM', () => { cf.kill(); process.exit(); });
  } catch (e) {
    console.log('  ⚠️  Tunnel error:', e.message);
  }
}
