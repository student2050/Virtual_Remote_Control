/**
 * Antigravity Agent — Logger
 * Pretty-printed console output with colors and icons
 */

const chalk = require('chalk');

const icons = {
    info: '◆',
    success: '✓',
    warn: '⚠',
    error: '✕',
    agent: '🤖',
    user: '📱',
    system: '⚙',
    approval: '🔐',
    connect: '⚡',
    disconnect: '⚡',
    activity: '📌',
    send: '→',
    receive: '←',
};

function timestamp() {
    return chalk.dim(new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
}

const log = {
    info(msg) {
        console.log(`${timestamp()} ${chalk.cyan(icons.info)}  ${chalk.white(msg)}`);
    },
    success(msg) {
        console.log(`${timestamp()} ${chalk.green(icons.success)}  ${chalk.green(msg)}`);
    },
    warn(msg) {
        console.log(`${timestamp()} ${chalk.yellow(icons.warn)}  ${chalk.yellow(msg)}`);
    },
    error(msg) {
        console.log(`${timestamp()} ${chalk.red(icons.error)}  ${chalk.red(msg)}`);
    },

    // Chat messages
    userMessage(content) {
        console.log('');
        console.log(`${timestamp()} ${chalk.blue('📱')} ${chalk.blue.bold('Tú (móvil):')}`);
        console.log(`  ${chalk.white(content)}`);
        console.log('');
    },
    agentMessage(content) {
        console.log(`${timestamp()} ${chalk.magenta('🤖')} ${chalk.magenta.bold('Agente enviado:')}`);
        console.log(`  ${chalk.dim(content.substring(0, 100))}${content.length > 100 ? '...' : ''}`);
    },

    // Approval requests
    approvalRequest(approval) {
        const riskColors = { low: chalk.green, medium: chalk.yellow, high: chalk.red, critical: chalk.bgRed.white };
        const riskColor = riskColors[approval.risk_level] || chalk.white;
        const riskLabels = { low: 'BAJO', medium: 'MEDIO', high: 'ALTO', critical: '⚡ CRÍTICO' };

        console.log('');
        console.log(chalk.yellow('━'.repeat(56)));
        console.log(`  ${chalk.yellow('🔐')} ${chalk.yellow.bold('APROBACIÓN REQUERIDA')}`);
        console.log(chalk.yellow('━'.repeat(56)));
        console.log(`  ${chalk.bold('Título:')}  ${chalk.white(approval.title)}`);
        if (approval.description) {
            console.log(`  ${chalk.bold('Info:')}    ${chalk.dim(approval.description)}`);
        }
        if (approval.command) {
            console.log(`  ${chalk.bold('Comando:')} ${chalk.cyan(approval.command)}`);
        }
        console.log(`  ${chalk.bold('Riesgo:')}  ${riskColor(riskLabels[approval.risk_level] || approval.risk_level)}`);
        const remaining = Math.max(0, new Date(approval.expires_at) - Date.now());
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        console.log(`  ${chalk.bold('Expira:')}  ${chalk.dim(`${mins}:${secs.toString().padStart(2, '0')}`)}`);
        console.log(chalk.yellow('━'.repeat(56)));
        console.log('');
    },

    approvalResult(action, title) {
        if (action === 'approved') {
            console.log(`${timestamp()} ✅ ${chalk.green.bold('APROBADO:')} ${chalk.dim(title)}`);
        } else {
            console.log(`${timestamp()} ❌ ${chalk.red.bold('RECHAZADO:')} ${chalk.dim(title)}`);
        }
        console.log('');
    },

    // Activity
    activity(a) {
        console.log(`${timestamp()} ${a.icon || '📌'} ${chalk.dim(a.title)}`);
    },

    // Connection
    connected(url) {
        console.log(`${timestamp()} ${chalk.green('⚡')} ${chalk.green.bold('Conectado a')} ${chalk.cyan(url)}`);
    },
    disconnected() {
        console.log(`${timestamp()} ${chalk.red('⚡')} ${chalk.red('Desconectado — reconectando...')}`);
    },

    // Prompt line
    prompt() {
        process.stdout.write(chalk.cyan('\n  ▸ '));
    },

    // Banner
    banner(info) {
        console.clear();
        console.log('');
        console.log(chalk.bold('  '));
        console.log(chalk.cyan.bold('  ▲  ANTIGRAVITY AGENT') + chalk.dim('  v1.0.0'));
        console.log(chalk.dim('  ─────────────────────────────────────────────────────'));
        console.log(`  ${chalk.dim('Servidor:')}   ${chalk.white(info.serverUrl)}`);
        console.log(`  ${chalk.dim('Workspace:')}  ${chalk.white(info.workspaceName || 'Conectando...')}`);
        console.log(`  ${chalk.dim('Hostname:')}   ${chalk.white(info.hostname)}`);
        console.log(`  ${chalk.dim('Platform:')}   ${chalk.white(info.platform)}`);
        console.log(chalk.dim('  ─────────────────────────────────────────────────────'));
        console.log('');
        console.log(chalk.dim('  Comandos: /help | /send <msg> | /status | /quit'));
        console.log('');
    },

    help() {
        console.log('');
        console.log(chalk.bold('  Comandos disponibles:'));
        console.log(`  ${chalk.cyan('/send <mensaje>')}   Enviar mensaje al móvil`);
        console.log(`  ${chalk.cyan('/status')}            Ver estado de la conexión`);
        console.log(`  ${chalk.cyan('/activity <texto>')} Registrar actividad`);
        console.log(`  ${chalk.cyan('/approval <título>')} Crear solicitud de aprobación manual`);
        console.log(`  ${chalk.cyan('/approve-all')}       Auto-aprobar aprobaciones de riesgo LOW`);
        console.log(`  ${chalk.cyan('/config')}            Ver configuración actual`);
        console.log(`  ${chalk.cyan('/quit')}              Salir`);
        console.log('');
    }
};

module.exports = log;
