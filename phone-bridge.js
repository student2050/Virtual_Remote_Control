#!/usr/bin/env node
/**
 * Antigravity Phone Bridge Daemon
 * 
 * Automatically bridges messages between the phone (via PHP relay)
 * and the IDE Agent chat (via AppleScript keyboard simulation).
 * 
 * Flow: Phone → PHP → This daemon → Types into IDE → Agent responds
 *       Agent responds → This daemon detects → Sends to PHP → Phone shows it
 */

const { execSync } = require('child_process');
const os = require('os');

// ─── Config ──────────────────────────────────────────────────────────────
const PHP_API = 'https://www.virtualtecserver.com/antigravity/api.php';
const API_KEY = 'ag_antigravity_permanent_key_2025';
const POLL_INTERVAL = 5000; // 5 seconds
const IDE_PROCESS = 'Electron'; // The IDE process name

let lastTimestamp = Date.now(); // Only pick up NEW messages from now on
let running = true;

// ─── Colors ──────────────────────────────────────────────────────────────
const c = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
    red: '\x1b[31m', magenta: '\x1b[35m'
};

function time() { return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function log(icon, msg) { console.log(`${c.dim}${time()}${c.reset} ${icon}  ${msg}`); }

// ─── PHP API ─────────────────────────────────────────────────────────────
async function phpGet(action) {
    const res = await fetch(`${PHP_API}?${action}`, { signal: AbortSignal.timeout(15000) });
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

// ─── AppleScript: Type message into IDE ──────────────────────────────────
function typeIntoIDE(message) {
    // Escape the message for AppleScript
    const escaped = message
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');

    // Prefix with /check-phone context so the agent knows this is from the phone
    const fullMessage = `/check-phone ${escaped}`;

    const script = `
    tell application "System Events"
      -- Activate the IDE
      set frontApp to name of first application process whose frontmost is true
      tell process "${IDE_PROCESS}"
        set frontmost to true
      end tell
      delay 0.5
      
      -- Type the message
      keystroke "${fullMessage}"
      delay 0.3
      
      -- Press Enter to send
      keystroke return
      delay 0.5
      
      -- Restore previous app if needed
    end tell
  `;

    try {
        execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { timeout: 10000 });
        return true;
    } catch (e) {
        log('✕', `${c.red}AppleScript error: ${e.message}${c.reset}`);
        return false;
    }
}

// ─── Poll for new messages ───────────────────────────────────────────────
async function poll() {
    try {
        const data = await phpGet(`action=inbox&since=${lastTimestamp}&role=user`);
        if (data.messages && data.messages.length > 0) {
            for (const msg of data.messages) {
                log('📱', `${c.magenta}Mensaje del celular:${c.reset} ${c.bold}${msg.content}${c.reset}`);
                lastTimestamp = msg.timestamp;

                // Type the message into the IDE
                log('⌨️', `${c.cyan}Escribiendo en IDE...${c.reset}`);
                const success = typeIntoIDE(msg.content);

                if (success) {
                    log('✓', `${c.green}Mensaje inyectado en IDE${c.reset}`);
                } else {
                    log('✕', `${c.red}Error inyectando en IDE${c.reset}`);
                    // Fallback: notify via PHP
                    await phpSend(`⚠️ No pude inyectar el mensaje en el IDE. Tu mensaje fue: "${msg.content}". El agente lo verá cuando use /check-phone.`);
                }
            }
        }
    } catch (e) {
        // Silent retry
    }
}

// ─── Keep agent status alive ─────────────────────────────────────────────
async function ping() {
    try {
        await fetch(`${PHP_API}?action=ping&key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'ping', hostname: os.hostname() }),
            signal: AbortSignal.timeout(10000)
        });
    } catch (e) { }
}

// ─── Banner ──────────────────────────────────────────────────────────────
console.log(`
  ${c.cyan}${c.bold}▲  ANTIGRAVITY PHONE BRIDGE${c.reset}
  ${'─'.repeat(50)}
  ${c.dim}PHP API:${c.reset}    ${PHP_API}
  ${c.dim}IDE:${c.reset}        ${IDE_PROCESS}
  ${c.dim}Polling:${c.reset}    cada ${POLL_INTERVAL / 1000}s
  ${'─'.repeat(50)}
  ${c.yellow}Los mensajes del celular se inyectarán en el IDE automáticamente${c.reset}
`);

// ─── Main loop ───────────────────────────────────────────────────────────
async function main() {
    // Initial health check
    try {
        const health = await phpGet('action=health');
        log('✓', `${c.green}PHP API OK${c.reset}`);
    } catch (e) {
        log('✕', `${c.red}PHP API no disponible: ${e.message}${c.reset}`);
        process.exit(1);
    }

    await ping();
    log('⚡', `${c.green}Bridge activo — esperando mensajes del celular...${c.reset}`);

    // Notify phone
    await phpSend('🟢 Bridge automático activado. Tus mensajes llegarán directamente al agente AI.');

    // Start polling
    setInterval(poll, POLL_INTERVAL);
    setInterval(ping, 30000);
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
