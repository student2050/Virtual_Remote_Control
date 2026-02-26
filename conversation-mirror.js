#!/usr/bin/env node
/**
 * Antigravity Conversation Mirror Daemon
 * 
 * Runs in background on the Mac. Two jobs:
 * 
 * 1. PHONE → IDE: Polls PHP for new phone messages, types them into IDE via AppleScript
 * 2. IDE → PHONE: Watches a local "outbox" file. When the agent writes to it, 
 *    sends the content to PHP so it appears on the phone.
 * 
 * The agent (Claude) cooperates by writing responses to the outbox file.
 * 
 * Usage: node conversation-mirror.js &
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Config ──────────────────────────────────────────────────────────────
const PHP_API = 'https://www.virtualtecserver.com/antigravity/api.php';
const API_KEY = 'ag_antigravity_permanent_key_2025';
const POLL_INTERVAL = 4000; // 4 seconds
const OUTBOX_FILE = path.join(os.homedir(), '.antigravity', 'outbox.txt');
const INBOX_FILE = path.join(os.homedir(), '.antigravity', 'inbox.txt');

let lastPhoneTimestamp = Date.now();
let lastOutboxMtime = 0;

// ─── Ensure directories ─────────────────────────────────────────────────
const configDir = path.join(os.homedir(), '.antigravity');
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

// ─── Colors ──────────────────────────────────────────────────────────────
const c = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
    red: '\x1b[31m', magenta: '\x1b[35m'
};
function time() { return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function log(icon, msg) { console.log(`${c.dim}${time()}${c.reset} ${icon}  ${msg}`); }

// ─── PHP API helpers ─────────────────────────────────────────────────────
async function phpGet(params) {
    const res = await fetch(`${PHP_API}?${params}`, { signal: AbortSignal.timeout(15000) });
    return res.json();
}

async function phpSend(content) {
    const res = await fetch(`${PHP_API}?action=send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', content, role: 'agent', token: API_KEY }),
        signal: AbortSignal.timeout(15000)
    });
    return res.json();
}

async function phpPing() {
    try {
        await fetch(`${PHP_API}?action=ping&key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'ping', hostname: os.hostname() }),
            signal: AbortSignal.timeout(10000)
        });
    } catch (e) { }
}

// ═══════════════════════════════════════════════════════════════════════════
// JOB 1: PHONE → IDE  (poll PHP, write to inbox file for the agent to see)
// ═══════════════════════════════════════════════════════════════════════════
async function pollPhone() {
    try {
        const data = await phpGet(`action=inbox&since=${lastPhoneTimestamp}&role=user`);
        if (data.messages && data.messages.length > 0) {
            for (const msg of data.messages) {
                lastPhoneTimestamp = msg.timestamp;
                log('📱', `${c.magenta}Celular:${c.reset} ${c.bold}${msg.content}${c.reset}`);

                // Write to inbox file so the agent can read it
                const entry = `[${new Date().toLocaleString('es-CO')}] ${msg.content}\n`;
                fs.appendFileSync(INBOX_FILE, entry);

                // Also try to inject into IDE via AppleScript
                injectIntoIDE(msg.content);
            }
        }
    } catch (e) { /* silent */ }
}

function injectIntoIDE(message) {
    // Use AppleScript to type /check-phone into IDE
    // This triggers the workflow which reads and responds
    const safeMsg = message.replace(/['"\\]/g, ' ').substring(0, 200);

    try {
        execSync(`osascript -e '
      tell application "System Events"
        tell process "Electron"
          set frontmost to true
        end tell
        delay 0.3
        keystroke "/check-phone"
        delay 0.2
        keystroke return
      end tell
    '`, { timeout: 8000 });
        log('⌨️', `${c.green}Inyectado /check-phone en IDE${c.reset}`);
    } catch (e) {
        log('⚠️', `${c.yellow}No pude inyectar en IDE (ventana no enfocada?)${c.reset}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// JOB 2: IDE → PHONE  (watch outbox file, send to PHP)
// ═══════════════════════════════════════════════════════════════════════════
function watchOutbox() {
    // Create outbox if doesn't exist
    if (!fs.existsSync(OUTBOX_FILE)) {
        fs.writeFileSync(OUTBOX_FILE, '');
    }

    // Watch for changes
    fs.watchFile(OUTBOX_FILE, { interval: 2000 }, async (curr, prev) => {
        if (curr.mtime > prev.mtime) {
            const content = fs.readFileSync(OUTBOX_FILE, 'utf8').trim();
            if (content && content.length > 0) {
                log('🤖', `${c.cyan}Enviando al celular:${c.reset} ${content.substring(0, 80)}...`);
                try {
                    await phpSend(content);
                    // Clear outbox after sending
                    fs.writeFileSync(OUTBOX_FILE, '');
                    log('✓', `${c.green}Enviado al celular${c.reset}`);
                } catch (e) {
                    log('✕', `${c.red}Error enviando: ${e.message}${c.reset}`);
                }
            }
        }
    });

    log('👁', `${c.dim}Watching outbox: ${OUTBOX_FILE}${c.reset}`);
}

// ─── Banner ──────────────────────────────────────────────────────────────
console.log(`
  ${c.cyan}${c.bold}▲  ANTIGRAVITY CONVERSATION MIRROR${c.reset}
  ${'─'.repeat(50)}
  ${c.dim}PHP API:${c.reset}   ${PHP_API.replace('/api.php', '')}
  ${c.dim}Inbox:${c.reset}     ${INBOX_FILE}
  ${c.dim}Outbox:${c.reset}    ${OUTBOX_FILE}
  ${c.dim}Polling:${c.reset}   cada ${POLL_INTERVAL / 1000}s
  ${'─'.repeat(50)}
  ${c.yellow}📱→🖥  Mensajes del celular se inyectan en el IDE${c.reset}
  ${c.yellow}🖥→📱  Escribe en outbox para enviar al celular${c.reset}
`);

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
    // Health check
    try {
        await phpGet('action=health');
        log('✓', `${c.green}PHP API OK${c.reset}`);
    } catch (e) {
        log('✕', `${c.red}PHP API no disponible${c.reset}`);
        process.exit(1);
    }

    // Start watchers
    watchOutbox();
    await phpPing();

    log('⚡', `${c.green}Mirror activo${c.reset}`);
    await phpSend('🟢 Mirror activo. Tus mensajes llegarán al agente AI automáticamente.');

    // Poll phone
    setInterval(pollPhone, POLL_INTERVAL);
    setInterval(phpPing, 30000);
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
