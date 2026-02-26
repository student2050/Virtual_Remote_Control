/**
 * Antigravity Agent — Config Manager
 * Persists API key, server URL, and preferences locally
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

const CONFIG_DIR = path.join(os.homedir(), '.antigravity');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
    serverUrl: 'https://antigravity-saas.onrender.com',
    apiKey: '',
    workspaceName: '',
    autoApprove: false,
    autoApproveRisk: 'none', // none | low | medium
};

class Config {
    constructor() {
        this._data = { ...DEFAULTS };
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
                this._data = { ...DEFAULTS, ...JSON.parse(raw) };
            }
        } catch { }
    }

    save() {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(this._data, null, 2));
    }

    get(key) { return this._data[key]; }

    set(key, value) {
        this._data[key] = value;
        this.save();
    }

    getAll() { return { ...this._data }; }

    clear() {
        this._data = { ...DEFAULTS };
        this.save();
    }
}

module.exports = new Config();
