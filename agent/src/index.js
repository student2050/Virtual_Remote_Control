#!/usr/bin/env node
/**
 * ▲ ANTIGRAVITY AGENT v1.0.0
 * Local agent for Mac — connects to Antigravity SaaS
 *
 * Usage:
 *   AG_KEY=ag_xxx node src/index.js
 *   AG_KEY=ag_xxx AG_SERVER=https://your-server.com node src/index.js
 */

require('dotenv').config();

const readline = require('readline');
const os = require('os');
const chalk = require('chalk');
const log = require('./logger');
const config = require('./config');
const { AgentAPI, waitForApproval } = require('./api');
const AgentConnector = require('./connector');

// ─── Resolve Configuration ────────────────────────────────────────────────────
const API_KEY = process.env.AG_KEY || process.env.ANTIGRAVITY_KEY || config.get('apiKey');
const SERVER_URL = process.env.AG_SERVER || process.env.ANTIGRAVITY_SERVER || config.get('serverUrl');

// ─── Validate ─────────────────────────────────────────────────────────────────
if (!API_KEY) {
    console.log('');
    console.log(chalk.red.bold('  ✕  API key requerida'));
    console.log(chalk.dim('  Obtén tu API key en la app y úsala así:'));
    console.log('');
    console.log(chalk.cyan('  AG_KEY=ag_xxxx npx @antigravity/agent'));
    console.log('');
    console.log(chalk.dim('  O configúrala permanentemente:'));
    console.log(chalk.cyan('  echo "AG_KEY=ag_xxxx" >> ~/.zshrc && source ~/.zshrc'));
    console.log('');
    process.exit(1);
}

// ─── Initialize Services ─────────────────────────────────────────────────────
const api = new AgentAPI(SERVER_URL, API_KEY);
const connector = new AgentConnector(SERVER_URL, API_KEY);

// Track pending approval prompts (to avoid multiple concurrent prompts)
let pendingApproval = null;
let lastInboxTime = new Date().toISOString();

// ─── Banner & Start ───────────────────────────────────────────────────────────
log.banner({
    serverUrl: SERVER_URL,
    workspaceName: config.get('workspaceName') || '...',
    hostname: os.hostname(),
    platform: `${os.type()} ${os.arch()} (Node ${process.version})`,
});

// ─── Verify API Key ───────────────────────────────────────────────────────────
async function startup() {
    log.info('Verificando API key...');
    try {
        await api.ping();
        log.success('API key válida. Conectando...');

        // Save key and server for future runs
        config.set('apiKey', API_KEY);
        config.set('serverUrl', SERVER_URL);
    } catch (err) {
        log.error(`API key inválida o servidor inalcanzable: ${err.message}`);
        log.warn(`Servidor: ${SERVER_URL}`);
        log.warn('Verifica que el servidor esté corriendo y la API key sea correcta.');
        process.exit(1);
    }

    // Connect socket
    connector.connect();
    setupSocketEvents();
    setupHeartbeat();
    setupREPL();

    // Log startup activity
    try {
        await api.logActivity(
            'Agente conectado',
            `Desde ${os.hostname()} (${os.type()})`,
            '🖥',
            'success'
        );
    } catch { }
}

// ─── Socket Events ────────────────────────────────────────────────────────────
function setupSocketEvents() {
    connector.on('connected', async () => {
        await api.sendMessage(
            `🖥 **Agente conectado** desde \`${os.hostname()}\` (${os.type()} ${os.arch()})\n` +
            `Listo para recibir instrucciones. Escríbeme desde el móvil.`,
            'system'
        ).catch(() => { });
    });

    connector.on('user_message', async (msg) => {
        // A message came from mobile — the agent could forward this to a local AI
        // For now, we show it in terminal and let the REPL handle responses
        log.userMessage(msg.content);

        // Built-in command responses
        const lower = msg.content.toLowerCase().trim();
        if (lower === 'estado' || lower === 'status') {
            await api.sendMessage(
                `📊 **Estado del agente**\n` +
                `• Hostname: \`${os.hostname()}\`\n` +
                `• Platform: ${os.type()} ${os.arch()}\n` +
                `• Node: ${process.version}\n` +
                `• Uptime: ${formatUptime(process.uptime())}\n` +
                `• Memoria: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB`,
                'agent'
            ).catch(() => { });
        }
    });

    connector.on('approval_resolved', async ({ approvalId, action }) => {
        log.info(`Aprobación ${approvalId.substring(0, 8)}... → ${action}`);
    });
}

