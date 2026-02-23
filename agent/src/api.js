/**
 * Antigravity Agent — REST API Client
 * Communicates with the Antigravity SaaS backend using the API key
 */

const fetch = require('node-fetch');

class AgentAPI {
    constructor(serverUrl, apiKey) {
        this.serverUrl = serverUrl.replace(/\/$/, '');
        this.apiKey = apiKey;
    }

    async request(method, path, body) {
        try {
            const res = await fetch(`${this.serverUrl}${path}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
                timeout: 10000,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            return res.json();
        } catch (err) {
            throw err;
        }
    }

    // ── Verify API key is valid ──────────────────────────────────────────────
    async verify() {
        return this.request('POST', '/api/agent/ping', {
            hostname: require('os').hostname(),
            platform: `${require('os').type()} ${require('os').arch()}`,
            agentVersion: '1.0.0',
        });
    }

    // ── Send message to mobile ───────────────────────────────────────────────
    async sendMessage(content, messageType = 'text') {
        return this.request('POST', '/api/agent/message', { content, messageType });
    }

    // ── Create approval request ──────────────────────────────────────────────
    async requestApproval({ title, description, command, riskLevel = 'low', expiresInMinutes = 10 }) {
        return this.request('POST', '/api/agent/approval', {
            title, description, command, riskLevel, expiresInMinutes
        });
    }

    // ── Poll approval status ─────────────────────────────────────────────────
    async getApproval(approvalId) {
        return this.request('GET', `/api/agent/approval/${approvalId}`);
    }

    // ── Log activity ─────────────────────────────────────────────────────────
    async logActivity(title, description, icon = '📌', type = 'info') {
        return this.request('POST', '/api/agent/activity', { title, description, icon, type });
    }

    // ── Heartbeat ────────────────────────────────────────────────────────────
    async ping() {
        const os = require('os');
        return this.request('POST', '/api/agent/ping', {
            hostname: os.hostname(),
            platform: `${os.type()} ${os.arch()}`,
            agentVersion: '1.0.0',
        });
    }

    // ── Get inbox (user messages) ────────────────────────────────────────────
    async getInbox(since) {
        const qs = since ? `?since=${encodeURIComponent(since)}` : '';
        return this.request('GET', `/api/agent/inbox${qs}`);
    }
}

/**
 * Wait for an approval to be resolved (polls every 2 seconds)
 * Returns { status: 'approved' | 'rejected' | 'expired' | 'timeout' }
 */
async function waitForApproval(api, approvalId, timeoutMs = 620000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        await sleep(2000);
        try {
            const { approval } = await api.getApproval(approvalId);
            if (approval.status !== 'pending') {
                return approval;
            }
        } catch { }
    }
    return { status: 'timeout' };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { AgentAPI, waitForApproval };
