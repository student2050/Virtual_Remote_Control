/* ═══════════════════════════════════════════════════════════════════════════
   ANTIGRAVITY REMOTE — App Logic
   Socket.io + JWT Auth + Real-time Chat/Approvals/Activity
═══════════════════════════════════════════════════════════════════════════ */

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
    user: null,
    workspaceId: null,
    accessToken: null,
    refreshToken: null,
    apiKey: null,
    messages: [],
    approvals: [],
    activities: [],
    agentOnline: false,
    socket: null,
    currentTab: 'chat',
    currentApproval: null,  // for modal
    timerInterval: null,
    apiKeyRevealed: false,
};

// ─── Storage ──────────────────────────────────────────────────────────────────
const storage = {
    save() {
        localStorage.setItem('ag_auth', JSON.stringify({
            user: state.user,
            workspaceId: state.workspaceId,
            accessToken: state.accessToken,
            refreshToken: state.refreshToken,
            apiKey: state.apiKey,
        }));
    },
    load() {
        try {
            const d = JSON.parse(localStorage.getItem('ag_auth') || 'null');
            if (d) {
                state.user = d.user;
                state.workspaceId = d.workspaceId;
                state.accessToken = d.accessToken;
                state.refreshToken = d.refreshToken;
                state.apiKey = d.apiKey;
                return true;
            }
        } catch { }
        return false;
    },
    clear() {
        localStorage.removeItem('ag_auth');
    }
};

// ─── API Client ───────────────────────────────────────────────────────────────
const api = {
    async request(method, path, body, retry = true, attempts = 1) {
        const opts = {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(state.accessToken ? { 'Authorization': `Bearer ${state.accessToken}` } : {}),
                ...(state.workspaceId ? { 'X-Workspace-Id': state.workspaceId } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        };

        let res;
        try {
            res = await fetch(path, { ...opts, signal: AbortSignal.timeout(60000) });
        } catch (err) {
            // Network error (server cold start, no internet) — throw to let caller handle
            throw err;
        }

        if (res.status === 401 && retry) {
            const refreshed = await this.refreshToken();
            if (refreshed) return this.request(method, path, body, false);
            logout();
            return null;
        }

        return res.json().catch(() => null);
    },

    async refreshToken() {
        if (!state.refreshToken) return false;
        try {
            const res = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: state.refreshToken }),
                signal: AbortSignal.timeout(20000),
            });
            if (!res.ok) return false;
            const data = await res.json();
            state.accessToken = data.accessToken;
            state.refreshToken = data.refreshToken;
            storage.save();
            return true;
        } catch { return false; }
    },

    get: (path) => api.request('GET', path),
    post: (path, body) => api.request('POST', path, body),
    delete: (path) => api.request('DELETE', path),
};

// Helper: retry a fetch-based call with countdown UX
async function retryWithCountdown(fn, errEl, maxRetries = 4) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt === maxRetries) throw err;
            // Cold start: server waking up (Render free tier), wait and retry
            const waitSec = attempt * 10;
            for (let i = waitSec; i > 0; i--) {
                errEl.textContent = `⏳ Servidor iniciando (puede tardar ~30s)... reintentando en ${i}s`;
                errEl.classList.remove('hidden');
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }
}

// ─── Auth Functions ───────────────────────────────────────────────────────────
async function handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-login');
    const errEl = document.getElementById('login-error');
    setLoading(btn, true);
    errEl.classList.add('hidden');

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        const data = await retryWithCountdown(
            () => api.post('/api/auth/login', { email, password }),
            errEl
        );
        if (!data) throw new Error('no response');
        if (data.error) {
            errEl.textContent = data.error;
            errEl.classList.remove('hidden');
            return;
        }
        applyAuth(data);
        initApp();
    } catch (err) {
        errEl.textContent = '⚠️ No se pudo conectar. Si el servidor está iniciando, espera 30s y toca Entrar de nuevo.';
        errEl.classList.remove('hidden');
    } finally {
        setLoading(btn, false);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-register');
    const errEl = document.getElementById('reg-error');
    setLoading(btn, true);
    errEl.classList.add('hidden');

    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    try {
        const data = await api.post('/api/auth/register', { name, email, password });
        if (data.error) {
            errEl.textContent = data.error;
            errEl.classList.remove('hidden');
            return;
        }
        applyAuth(data);
        initApp();
    } catch {
        errEl.textContent = 'Error de conexión.';
        errEl.classList.remove('hidden');
    } finally {
        setLoading(btn, false);
    }
}