// ─── Heartbeat (ping every 30s) ───────────────────────────────────────────────
function setupHeartbeat() {
    setInterval(async () => {
        if (!connector.isConnected()) return;
        await api.ping().catch(() => { });
    }, 30 * 1000);
}

// ─── Interactive REPL ─────────────────────────────────────────────────────────
function setupREPL() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        prompt: chalk.cyan('\n  ▸ '),
    });

    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) { rl.prompt(); return; }

        try {
            await handleCommand(input);
        } catch (err) {
            log.error(`Error: ${err.message}`);
        }

        rl.prompt();
    });

    rl.on('close', () => {
        shutdown();
    });
}

// ─── Command Parser ───────────────────────────────────────────────────────────
async function handleCommand(input) {
    // Slash commands
    if (input.startsWith('/')) {
        const [cmd, ...args] = input.slice(1).split(' ');
        const arg = args.join(' ');

        switch (cmd.toLowerCase()) {

            case 'send':
            case 's':
                if (!arg) { log.warn('Uso: /send <mensaje>'); break; }
                await api.sendMessage(arg);
                log.agentMessage(arg);
                break;

            case 'approval':
            case 'approve':
                if (!arg) { log.warn('Uso: /approval <título>'); break; }
                const { approval } = await api.requestApproval({
                    title: arg,
                    description: 'Solicitud manual desde el agente',
                    riskLevel: 'medium',
                });
                log.info(`Aprobación enviada al móvil (ID: ${approval.id.substring(0, 8)}...)`);;
                // Wait for response
                log.info('Esperando respuesta del móvil...');
                const resolved = await waitForApproval(api, approval.id, 620000);
                log.approvalResult(resolved.status, arg);
                break;

            case 'activity':
            case 'log':
                if (!arg) { log.warn('Uso: /activity <descripción>'); break; }
                await api.logActivity(arg, '', '📌', 'info');
                log.success(`Actividad registrada: ${arg}`);
                break;

            case 'status':
                const conn = connector.isConnected() ? chalk.green('Conectado ✓') : chalk.red('Desconectado ✗');
                log.info(`WebSocket: ${conn}`);
                log.info(`Servidor:  ${SERVER_URL}`);
                log.info(`Uptime:    ${formatUptime(process.uptime())}`);
                log.info(`Memoria:   ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB`);
                break;

            case 'config':
                const cfg = config.getAll();
                log.info(`Servidor:      ${cfg.serverUrl}`);
                log.info(`Auto-aprobar:  ${cfg.autoApprove ? 'sí' : 'no'}`);
                log.info(`Riesgo auto:   ${cfg.autoApproveRisk}`);
                break;

            case 'approve-all':
            case 'auto':
                config.set('autoApprove', true);
                config.set('autoApproveRisk', 'low');
                log.success('Auto-aprobación activada para riesgos BAJO y menor.');
                break;

            case 'no-auto':
                config.set('autoApprove', false);
                log.info('Auto-aprobación desactivada.');
                break;

            case 'help':
            case 'h':
                log.help();
                break;

            case 'quit':
            case 'exit':
            case 'q':
                shutdown();
                break;

            default:
                log.warn(`Comando desconocido: /${cmd}. Escribe /help para ver los comandos.`);
        }
    } else {
        // If no slash, treat as /send
        await api.sendMessage(input).catch(err => log.error(`No se pudo enviar: ${err.message}`));
        log.agentMessage(input);
    }
}

// ─── Shutdown ────────────────────────────────────────────────────────────────
async function shutdown() {
    console.log('');
    log.info('Desconectando...');
    try {
        await api.logActivity('Agente desconectado', `${os.hostname()} se desconectó`, '🔌', 'warning');
        await api.sendMessage('🔌 Agente desconectado. Hasta pronto.', 'system');
    } catch { }
    connector.disconnect();
    console.log(chalk.dim('  Hasta pronto! 👋'));
    console.log('');
    process.exit(0);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// ─── Signals ─────────────────────────────────────────────────────────────────
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => { log.error(`Error inesperado: ${err.message}`); });
process.on('unhandledRejection', (err) => { log.error(`Promesa rechazada: ${err?.message || err}`); });

// ─── Go! ──────────────────────────────────────────────────────────────────────
startup();
