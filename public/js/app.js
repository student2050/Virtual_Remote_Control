/* ═══════════════════════════════════════════════════════════════════
   Samsung TV Virtual Remote Control v2.0 - Direct Connection
   Connects directly from browser/app to Samsung TV via WebSocket
   No backend server needed for TV control
   ═══════════════════════════════════════════════════════════════════ */

// Samsung TV Key Map
const TV_KEY_MAP = {
    power: 'KEY_POWER',
    powerOff: 'KEY_POWEROFF',
    volumeUp: 'KEY_VOLUP',
    volumeDown: 'KEY_VOLDOWN',
    mute: 'KEY_MUTE',
    channelUp: 'KEY_CHUP',
    channelDown: 'KEY_CHDOWN',
    up: 'KEY_UP',
    down: 'KEY_DOWN',
    left: 'KEY_LEFT',
    right: 'KEY_RIGHT',
    enter: 'KEY_ENTER',
    back: 'KEY_RETURN',
    home: 'KEY_HOME',
    source: 'KEY_SOURCE',
    menu: 'KEY_MENU',
    guide: 'KEY_GUIDE',
    tools: 'KEY_TOOLS',
    info: 'KEY_INFO',
    exit: 'KEY_EXIT',
    num0: 'KEY_0', num1: 'KEY_1', num2: 'KEY_2', num3: 'KEY_3',
    num4: 'KEY_4', num5: 'KEY_5', num6: 'KEY_6', num7: 'KEY_7',
    num8: 'KEY_8', num9: 'KEY_9',
    play: 'KEY_PLAY', pause: 'KEY_PAUSE', stop: 'KEY_STOP',
    rewind: 'KEY_REWIND', fastForward: 'KEY_FF',
    red: 'KEY_RED', green: 'KEY_GREEN', yellow: 'KEY_YELLOW', blue: 'KEY_BLUE',
    hdmi: 'KEY_HDMI', sleep: 'KEY_SLEEP',
    pictureSize: 'KEY_PICTURE_SIZE',
    channelList: 'KEY_CH_LIST',
    panelPower: 'KEY_PANEL_POWER',
};

// APP_NAME used to identify with the TV (SmartThings is auto-trusted)
const APP_NAME = 'SmartThings';
const APP_NAME_BASE64 = btoa(APP_NAME);

class SamsungRemote {
    constructor() {
        this.tvIp = localStorage.getItem('tvIp') || '';
        this.tvPort = parseInt(localStorage.getItem('tvPort')) || 8002;
        this.tvMac = localStorage.getItem('tvMac') || '';
        this.tvToken = localStorage.getItem('tvToken') || '';
        this.connected = false;
        this.tvWs = null;          // Direct WebSocket to TV
        this._reconnecting = false;

        this.init();
    }

    // ─── Initialization ─────────────────────────────────────────────
    init() {
        this.cacheElements();
        this.bindEvents();
        this.loadSavedSettings();
        this.setupServiceWorkerRegistration();

        // Check if we have saved connection
        if (this.tvIp) {
            this.tvIpInput.value = this.tvIp;
            this.tvPortInput.value = this.tvPort;
            this.tvMacInput.value = this.tvMac;
        }
    }

    // ─── Cache DOM Elements ─────────────────────────────────────────
    cacheElements() {
        // Modal
        this.connectionModal = document.getElementById('connectionModal');
        this.tvIpInput = document.getElementById('tvIpInput');
        this.tvPortInput = document.getElementById('tvPortInput');
        this.tvMacInput = document.getElementById('tvMacInput');
        this.connectBtn = document.getElementById('connectBtn');
        this.connectionError = document.getElementById('connectionError');

        // Scanner
        this.scanBtn = document.getElementById('scanBtn');
        this.scanBtnContent = document.getElementById('scanBtnContent');
        this.scanBtnLoading = document.getElementById('scanBtnLoading');
        this.scanProgress = document.getElementById('scanProgress');
        this.scanProgressFill = document.getElementById('scanProgressFill');
        this.scanProgressText = document.getElementById('scanProgressText');
        this.scanResults = document.getElementById('scanResults');
        this.scanResultsTitle = document.getElementById('scanResultsTitle');
        this.scanResultsList = document.getElementById('scanResultsList');
        this.scanResultsClose = document.getElementById('scanResultsClose');

        // App
        this.remoteApp = document.getElementById('remoteApp');
        this.statusIndicator = document.getElementById('statusIndicator');
        this.tvNameDisplay = document.getElementById('tvName');
        this.tvIpDisplay = document.getElementById('tvIpDisplay');
        this.disconnectBtn = document.getElementById('disconnectBtn');
        this.settingsBtn = document.getElementById('settingsBtn');

        // Remote buttons
        this.remoteButtons = document.querySelectorAll('[data-key]');
        this.appButtons = document.querySelectorAll('[data-app]');

        // Tabs
        this.tabButtons = document.querySelectorAll('.tab-btn');
        this.tabContents = document.querySelectorAll('.tab-content');
    }