function applyAuth(data) {
    state.user = data.user;
    state.workspaceId = data.user.workspaceId || (data.workspaces?.[0]?.id);
    state.accessToken = data.accessToken;
    state.refreshToken = data.refreshToken;
    state.apiKey = data.apiKey || null;
    storage.save();
}

function logout() {
    if (state.socket) state.socket.disconnect();
    api.post('/api/auth/logout', { refreshToken: state.refreshToken });
    storage.clear();
    Object.assign(state, {
        user: null, workspaceId: null, accessToken: null,
        refreshToken: null, apiKey: null, messages: [], approvals: [],
        activities: [], agentOnline: false, socket: null,
    });
    showScreen('auth');
}

function switchAuthTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('form-login').classList.toggle('hidden', !isLogin);
    document.getElementById('form-register').classList.toggle('hidden', isLogin);
    document.getElementById('tab-login').classList.toggle('active', isLogin);
    document.getElementById('tab-register').classList.toggle('active', !isLogin);
}

// ─── App Initialization ───────────────────────────────────────────────────────
function initApp() {
    showScreen('app');
    renderSettings();
    connectSocket();
    loadMessages();
    loadApprovals();
    loadActivity();
}

function showScreen(name) {
    document.getElementById('screen-auth').classList.toggle('active', name === 'auth');
    document.getElementById('screen-auth').classList.toggle('hidden', name !== 'auth');
    document.getElementById('screen-app').classList.toggle('active', name === 'app');
    document.getElementById('screen-app').classList.toggle('hidden', name !== 'app');
}

// ─── Socket.io ────────────────────────────────────────────────────────────────
function connectSocket() {
    if (state.socket) state.socket.disconnect();

    updateConnectionStatus('connecting');

    state.socket = io({
        auth: { token: state.accessToken, workspaceId: state.workspaceId },
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionAttempts: Infinity,
    });

    const s = state.socket;

    s.on('connect', () => {
        updateConnectionStatus('connected');
        document.getElementById('info-ws').textContent = '🟢 Conectado';
    });

    s.on('disconnect', () => {
        updateConnectionStatus('disconnected');
        document.getElementById('info-ws').textContent = '🔴 Desconectado';
    });

    s.on('connect_error', () => {
        updateConnectionStatus('disconnected');
    });

    s.on('init', (data) => {
        if (data.messages) {
            state.messages = data.messages;
            renderMessages();
        }
        if (data.activities) {
            state.activities = data.activities;
            renderActivity();
        }
        if (data.pendingApprovals) {
            state.approvals = data.pendingApprovals;
            renderApprovals();
        }
        setAgentStatus(data.agentOnline);
    });

    s.on('new_message', (msg) => {
        // Avoid duplicates by ID
        if (state.messages.find(m => m.id === msg.id)) return;
        // Replace optimistic user message (temp-ID) with real server message
        if (msg.role === 'user') {
            const tempIdx = state.messages.findIndex(m => m.id?.startsWith('temp-') && m.content === msg.content);
            if (tempIdx !== -1) {
                state.messages[tempIdx] = msg; // swap temp → real
                return; // already displayed
            }
        }
        state.messages.push(msg);
        appendMessage(msg);
        if (msg.role !== 'user' && state.currentTab !== 'chat') {
            showToast('💬 Nuevo mensaje del agente', 'info');
        }
    });

    s.on('approval_request', (approval) => {
        if (!state.approvals.find(a => a.id === approval.id)) {
            state.approvals.unshift(approval);
            renderApprovals();
            updateApprovalBadge();
            // Vibrate if available
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            showToast(`🔐 Aprobación requerida: ${approval.title}`, 'info');
        }
    });

    s.on('approval_resolved', ({ approvalId, action }) => {
        state.approvals = state.approvals.filter(a => a.id !== approvalId);
        renderApprovals();
        updateApprovalBadge();
        if (state.currentApproval?.id === approvalId) closeApprovalModal();
    });

    s.on('new_activity', (activity) => {
        state.activities.unshift(activity);
        if (state.activities.length > 100) state.activities.pop();
        if (state.currentTab === 'activity') renderActivity();
    });

    s.on('agent_status', ({ online }) => {
        setAgentStatus(online);
        showToast(online ? '🟢 Agente conectado desde tu Mac' : '🔴 Agente desconectado', online ? 'success' : 'info');
    });

    s.on('auth_error', ({ code, message }) => {
        if (code === 'STALE_SESSION' || code === 'INVALID_TOKEN') {
            // Server restarted and DB was wiped — force re-login to get fresh workspaceId
            showToast('Sesión expirada, inicia sesión de nuevo', 'info');
            setTimeout(() => logout(), 1500);
        }
    });
}

