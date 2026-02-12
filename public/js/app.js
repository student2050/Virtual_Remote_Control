/* ═══════════════════════════════════════════════════════════════════
   Samsung TV Virtual Remote Control - Frontend Application
   ═══════════════════════════════════════════════════════════════════ */

class SamsungRemote {
    constructor() {
        this.tvIp = localStorage.getItem('tvIp') || '';
        this.tvPort = parseInt(localStorage.getItem('tvPort')) || 8002;
        this.tvMac = localStorage.getItem('tvMac') || '';
        this.connected = false;
        this.ws = null;

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

        // Toast
        this.toast = document.getElementById('toast');
    }

    // ─── Event Binding ──────────────────────────────────────────────
    bindEvents() {
        // Connect button
        this.connectBtn.addEventListener('click', () => this.handleConnect());

        // Enter key on IP input
        this.tvIpInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleConnect();
        });

        // Network scanner buttons
        this.scanBtn.addEventListener('click', () => this.handleScan());
        this.scanResultsClose.addEventListener('click', () => {
            this.scanResults.style.display = 'none';
        });

        // Disconnect button
        this.disconnectBtn.addEventListener('click', () => this.handleDisconnect());

        // Settings button (re-open modal)
        this.settingsBtn.addEventListener('click', () => this.showConnectionModal());

        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // Remote control buttons
        document.querySelectorAll('[data-key]').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleKeyPress(btn.dataset.key, e));

            // Touch feedback
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                btn.classList.add('btn-pressed');
                this.createRipple(e, btn);
            }, { passive: false });

            btn.addEventListener('touchend', (e) => {
                e.preventDefault();
                btn.classList.remove('btn-pressed');
                this.handleKeyPress(btn.dataset.key, e);
            });
        });

        // App buttons
        document.querySelectorAll('[data-app]').forEach(btn => {
            btn.addEventListener('click', () => this.handleAppLaunch(btn.dataset.app));
        });

        // Add click ripple for desktop
        document.querySelectorAll('.remote-btn, .dpad-center').forEach(btn => {
            btn.addEventListener('mousedown', (e) => {
                this.createRipple(e, btn);
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcut(e));

        // Visibility change (reconnect if needed)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.tvIp && !this.connected) {
                this.checkConnection();
            }
        });
    }

    // ─── Connection Handling ────────────────────────────────────────
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
        this.showToast('📺 Conectando... Mira la pantalla de tu TV y acepta la conexión', 'info');

        try {
            const controller = new AbortController();
            const fetchTimeout = setTimeout(() => controller.abort(), 35000); // Slightly longer than server timeout

            const response = await fetch('/api/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tvIp: ip, tvPort: port }),
                signal: controller.signal,
            });

            clearTimeout(fetchTimeout);
            const data = await response.json();

            if (response.ok && data.success) {
                this.tvIp = ip;
                this.tvPort = port;
                this.tvMac = mac;
                this.connected = true;

                // Save settings
                localStorage.setItem('tvIp', ip);
                localStorage.setItem('tvPort', port.toString());
                localStorage.setItem('tvMac', mac);

                // Save token if provided
                if (data.token) {
                    localStorage.setItem('tvToken', data.token);
                }

                // Show remote
                this.showRemote();
                this.showToast('✅ Conectado al TV Samsung', 'success');

                // Start connection monitoring
                this.startConnectionMonitor();
            } else {
                this.showError(data.error || 'No se pudo conectar al TV');
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                this.showError('Tiempo de espera agotado. ¿Aceptaste la conexión en la pantalla del TV?');
            } else {
                this.showError('Error de conexión. Verifica que el servidor esté corriendo.');
            }
        }

        this.setConnecting(false);
    }

    async handleDisconnect() {
        try {
            await fetch('/api/disconnect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tvIp: this.tvIp }),
            });
        } catch (e) {
            // Ignore errors
        }

        this.connected = false;
        this.stopConnectionMonitor();
        this.showConnectionModal();
        this.showToast('🔌 Desconectado del TV', 'info');
    }

    // ─── Key Press Handling ─────────────────────────────────────────
    async handleKeyPress(key, event) {
        if (!this.connected) {
            this.showToast('⚠️ No estás conectado al TV', 'error');
            return;
        }

        // Haptic feedback
        if ('vibrate' in navigator) {
            navigator.vibrate(30);
        }

        try {
            const response = await fetch('/api/key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tvIp: this.tvIp, key }),
            });

            const data = await response.json();

            if (!response.ok) {
                if (data.error?.includes('Not connected')) {
                    this.connected = false;
                    this.updateConnectionStatus();
                    this.showToast('📺 Conexión perdida. Reconectando...', 'error');
                    this.tryReconnect();
                } else {
                    this.showToast(`❌ ${data.error}`, 'error');
                }
            }
        } catch (error) {
            console.error('Key press error:', error);
        }
    }

    // ─── App Launch ─────────────────────────────────────────────────
    async handleAppLaunch(appId) {
        if (!this.connected) {
            this.showToast('⚠️ No estás conectado al TV', 'error');
            return;
        }

        if ('vibrate' in navigator) {
            navigator.vibrate(50);
        }

        try {
            const response = await fetch('/api/app', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tvIp: this.tvIp, appId }),
            });

            const data = await response.json();

            if (response.ok) {
                this.showToast('📱 Abriendo aplicación...', 'success');
            } else {
                this.showToast(`❌ ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('App launch error:', error);
        }
    }

    // ─── Keyboard Shortcuts ─────────────────────────────────────────
    handleKeyboardShortcut(e) {
        if (this.connectionModal.classList.contains('active')) return;
        if (e.target.tagName === 'INPUT') return;

        const keyMap = {
            'ArrowUp': 'up',
            'ArrowDown': 'down',
            'ArrowLeft': 'left',
            'ArrowRight': 'right',
            'Enter': 'enter',
            'Escape': 'back',
            'Backspace': 'back',
            'Home': 'home',
            'm': 'mute',
            'M': 'mute',
            '+': 'volumeUp',
            '=': 'volumeUp',
            '-': 'volumeDown',
            'PageUp': 'channelUp',
            'PageDown': 'channelDown',
            '0': 'num0',
            '1': 'num1',
            '2': 'num2',
            '3': 'num3',
            '4': 'num4',
            '5': 'num5',
            '6': 'num6',
            '7': 'num7',
            '8': 'num8',
            '9': 'num9',
        };

        if (keyMap[e.key]) {
            e.preventDefault();
            this.handleKeyPress(keyMap[e.key], e);

            // Visual feedback
            const btn = document.querySelector(`[data-key="${keyMap[e.key]}"]`);
            if (btn) {
                btn.classList.add('btn-pressed');
                setTimeout(() => btn.classList.remove('btn-pressed'), 150);
            }
        }
    }

    // ─── Tab Switching ──────────────────────────────────────────────
    switchTab(tabId) {
        // Update buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });

        // Update panels
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `tab-${tabId}`);
        });

        // Haptic feedback
        if ('vibrate' in navigator) {
            navigator.vibrate(15);
        }
    }

    // ─── UI Helpers ─────────────────────────────────────────────────
    showRemote() {
        this.connectionModal.classList.remove('active');
        this.remoteApp.style.display = 'flex';
        this.updateConnectionStatus();

        // Update display
        this.tvIpDisplay.textContent = this.tvIp;
    }

    showConnectionModal() {
        this.remoteApp.style.display = 'none';
        this.connectionModal.classList.add('active');
        this.connectionError.style.display = 'none';
    }

    updateConnectionStatus() {
        this.statusIndicator.classList.toggle('connected', this.connected);
        this.tvNameDisplay.textContent = this.connected ? 'Samsung TV' : 'Desconectado';
    }

    setConnecting(isConnecting) {
        const btnText = this.connectBtn.querySelector('.btn-text');
        const btnLoading = this.connectBtn.querySelector('.btn-loading');

        if (isConnecting) {
            btnText.style.display = 'none';
            btnLoading.style.display = 'inline';
            this.connectBtn.disabled = true;
            this.connectionError.style.display = 'none';
        } else {
            btnText.style.display = 'inline';
            btnLoading.style.display = 'none';
            this.connectBtn.disabled = false;
        }
    }

    showError(message) {
        this.connectionError.textContent = message;
        this.connectionError.style.display = 'block';
    }

    showToast(message, type = 'info') {
        this.toast.textContent = message;
        this.toast.className = `toast ${type} show`;

        clearTimeout(this._toastTimeout);
        this._toastTimeout = setTimeout(() => {
            this.toast.classList.remove('show');
        }, 2500);
    }

    createRipple(event, element) {
        const ripple = document.createElement('span');
        ripple.classList.add('ripple');

        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);

        let x, y;
        if (event.touches && event.touches.length) {
            x = event.touches[0].clientX - rect.left - size / 2;
            y = event.touches[0].clientY - rect.top - size / 2;
        } else {
            x = (event.clientX || rect.left + rect.width / 2) - rect.left - size / 2;
            y = (event.clientY || rect.top + rect.height / 2) - rect.top - size / 2;
        }

        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;

        element.appendChild(ripple);

        setTimeout(() => ripple.remove(), 500);
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

    async checkConnection() {
        try {
            const response = await fetch(`/api/status?tvIp=${encodeURIComponent(this.tvIp)}`);
            const data = await response.json();

            const wasConnected = this.connected;
            this.connected = data.connected;
            this.updateConnectionStatus();

            if (wasConnected && !this.connected) {
                this.showToast('📺 Conexión perdida con el TV', 'error');
            }
        } catch (e) {
            // Server might be down
        }
    }

    async tryReconnect() {
        try {
            const response = await fetch('/api/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tvIp: this.tvIp, tvPort: this.tvPort }),
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.connected = true;
                this.updateConnectionStatus();
                this.showToast('✅ Reconectado al TV', 'success');
            }
        } catch (e) {
            // Will retry on next monitor tick
        }
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

    // ─── Network Scanner ────────────────────────────────────────────
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

        // Animated progress bar
        let progress = 0;
        const progressSteps = [
            { target: 15, text: '🏓 Enviando pings a la red...' },
            { target: 40, text: '📋 Leyendo tabla ARP...' },
            { target: 60, text: '🔎 Buscando Samsung TVs...' },
            { target: 80, text: '📡 Verificando puertos...' },
        ];

        let stepIndex = 0;
        const progressInterval = setInterval(() => {
            if (stepIndex < progressSteps.length) {
                const step = progressSteps[stepIndex];
                if (progress < step.target) {
                    progress += 1;
                    this.scanProgressFill.style.width = `${progress}%`;
                } else {
                    stepIndex++;
                }
                if (stepIndex < progressSteps.length) {
                    this.scanProgressText.textContent = progressSteps[stepIndex]?.text || 'Escaneando...';
                }
            }
        }, 200);

        try {
            const response = await fetch('/api/scan');
            const data = await response.json();

            clearInterval(progressInterval);

            if (response.ok && data.success) {
                // Complete the progress bar
                this.scanProgressFill.style.width = '100%';
                this.scanProgressText.textContent = `✅ ${data.totalDevices} dispositivos encontrados`;

                // Show results after a brief delay
                setTimeout(() => {
                    this.renderScanResults(data);
                    this.scanProgress.style.display = 'none';
                }, 500);
            } else {
                this.scanProgressFill.style.width = '100%';
                this.scanProgressText.textContent = `❌ ${data.error || 'Error al escanear'}`;
            }
        } catch (error) {
            clearInterval(progressInterval);
            this.scanProgressFill.style.width = '100%';
            this.scanProgressText.textContent = '❌ Error al escanear la red';
        }

        // Reset button state
        this.scanBtn.disabled = false;
        this.scanBtnContent.style.display = 'flex';
        this.scanBtnLoading.style.display = 'none';
        this._scanning = false;
    }

    renderScanResults(data) {
        const { devices, samsungTVs, network } = data;

        // Update title
        this.scanResultsTitle.textContent = samsungTVs > 0
            ? `📺 ${samsungTVs} Samsung TV${samsungTVs > 1 ? 's' : ''} · ${devices.length} dispositivos`
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
                const isTv = device.isSamsungTV;
                const tvName = device.tvInfo?.name || device.label;
                const tvModel = device.tvInfo?.modelName ? ` · ${device.tvInfo.modelName}` : '';
                const hostname = device.hostname ? ` · ${device.hostname}` : '';
                const details = `${device.ip} · ${device.mac}${tvModel}${hostname}`;
                const badge = isTv ? 'Smart TV' : device.label;

                return `
                    <div class="device-card ${isTv ? 'samsung-tv' : ''}" 
                         data-ip="${device.ip}" 
                         data-mac="${device.mac}"
                         data-is-tv="${isTv}">
                        <div class="device-card-icon">${device.icon}</div>
                        <div class="device-card-info">
                            <div class="device-card-name">${tvName}</div>
                            <div class="device-card-details">${details}</div>
                        </div>
                        <span class="device-card-badge">${badge}</span>
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
        const isTv = card.dataset.isTv === 'true';

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

        // If it's a Samsung TV, auto-connect
        if (isTv) {
            this.showToast(`📺 Samsung TV detectado en ${ip}`, 'success');
            // Scroll to connect button
            this.connectBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Optional: auto-connect after short delay
            setTimeout(() => {
                this.connectBtn.classList.add('btn-pressed');
                setTimeout(() => this.connectBtn.classList.remove('btn-pressed'), 150);
            }, 400);
        } else {
            this.showToast(`📋 IP ${ip} copiada`, 'info');
        }
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