    // ─── Event Binding ──────────────────────────────────────────────
    bindEvents() {
        // Connect button
        this.connectBtn?.addEventListener('click', () => this.handleConnect());

        // Enter key on inputs
        [this.tvIpInput, this.tvPortInput, this.tvMacInput].forEach(input => {
            input?.addEventListener('keypress', e => {
                if (e.key === 'Enter') this.handleConnect();
            });
        });

        // Remote key buttons
        this.remoteButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.handleKeyPress(btn.dataset.key, e);
                this.createRipple(e, btn);
            });
        });

        // App buttons
        this.appButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.handleAppLaunch(btn.dataset.app);
                this.createRipple(e, btn);
            });
        });

        // Disconnect
        this.disconnectBtn?.addEventListener('click', () => this.handleDisconnect());
        this.settingsBtn?.addEventListener('click', () => {
            this.connected = false;
            this.showConnectionModal();
        });

        // Tab switching
        this.tabButtons.forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', e => this.handleKeyboardShortcut(e));

        // Scanner
        this.scanBtn?.addEventListener('click', () => this.handleScan());
        this.scanResultsClose?.addEventListener('click', () => {
            this.scanResults.style.display = 'none';
        });
    }

    // ─── Direct WebSocket Connection to TV ──────────────────────────
    async handleConnect() {
        const ip = this.tvIpInput.value.trim();
        const port = parseInt(this.tvPortInput.value) || 8002;
        const mac = this.tvMacInput.value.trim();

        if (!ip) {
            this.showError('Por favor ingresa la dirección IP del TV');
            this.tvIpInput.focus();
            return;
        }

        // Validate IP format
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipRegex.test(ip)) {
            this.showError('Formato de IP inválido. Ejemplo: 192.168.1.100');
            return;
        }

        // Validate it's a real device IP (not multicast, broadcast, etc.)
        const parts = ip.split('.').map(Number);
        if (parts[0] >= 224 || parts[0] === 0 || parts[0] === 127 || parts[3] === 255 || parts[3] === 0) {
            this.showError('Esa IP no es un dispositivo válido. Selecciona una IP de tu red local (ej: 192.168.1.x)');
            return;
        }

        this.setConnecting(true);
        this.showToast('📺 Conectando al TV...', 'info');

        try {
            await this.connectWebSocket(ip, port);

            this.tvIp = ip;
            this.tvPort = port;
            this.tvMac = mac;
            this.connected = true;

            // Save settings
            localStorage.setItem('tvIp', ip);
            localStorage.setItem('tvPort', port.toString());
            localStorage.setItem('tvMac', mac);

            // Show remote
            this.showRemote();
            this.showToast('✅ Conectado al TV Samsung', 'success');

            // Start connection monitoring
            this.startConnectionMonitor();
        } catch (error) {
            console.error('Connection error:', error);
            this.showError(error.message || 'No se pudo conectar al TV');
        }

        this.setConnecting(false);
    }

    // ─── WebSocket Connection (Direct to TV) ────────────────────────
    connectWebSocket(ip, port) {
        return new Promise((resolve, reject) => {
            // Close existing connection
            if (this.tvWs) {
                try { this.tvWs.close(); } catch (e) { }
                this.tvWs = null;
            }

            const protocol = port === 8002 ? 'wss' : 'ws';

            // Build URL with saved token if available
            let url = `${protocol}://${ip}:${port}/api/v2/channels/samsung.remote.control?name=${APP_NAME_BASE64}`;
            if (this.tvToken) {
                url += `&token=${this.tvToken}`;
            }

            console.log(`🔌 Connecting to TV at ${ip}:${port}...`);

            const ws = new WebSocket(url);
            let resolved = false;

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    ws.close();

                    // If we used a token and it failed, retry without token
                    if (this.tvToken) {
                        console.log('⚠️ Token connection timed out, retrying without token...');
                        this.tvToken = '';
                        localStorage.removeItem('tvToken');
                        this.connectWebSocket(ip, port).then(resolve).catch(reject);
                    } else {
                        reject(new Error('Tiempo de espera agotado. Verifica que el TV esté encendido y en la misma red WiFi.'));
                    }
                }
            }, 15000);

            ws.onopen = () => {
                console.log('✅ WebSocket opened to TV');
            };

            ws.onmessage = (event) => {
                try {
                    const response = JSON.parse(event.data);
                    console.log('📺 TV Event:', response.event);

                    if (response.event === 'ms.channel.connect') {
                        clearTimeout(timeout);
                        if (!resolved) {
                            resolved = true;
                            this.tvWs = ws;

                            // Save token for future reconnections
                            if (response.data?.token) {
                                this.tvToken = response.data.token;
                                localStorage.setItem('tvToken', response.data.token);
                                console.log('🔑 Token saved');
                            }

                            // Try to get TV name
                            if (response.data?.clients) {
                                console.log('📺 Connected clients:', response.data.clients.length);
                            }

                            resolve();
                        }
                    } else if (response.event === 'ms.channel.unauthorized') {
                        clearTimeout(timeout);
                        if (!resolved) {
                            resolved = true;
                            ws.close();
                            // Clear invalid token and retry
                            this.tvToken = '';
                            localStorage.removeItem('tvToken');
                            this.connectWebSocket(ip, port).then(resolve).catch(reject);
                        }
                    }
                } catch (e) {
                    console.error('Error parsing TV response:', e);
                }
            };

            ws.onerror = (error) => {
                console.error('❌ WebSocket Error:', error);
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;

                    // If WSS failed, suggest trying WS on 8001
                    if (port === 8002) {
                        reject(new Error('Error de conexión SSL. Intenta cambiar el puerto a 8001.'));
                    } else {
                        reject(new Error('No se puede conectar al TV. Verifica la IP y que estés en la misma red WiFi.'));
                    }
                }
            };

            ws.onclose = () => {
                console.log('📺 WebSocket closed');
                if (this.tvWs === ws) {
                    this.tvWs = null;
                    if (this.connected) {
                        this.connected = false;
                        this.updateConnectionStatus();
                        this.showToast('📺 Conexión perdida con el TV', 'error');
                        // Auto-reconnect
                        if (!this._reconnecting) {
                            setTimeout(() => this.tryReconnect(), 3000);
                        }
                    }
                }
            };
        });
    }

    // ─── Disconnect ─────────────────────────────────────────────────
    handleDisconnect() {
        if (this.tvWs) {
            try { this.tvWs.close(); } catch (e) { }
            this.tvWs = null;
        }

        this.connected = false;
        this.stopConnectionMonitor();
        this.showConnectionModal();
        this.showToast('🔌 Desconectado del TV', 'info');
    }

    // ─── Key Press Handling (Direct WebSocket) ──────────────────────
    handleKeyPress(key, event) {
        if (!this.connected || !this.tvWs) {
            this.showToast('⚠️ No estás conectado al TV', 'error');
            return;
        }

        // Haptic feedback
        if ('vibrate' in navigator) {
            navigator.vibrate(30);
        }

        const tvKey = TV_KEY_MAP[key];
        if (!tvKey) {
            console.error('Unknown key:', key);
            return;
        }

        try {
            const command = JSON.stringify({
                method: 'ms.remote.control',
                params: {
                    Cmd: 'Click',
                    DataOfCmd: tvKey,
                    Option: 'false',
                    TypeOfRemote: 'SendRemoteKey',
                },
            });

            this.tvWs.send(command);
            console.log(`🎮 Sent key: ${tvKey}`);
        } catch (error) {
            console.error('Key press error:', error);
            this.connected = false;
            this.updateConnectionStatus();
            this.showToast('📺 Conexión perdida. Reconectando...', 'error');
            this.tryReconnect();
        }
    }

    // ─── App Launch (Direct WebSocket) ──────────────────────────────
    handleAppLaunch(appId) {
        if (!this.connected || !this.tvWs) {
            this.showToast('⚠️ No estás conectado al TV', 'error');
            return;
        }

        if ('vibrate' in navigator) {
            navigator.vibrate(50);
        }

        try {
            const command = JSON.stringify({
                method: 'ms.channel.emit',
                params: {
                    event: 'ed.apps.launch',
                    to: 'host',
                    data: {
                        appId: appId,
                        action_type: 'DEEP_LINK',
                    },
                },
            });

            this.tvWs.send(command);
            this.showToast('📱 Abriendo aplicación...', 'success');
        } catch (error) {
            console.error('App launch error:', error);
        }
    }

    // ─── Keyboard Shortcuts ─────────────────────────────────────────
    handleKeyboardShortcut(e) {
        if (!this.connected) return;
        if (e.target.tagName === 'INPUT') return;

        const shortcuts = {
            'ArrowUp': 'up',
            'ArrowDown': 'down',
            'ArrowLeft': 'left',
            'ArrowRight': 'right',
            'Enter': 'enter',
            'Escape': 'back',
            'Backspace': 'back',
            ' ': 'play',
            '+': 'volumeUp',
            '=': 'volumeUp',
            '-': 'volumeDown',
            'm': 'mute',
            'M': 'mute',
            'h': 'home',
            'H': 'home',
            'p': 'power',
            'P': 'power',
            'i': 'info',
            'I': 'info',
            's': 'source',
            'S': 'source',
            'g': 'guide',
            'G': 'guide',
            'PageUp': 'channelUp',
            'PageDown': 'channelDown',
        };

        // Number keys
        for (let i = 0; i <= 9; i++) {
            shortcuts[i.toString()] = `num${i}`;
        }

        if (shortcuts[e.key]) {
            e.preventDefault();
            this.handleKeyPress(shortcuts[e.key], e);
        }
    }

    // ─── Tab Switching ──────────────────────────────────────────────
    switchTab(tabId) {
        this.tabButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        this.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${tabId}Tab`);
        });
    }

    // ─── UI Helpers ─────────────────────────────────────────────────
    showRemote() {
        this.connectionModal.classList.remove('active');
        this.remoteApp.classList.add('active');
        if (this.tvNameDisplay) this.tvNameDisplay.textContent = 'Samsung TV';
        if (this.tvIpDisplay) this.tvIpDisplay.textContent = this.tvIp;
        this.updateConnectionStatus();

        // Try to fetch TV info via HTTP API for the name
        this.fetchTVInfo();
    }

    async fetchTVInfo() {
        try {
            const response = await fetch(`http://${this.tvIp}:8001/api/v2/`, {
                signal: AbortSignal.timeout(3000)
            });
            const data = await response.json();
            if (data?.device?.name && this.tvNameDisplay) {
                this.tvNameDisplay.textContent = data.device.name;
            }
        } catch (e) {
            // Not critical - TV info is optional
        }
    }

    showConnectionModal() {
        this.remoteApp.classList.remove('active');
        this.connectionModal.classList.add('active');
    }

    updateConnectionStatus() {
        if (this.statusIndicator) {
            this.statusIndicator.className = `status-indicator ${this.connected ? 'connected' : 'disconnected'}`;
        }
    }

    setConnecting(isConnecting) {
        if (this.connectBtn) {
            this.connectBtn.disabled = isConnecting;
            const spinner = this.connectBtn.querySelector('.btn-spinner');
            const text = this.connectBtn.querySelector('.btn-text');
            if (spinner && text) {
                spinner.style.display = isConnecting ? 'block' : 'none';
                text.textContent = isConnecting ? 'Conectando...' : 'Conectar al TV';
            }
        }

        if (this.tvIpInput) this.tvIpInput.disabled = isConnecting;
        if (this.tvPortInput) this.tvPortInput.disabled = isConnecting;
        if (this.tvMacInput) this.tvMacInput.disabled = isConnecting;
    }

    showError(message) {
        if (this.connectionError) {
            this.connectionError.textContent = message;
            this.connectionError.style.display = 'block';
        }
    }

    showToast(message, type = 'info') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    createRipple(event, element) {
        const ripple = document.createElement('span');
        ripple.classList.add('ripple');

        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = event.clientX - rect.left - size / 2;
        const y = event.clientY - rect.top - size / 2;

        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;

        element.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    }

    // ─── Connection Monitoring ──────────────────────────────────────
    startConnectionMonitor() {
        this.stopConnectionMonitor();
        this._monitor = setInterval(() => this.checkConnection(), 10000);
    }

    stopConnectionMonitor() {
        if (this._monitor) {
            clearInterval(this._monitor);
            this._monitor = null;
        }
    }

    checkConnection() {
        // Check if WebSocket is still open
        if (this.tvWs && this.tvWs.readyState === WebSocket.OPEN) {
            if (!this.connected) {
                this.connected = true;
                this.updateConnectionStatus();
            }
        } else if (this.connected) {
            this.connected = false;
            this.updateConnectionStatus();
            this.showToast('📺 Conexión perdida con el TV', 'error');
            this.tryReconnect();
        }
    }

    async tryReconnect() {
        if (this._reconnecting) return;
        this._reconnecting = true;

        try {
            await this.connectWebSocket(this.tvIp, this.tvPort);
            this.connected = true;
            this.updateConnectionStatus();
            this.showToast('✅ Reconectado al TV', 'success');
        } catch (e) {
            console.log('Reconnect failed, will retry...');
            setTimeout(() => {
                this._reconnecting = false;
                if (!this.connected) this.tryReconnect();
            }, 5000);
            return;
        }

        this._reconnecting = false;
    }

    // ─── Load Saved Settings ───────────────────────────────────────
    loadSavedSettings() {
        const savedIp = localStorage.getItem('tvIp');
        if (savedIp) {
            this.tvIpInput.value = savedIp;
            this.tvPortInput.value = localStorage.getItem('tvPort') || '8002';
            this.tvMacInput.value = localStorage.getItem('tvMac') || '';
        }
    }

    // ─── Network Scanner (TV Info Check) ────────────────────────────
    // In v2.0, we can't scan the network from the browser.
    // Instead, we guide the user to find their TV IP
    async handleScan() {
        if (this._scanning) return;
        this._scanning = true;

        // Update button state
        this.scanBtn.disabled = true;
        this.scanBtnContent.style.display = 'none';
        this.scanBtnLoading.style.display = 'flex';

        // Show progress
        this.scanProgress.style.display = 'block';
        this.scanResults.style.display = 'none';
        this.connectionError.style.display = 'none';

        this.scanProgressFill.style.width = '30%';
        this.scanProgressText.textContent = '📡 Buscando TV en la red...';

        // Try common IPs by fetching Samsung TV API
        const subnet = await this.detectSubnet();
        const tvs = [];

        this.scanProgressText.textContent = `🔎 Escaneando ${subnet}x...`;
        this.scanProgressFill.style.width = '50%';

        // Scan common TV IPs (1-30 range is most common for home routers)
        const checkPromises = [];
        for (let i = 1; i <= 254; i++) {
            const ip = `${subnet}${i}`;
            checkPromises.push(this.checkForSamsungTV(ip));
        }

        // Process in batches of 30
        for (let i = 0; i < checkPromises.length; i += 30) {
            const batch = checkPromises.slice(i, i + 30);
            const results = await Promise.all(batch);
            results.forEach(r => { if (r) tvs.push(r); });
            const progress = 50 + (i / checkPromises.length) * 45;
            this.scanProgressFill.style.width = `${progress}%`;
            this.scanProgressText.textContent = `🔎 Escaneando... ${Math.round(progress)}%`;
        }

        this.scanProgressFill.style.width = '100%';

        if (tvs.length > 0) {
            this.scanProgressText.textContent = `✅ ${tvs.length} Samsung TV${tvs.length > 1 ? 's' : ''} encontrado${tvs.length > 1 ? 's' : ''}`;
            setTimeout(() => {
                this.renderScanResults({
                    devices: tvs,
                    samsungTVs: tvs.length,
                    network: { subnet }
                });
                this.scanProgress.style.display = 'none';
            }, 500);
        } else {
            this.scanProgressText.textContent = '❌ No se encontró ningún Samsung TV';
            // Show help message
            this.showError('No se encontró un TV. Ve a Ajustes > Red > Estado de red en tu TV para ver su IP.');
        }

        // Reset button state
        this.scanBtn.disabled = false;
        this.scanBtnContent.style.display = 'flex';
        this.scanBtnLoading.style.display = 'none';
        this._scanning = false;
    }

    async detectSubnet() {
        // Try to determine the local subnet
        // Method: Use WebRTC to detect local IP
        return new Promise((resolve) => {
            try {
                const pc = new RTCPeerConnection({ iceServers: [] });
                pc.createDataChannel('');
                pc.createOffer().then(offer => pc.setLocalDescription(offer));
                pc.onicecandidate = (event) => {
                    if (event && event.candidate && event.candidate.candidate) {
                        const match = event.candidate.candidate.match(/(\d+\.\d+\.\d+\.)\d+/);
                        if (match) {
                            pc.close();
                            resolve(match[1]);
                            return;
                        }
                    }
                };
                // Fallback after timeout
                setTimeout(() => {
                    pc.close();
                    resolve('192.168.1.');
                }, 3000);
            } catch (e) {
                resolve('192.168.1.');
            }
        });
    }

    async checkForSamsungTV(ip) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1500);

            const response = await fetch(`http://${ip}:8001/api/v2/`, {
                signal: controller.signal,
            });

            clearTimeout(timeout);
            const data = await response.json();

            if (data?.device?.type === 'Samsung SmartTV') {
                return {
                    ip: ip,
                    mac: data.device.wifiMac || '',
                    hostname: '',
                    type: 'samsung-tv',
                    label: data.device.name || 'Samsung Smart TV',
                    icon: '📺',
                    isSamsungTV: true,
                    tvInfo: data.device,
                    ports: { samsung_http: true, samsung_wss: true },
                };
            }
        } catch (e) {
            // Not a Samsung TV or unreachable
        }
        return null;
    }

    renderScanResults(data) {
        const { devices, samsungTVs, network } = data;

        // Update title
        this.scanResultsTitle.textContent = samsungTVs > 0
            ? `📺 ${samsungTVs} Samsung TV${samsungTVs > 1 ? 's' : ''} encontrado${samsungTVs > 1 ? 's' : ''}`
            : `${devices.length} dispositivos encontrados`;

        // Build device cards HTML
        if (devices.length === 0) {
            this.scanResultsList.innerHTML = `
                <div class="scan-no-results">
                    <span class="no-results-icon">🔍</span>
                    <p>No se encontraron dispositivos en la red</p>
                    <p style="font-size:0.7rem; margin-top:4px;">Verifica tu conexión WiFi</p>
                </div>
            `;
        } else {
            this.scanResultsList.innerHTML = devices.map(device => {
                const tvName = device.tvInfo?.name || device.label;
                const tvModel = device.tvInfo?.modelName ? ` · ${device.tvInfo.modelName}` : '';
                const details = `${device.ip} · ${device.mac}${tvModel}`;

                return `
                    <div class="device-card samsung-tv" 
                         data-ip="${device.ip}" 
                         data-mac="${device.mac}"
                         data-is-tv="true">
                        <div class="device-card-icon">${device.icon}</div>
                        <div class="device-card-info">
                            <div class="device-card-name">${tvName}</div>
                            <div class="device-card-details">${details}</div>
                        </div>
                        <span class="device-card-badge">Smart TV</span>
                    </div>
                `;
            }).join('');

            // Bind click events to device cards
            this.scanResultsList.querySelectorAll('.device-card').forEach(card => {
                card.addEventListener('click', () => this.selectDevice(card));
            });
        }

        // Show results
        this.scanResults.style.display = 'block';
    }

    selectDevice(card) {
        const ip = card.dataset.ip;
        const mac = card.dataset.mac;

        // Fill in the IP
        this.tvIpInput.value = ip;

        // Fill in MAC if available
        if (mac && mac !== '(incomplete)') {
            this.tvMacInput.value = mac;
        }

        // Visual feedback
        if ('vibrate' in navigator) {
            navigator.vibrate(30);
        }

        // Flash the selected card
        card.style.background = 'rgba(99, 102, 241, 0.2)';
        setTimeout(() => {
            card.style.background = '';
        }, 300);

        this.showToast(`📺 Samsung TV detectado en ${ip}`, 'success');
        // Scroll to connect button
        this.connectBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
            this.connectBtn.classList.add('btn-pressed');
            setTimeout(() => this.connectBtn.classList.remove('btn-pressed'), 150);
        }, 400);
    }

    // ─── PWA Service Worker ─────────────────────────────────────────
    setupServiceWorkerRegistration() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {
                // Service worker registration failed - not critical
            });
        }
    }
}

// ─── Initialize App ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    window.remote = new SamsungRemote();
});
