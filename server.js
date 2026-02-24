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

// ─── Startup ──────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
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