// ─── Status Indicators ────────────────────────────────────────────────────────
function updateConnectionStatus(status) {
    const dot = document.getElementById('status-dot');
    const txt = document.getElementById('status-text');
    const pill = document.getElementById('agent-status-pill');
    dot.className = 'status-dot';
    if (status === 'connected') {
        dot.classList.add('connecting');
        txt.textContent = state.agentOnline ? 'Agente activo' : 'Conectado';
    } else if (status === 'disconnected') {
        dot.classList.add('offline');
        txt.textContent = 'Sin conexión';
    } else {
        dot.classList.add('connecting');
        txt.textContent = 'Conectando...';
    }
}

function setAgentStatus(online) {
    state.agentOnline = online;
    const dot = document.getElementById('status-dot');
    const txt = document.getElementById('status-text');
    dot.className = 'status-dot ' + (online ? 'online' : 'offline');
    txt.textContent = online ? 'Agente activo' : 'Agente offline';
    document.getElementById('info-agent').textContent = online ? '🟢 Conectado' : '🔴 Desconectado';
}

// ─── Messages ─────────────────────────────────────────────────────────────────
async function loadMessages() {
    try {
        const data = await api.get(`/api/workspaces/${state.workspaceId}/messages?limit=60`);
        if (data?.messages) {
            state.messages = data.messages;
            renderMessages();
        }
    } catch (e) {
        console.warn('Network error loading messages');
    }
}

