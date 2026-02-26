/**
 * Antigravity Agent — Socket.io Connector
 * Maintains real-time connection to the Antigravity server
 */

const { io } = require('socket.io-client');
const log = require('./logger');
const EventEmitter = require('events');

class AgentConnector extends EventEmitter {
    constructor(serverUrl, apiKey) {
        super();
        this.serverUrl = serverUrl;
        this.apiKey = apiKey;
        this.socket = null;
        this.connected = false;
        this.reconnectAttempts = 0;
    }

    connect() {
        this.socket = io(this.serverUrl, {
            auth: { apiKey: this.apiKey },
            transports: ['polling', 'websocket'],
            reconnection: true,
            reconnectionDelay: 3000,
            reconnectionDelayMax: 15000,
            reconnectionAttempts: Infinity,
            timeout: 20000,
        });

        const s = this.socket;

        s.on('connect', () => {
            this.connected = true;
            this.reconnectAttempts = 0;
            log.connected(this.serverUrl);
            this.emit('connected');
        });

        s.on('disconnect', (reason) => {
            this.connected = false;
            log.disconnected();
            this.emit('disconnected', reason);
        });

        s.on('connect_error', (err) => {
            this.reconnectAttempts++;
            if (this.reconnectAttempts <= 2) {
                log.error(`No se pudo conectar: ${err.message}`);
            }
            this.emit('connect_error', err);
        });

        // ── Incoming events from mobile ──────────────────────────────────────

        // User sent a message from mobile → show in terminal
        s.on('user_message', (msg) => {
            this.emit('user_message', msg);
        });

        // Mobile resolved an approval
        s.on('approval_resolved', (data) => {
            log.approvalResult(data.action, data.approval?.title || '');
            this.emit('approval_resolved', data);
        });

        // Agent status echo (shouldn't happen for agent, but handle gracefully)
        s.on('agent_status', () => { });

        return this;
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    isConnected() { return this.connected && this.socket?.connected; }
}

module.exports = AgentConnector;