function renderMessages() {
    const list = document.getElementById('messages-list');
    const empty = document.getElementById('messages-empty');

    if (state.messages.length === 0) {
        list.innerHTML = '';
        list.appendChild(empty);
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    list.innerHTML = '';
    state.messages.forEach(m => {
        const el = buildMessageEl(m);
        list.appendChild(el);
    });
    list.scrollTop = list.scrollHeight;
}

function appendMessage(msg) {
    const empty = document.getElementById('messages-empty');
    empty.classList.add('hidden');
    const el = buildMessageEl(msg);
    const list = document.getElementById('messages-list');
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
}

function buildMessageEl(msg) {
    const wrapper = document.createElement('div');
    wrapper.className = `msg-wrapper ${msg.role}`;
    wrapper.id = `msg-${msg.id}`;

    const time = formatTime(msg.created_at);

    if (msg.role === 'agent') {
        wrapper.innerHTML = `
      <div class="msg-sender"><span class="sender-dot"></span> Antigravity</div>
      <div class="msg-bubble">${escapeHtml(msg.content)}</div>
      <div class="msg-time">${time}</div>`;
    } else if (msg.role === 'user') {
        wrapper.innerHTML = `
      <div class="msg-bubble">${escapeHtml(msg.content)}</div>
      <div class="msg-time">${time}</div>`;
    } else if (msg.role === 'system') {
        // Check if it's an approval message
        const meta = JSON.parse(msg.metadata || '{}');
        if (meta.approvalId) {
            const approval = state.approvals.find(a => a.id === meta.approvalId);
            const resolved = !approval || approval.status !== 'pending';
            wrapper.innerHTML = `
        <div class="msg-bubble">
          ${escapeHtml(msg.content)}
          ${!resolved ? `
          <div class="msg-approval-card" onclick="openApprovalModal('${meta.approvalId}')">
            <div class="approval-card-title">Toca para revisar →</div>
            <div class="approval-card-actions">
              <button class="btn-reject-sm" onclick="event.stopPropagation(); quickResolve('${meta.approvalId}','rejected')">✕ Rechazar</button>
              <button class="btn-approve-sm" onclick="event.stopPropagation(); quickResolve('${meta.approvalId}','approved')">✓ Aprobar</button>
            </div>
          </div>` : `<div style="color:var(--text-muted);font-size:12px;margin-top:8px">✅ Resuelta</div>`}
        </div>
        <div class="msg-time">${time}</div>`;
        } else {
            wrapper.innerHTML = `
        <div class="msg-bubble">${escapeHtml(msg.content)}</div>
        <div class="msg-time">${time}</div>`;
        }
    }

    return wrapper;
}

async function sendMessage() {
    const input = document.getElementById('msg-input');
    const content = input.value.trim();
    if (!content) return;

    input.value = '';
    autoResize(input);

    // Optimistic UI update — show message immediately
    const tempId = 'temp-' + Date.now();
    const optimisticMsg = {
        id: tempId,
        content,
        role: 'user',
        message_type: 'text',
        metadata: '{}',
        created_at: new Date().toISOString(),
    };
    state.messages.push(optimisticMsg);
    appendMessage(optimisticMsg);

    if (state.socket?.connected) {
        state.socket.emit('send_message', { content });
    } else {
        // Fallback to REST
        await api.post(`/api/workspaces/${state.workspaceId}/messages`, { content });
    }
}

function sendQuick(text) {
    document.getElementById('msg-input').value = text;
    sendMessage();
}

function handleInputKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ─── Approvals ────────────────────────────────────────────────────────────────
async function loadApprovals() {
    try {
        const data = await api.get(`/api/workspaces/${state.workspaceId}/approvals?status=pending`);
        if (data?.approvals) {
            state.approvals = data.approvals;
            renderApprovals();
            updateApprovalBadge();
        }
    } catch (e) {
        console.warn('Network error loading approvals');
    }
}

function renderApprovals() {
    const list = document.getElementById('approvals-list');
    const empty = document.getElementById('approvals-empty');
    const label = document.getElementById('approvals-count-label');
    const pending = state.approvals.filter(a => a.status === 'pending');

    label.textContent = `Pendientes: ${pending.length}`;

    if (pending.length === 0) {
        list.innerHTML = '';
        list.appendChild(empty);
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    list.innerHTML = '';
    pending.forEach(a => {
        list.appendChild(buildApprovalCard(a));
    });
}

function buildApprovalCard(a) {
    const el = document.createElement('div');
    el.className = `approval-item risk-${a.risk_level}`;
    el.id = `approval-${a.id}`;
    const riskLabels = { low: 'BAJO', medium: 'MEDIO', high: 'ALTO', critical: 'CRÍTICO' };
    const expiresIn = getExpiresIn(a.expires_at);

    el.innerHTML = `
    <div class="approval-risk-stripe"></div>
    <div class="approval-body">
      <span class="approval-risk-tag">${riskLabels[a.risk_level] || a.risk_level}</span>
      <div class="approval-title">${escapeHtml(a.title)}</div>
      ${a.description ? `<div class="approval-desc">${escapeHtml(a.description)}</div>` : ''}
      ${a.command ? `<div class="approval-command">${escapeHtml(a.command)}</div>` : ''}
      <div class="approval-footer">
        <span class="approval-timer">⏱ ${expiresIn}</span>
        <div class="approval-btns">
          <button class="btn-reject-sm" onclick="quickResolve('${a.id}','rejected')">✕ Rechazar</button>
          <button class="btn-approve-sm" onclick="quickResolve('${a.id}','approved')">✓ Aprobar</button>
        </div>
      </div>
    </div>`;

    el.addEventListener('click', (e) => {
        if (!e.target.closest('button')) openApprovalModal(a.id);
    });
    return el;
}

function updateApprovalBadge() {
    const count = state.approvals.filter(a => a.status === 'pending').length;
    const badge = document.getElementById('approval-badge');
    const navBadge = document.getElementById('nav-approvals-badge');
    if (count > 0) {
        badge.textContent = count; badge.style.display = '';
        navBadge.textContent = count; navBadge.style.display = '';
    } else {
        badge.style.display = 'none';
        navBadge.style.display = 'none';
    }
}

async function quickResolve(approvalId, action) {
    const approval = state.approvals.find(a => a.id === approvalId);
    if (!approval) return;

    if (state.socket?.connected) {
        state.socket.emit('resolve_approval', { approvalId, action });
    } else {
        await api.post(`/api/workspaces/${state.workspaceId}/approvals/${approvalId}/resolve`, { action });
    }

    state.approvals = state.approvals.filter(a => a.id !== approvalId);
    renderApprovals();
    updateApprovalBadge();
    renderMessages(); // refresh approval cards in chat
    showToast(action === 'approved' ? '✅ Aprobado' : '❌ Rechazado', action === 'approved' ? 'success' : 'info');
}

function openApprovalModal(approvalId) {
    const approval = state.approvals.find(a => a.id === approvalId);
    if (!approval) return;

    state.currentApproval = approval;
    const riskLabels = { low: '✅ RIESGO BAJO', medium: '⚠️ RIESGO MEDIO', high: '🚨 RIESGO ALTO', critical: '💀 CRÍTICO' };
    const riskClass = `risk-${approval.risk_level}`;

    document.getElementById('modal-title').textContent = approval.title;
    document.getElementById('modal-desc').textContent = approval.description || 'El agente solicita tu permiso para continuar.';
    document.getElementById('modal-risk-label').textContent = riskLabels[approval.risk_level] || approval.risk_level.toUpperCase();
    document.getElementById('modal-risk-banner').className = `modal-risk-banner ${riskClass}`;

    const cmdBlock = document.getElementById('modal-command-block');
    if (approval.command) {
        document.getElementById('modal-command').textContent = approval.command;
        cmdBlock.style.display = '';
    } else {
        cmdBlock.style.display = 'none';
    }

    startModalTimer(approval.expires_at);
    document.getElementById('approval-modal').classList.remove('hidden');
}

function closeApprovalModal(event) {
    if (event && event.target !== document.getElementById('approval-modal')) return;
    document.getElementById('approval-modal').classList.add('hidden');
    clearInterval(state.timerInterval);
    state.currentApproval = null;
}

function startModalTimer(expiresAt) {
    clearInterval(state.timerInterval);
    const total = new Date(expiresAt) - new Date(state.currentApproval?.created_at || Date.now());

    function update() {
        const remaining = new Date(expiresAt) - Date.now();
        if (remaining <= 0) {
            clearInterval(state.timerInterval);
            document.getElementById('modal-timer-text').textContent = 'Expirada';
            document.getElementById('timer-fill').style.width = '0%';
            closeApprovalModal();
            return;
        }
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        document.getElementById('modal-timer-text').textContent = `Expira en ${mins}:${secs.toString().padStart(2, '0')}`;
        const pct = Math.max(0, (remaining / total) * 100);
        document.getElementById('timer-fill').style.width = pct + '%';
    }
    update();
    state.timerInterval = setInterval(update, 1000);
}

async function resolveApproval(action) {
    if (!state.currentApproval) return;
    await quickResolve(state.currentApproval.id, action);
    closeApprovalModal();
}

// ─── Activity ─────────────────────────────────────────────────────────────────
async function loadActivity() {
    try {
        const data = await api.get(`/api/workspaces/${state.workspaceId}/activity?limit=60`);
        if (data?.activities) {
            state.activities = data.activities;
            renderActivity();
        }
    } catch (e) {
        console.warn('Network error loading activity');
    }
}

function renderActivity() {
    const list = document.getElementById('activity-list');
    const empty = document.getElementById('activity-empty');

    if (state.activities.length === 0) {
        list.innerHTML = '';
        list.appendChild(empty);
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    list.innerHTML = '';
    state.activities.forEach(a => {
        const el = document.createElement('div');
        el.className = 'activity-item';
        el.innerHTML = `
      <div class="activity-icon">${a.icon || '📌'}</div>
      <div class="activity-content">
        <div class="activity-title">${escapeHtml(a.title)}</div>
        ${a.description ? `<div class="activity-desc">${escapeHtml(a.description)}</div>` : ''}
        <div class="activity-time">${formatTime(a.created_at)}</div>
      </div>`;
        list.appendChild(el);
    });
}

// ─── Settings ────────────────────────────────────────────────────────────────
function renderSettings() {
    if (!state.user) return;
    const u = state.user;
    const initials = (u.name || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    document.getElementById('settings-avatar').textContent = initials;
    document.getElementById('settings-name').textContent = u.name || '—';
    document.getElementById('settings-email').textContent = u.email || '—';
    document.getElementById('settings-plan').textContent = (u.plan || 'free').toUpperCase();
    document.getElementById('header-workspace-name').textContent = u.name ? `${u.name.split(' ')[0]}'s Space` : 'Workspace';
    document.getElementById('info-server').textContent = window.location.host;
    document.getElementById('info-plan').textContent = u.plan || 'free';

    if (state.apiKey) {
        const masked = `ag_${'•'.repeat(24)}${state.apiKey.replace('ag_', '').slice(-8)}`;
        document.getElementById('api-key-display').textContent = masked;
        const serverUrl = window.location.origin;
        document.getElementById('install-cmd').textContent =
            `AG_KEY=${state.apiKey} AG_SERVER=${serverUrl} npx @antigravity/agent`;
    }
}

function toggleApiKey() {
    const el = document.getElementById('api-key-display');
    if (!state.apiKey) return;
    state.apiKeyRevealed = !state.apiKeyRevealed;
    if (state.apiKeyRevealed) {
        el.textContent = state.apiKey;
        document.getElementById('btn-reveal-key').textContent = '🙈';
        // Auto-hide after 10s
        setTimeout(() => {
            state.apiKeyRevealed = false;
            const masked = `ag_${'•'.repeat(24)}${state.apiKey.replace('ag_', '').slice(-8)}`;
            el.textContent = masked;
            document.getElementById('btn-reveal-key').textContent = '👁';
        }, 10000);
    } else {
        const masked = `ag_${'•'.repeat(24)}${state.apiKey.replace('ag_', '').slice(-8)}`;
        el.textContent = masked;
        document.getElementById('btn-reveal-key').textContent = '👁';
    }
}

function copyApiKey() {
    if (!state.apiKey) return;
    navigator.clipboard.writeText(state.apiKey).then(() => {
        showToast('🔑 API key copiada', 'success');
    });
}

function copyInstallCmd() {
    const cmd = document.getElementById('install-cmd').textContent;
    navigator.clipboard.writeText(cmd).then(() => {
        showToast('📋 Comando copiado', 'success');
    });
}

// ─── Tab Navigation ───────────────────────────────────────────────────────────
function switchTab(tab) {
    state.currentTab = tab;
    ['chat', 'approvals', 'activity', 'settings'].forEach(t => {
        document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
        document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tab);
        document.getElementById(`nav-${t}`).classList.toggle('active', t === tab);
    });

    if (tab === 'activity') loadActivity();
    if (tab === 'chat') {
        const list = document.getElementById('messages-list');
        setTimeout(() => list.scrollTop = list.scrollHeight, 100);
    }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-8px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setLoading(btn, loading) {
    btn.disabled = loading;
    btn.querySelector('.btn-text').classList.toggle('hidden', loading);
    btn.querySelector('.btn-spinner').classList.toggle('hidden', !loading);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
        .replace(/\n/g, '<br/>');
}

function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'ahora';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return d.toLocaleDateString('es', { month: 'short', day: 'numeric' });
}

function getExpiresIn(expiresAt) {
    const remaining = new Date(expiresAt) - Date.now();
    if (remaining <= 0) return 'Expirada';
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (storage.load() && state.accessToken) {
        initApp();
    }
    // Register service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => { });
    }
});
