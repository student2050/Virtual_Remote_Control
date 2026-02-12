const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const net = require('net');
const dgram = require('dgram');
const wol = require('wake_on_lan');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Samsung TV Configuration ───────────────────────────────────────
// Using 'SmartThings' as app name - Samsung TVs auto-trust this name
// without requiring user confirmation on the TV screen
const APP_NAME = 'SmartThings';
const APP_NAME_BASE64 = Buffer.from(APP_NAME).toString('base64');

// Store active TV connections
const tvConnections = new Map();

// ─── Samsung TV Key Codes ───────────────────────────────────────────
const SAMSUNG_KEYS = {
  // Power
  power: 'KEY_POWER',
  powerOff: 'KEY_POWEROFF',

  // Volume
  volumeUp: 'KEY_VOLUP',
  volumeDown: 'KEY_VOLDOWN',
  mute: 'KEY_MUTE',

  // Channels
  channelUp: 'KEY_CHUP',
  channelDown: 'KEY_CHDOWN',
  channelList: 'KEY_CH_LIST',

  // Navigation
  up: 'KEY_UP',
  down: 'KEY_DOWN',
  left: 'KEY_LEFT',
  right: 'KEY_RIGHT',
  enter: 'KEY_ENTER',
  back: 'KEY_RETURN',
  exit: 'KEY_EXIT',

  // Menu
  home: 'KEY_HOME',
  menu: 'KEY_MENU',
  source: 'KEY_SOURCE',
  guide: 'KEY_GUIDE',
  tools: 'KEY_TOOLS',
  info: 'KEY_INFO',

  // Numbers
  num0: 'KEY_0',
  num1: 'KEY_1',
  num2: 'KEY_2',
  num3: 'KEY_3',
  num4: 'KEY_4',
  num5: 'KEY_5',
  num6: 'KEY_6',
  num7: 'KEY_7',
  num8: 'KEY_8',
  num9: 'KEY_9',

  // Media
  play: 'KEY_PLAY',
  pause: 'KEY_PAUSE',
  stop: 'KEY_STOP',
  rewind: 'KEY_REWIND',
  fastForward: 'KEY_FF',
  record: 'KEY_REC',

  // Color buttons
  red: 'KEY_RED',
  green: 'KEY_GREEN',
  yellow: 'KEY_YELLOW',
  blue: 'KEY_BLUE',

  // Apps
  netflix: 'KEY_NETFLIX',
  amazon: 'KEY_AMAZON',

  // Misc
  hdmi: 'KEY_HDMI',
  sleep: 'KEY_SLEEP',
  pictureSize: 'KEY_PICTURE_SIZE',
  panelPower: 'KEY_PANEL_POWER',
};

// ─── Connect to Samsung TV ──────────────────────────────────────────
// Persist tokens to file so they survive server restarts
const TOKEN_FILE = path.join(__dirname, 'tv_tokens.json');
let tvTokens = {};

// Load saved tokens
try {
  if (require('fs').existsSync(TOKEN_FILE)) {
    tvTokens = JSON.parse(require('fs').readFileSync(TOKEN_FILE, 'utf8'));
    console.log('🔑 Loaded saved TV tokens:', Object.keys(tvTokens).join(', '));
  }
} catch (e) { tvTokens = {}; }

function saveTokens() {
  try {
    require('fs').writeFileSync(TOKEN_FILE, JSON.stringify(tvTokens, null, 2));
  } catch (e) { console.error('Failed to save tokens:', e.message); }
}

function connectToTV(tvIp, tvPort = 8002, useToken = true) {
  return new Promise((resolve, reject) => {
    const connectionId = tvIp;

    // Close existing connection if any
    if (tvConnections.has(connectionId)) {
      const existing = tvConnections.get(connectionId);
      try { existing.close(); } catch (e) { }
      tvConnections.delete(connectionId);
    }

    const protocol = tvPort === 8002 ? 'wss' : 'ws';

    // Build URL — include stored token if available
    let url = `${protocol}://${tvIp}:${tvPort}/api/v2/channels/samsung.remote.control?name=${APP_NAME_BASE64}`;
    const token = tvTokens[tvIp];
    if (token && useToken) {
      url += `&token=${token}`;
      console.log(`🔑 Using saved token for ${tvIp}`);
    }

    console.log(`🔌 Connecting to Samsung TV at ${tvIp}:${tvPort}...`);

    const tvWs = new WebSocket(url, {
      rejectUnauthorized: false,
      timeout: 10000,
    });

    const timeoutMs = 15000;

    const timeout = setTimeout(() => {
      tvWs.terminate();
      // If we used a token and it timed out, retry without token
      if (token && useToken) {
        console.log('⚠️ Token connection timed out, retrying without token...');
        delete tvTokens[tvIp];
        saveTokens();
        connectToTV(tvIp, tvPort, false).then(resolve).catch(reject);
      } else {
        reject(new Error('Tiempo de espera agotado al conectar al TV. Verifica que esté encendido.'));
      }
    }, timeoutMs);

    tvWs.on('open', () => {
      console.log(`✅ WebSocket opened to ${tvIp}`);
    });

    tvWs.on('message', (data) => {
      try {
        const response = JSON.parse(data.toString());
        console.log('📺 TV Event:', response.event);

        if (response.event === 'ms.channel.connect') {
          clearTimeout(timeout);
          tvConnections.set(connectionId, tvWs);

          // Save new token for future reconnections
          if (response.data?.token) {
            tvTokens[tvIp] = response.data.token;
            saveTokens();
            console.log(`🔑 Token saved for ${tvIp}: ${response.data.token}`);
          }

          resolve({ success: true, message: 'Connected to TV', token: response.data?.token });
        } else if (response.event === 'ms.channel.unauthorized') {
          clearTimeout(timeout);
          tvWs.terminate();
          // Clear old token if unauthorized
          tvTokens.delete(tvIp);
          reject(new Error('Conexión rechazada por el TV. Intenta de nuevo y acepta en la pantalla.'));
        }
      } catch (e) {
        console.error('Error parsing TV response:', e);
      }
    });

    tvWs.on('error', (error) => {
      clearTimeout(timeout);
      console.error(`❌ TV Connection Error: ${error.message}`);

      // If WSS fails, suggest trying WS
      if (tvPort === 8002 && (error.message.includes('ECONNREFUSED') || error.message.includes('EAFNOSUPPORT'))) {
        reject(new Error(`No se puede conectar por puerto ${tvPort}. Intenta con puerto 8001.`));
      } else {
        reject(new Error(`Cannot connect to TV: ${error.message}`));
      }
    });

    tvWs.on('close', () => {
      console.log(`📺 Disconnected from TV at ${tvIp}`);
      tvConnections.delete(connectionId);
    });
  });
}

// ─── Send Key Command to TV ─────────────────────────────────────────
function sendKey(tvIp, keyCode) {
  return new Promise((resolve, reject) => {
    const tvWs = tvConnections.get(tvIp);

    if (!tvWs || tvWs.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected to TV. Please connect first.'));
      return;
    }

    const command = {
      method: 'ms.remote.control',
      params: {
        Cmd: 'Click',
        DataOfCmd: keyCode,
        Option: 'false',
        TypeOfRemote: 'SendRemoteKey',
      },
    };

    console.log(`🎯 Sending key: ${keyCode}`);
    tvWs.send(JSON.stringify(command), (error) => {
      if (error) {
        reject(new Error(`Failed to send key: ${error.message}`));
      } else {
        resolve({ success: true, key: keyCode });
      }
    });
  });
}

// ─── Launch TV App ──────────────────────────────────────────────────
function launchApp(tvIp, appId) {
  return new Promise((resolve, reject) => {
    const tvWs = tvConnections.get(tvIp);

    if (!tvWs || tvWs.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected to TV. Please connect first.'));
      return;
    }

    const command = {
      method: 'ms.channel.emit',
      params: {
        event: 'ed.apps.launch',
        to: 'host',
        data: {
          appId: appId,
          action_type: 'DEEP_LINK',
        },
      },
    };

    console.log(`📱 Launching app: ${appId}`);
    tvWs.send(JSON.stringify(command), (error) => {
      if (error) {
        reject(new Error(`Failed to launch app: ${error.message}`));
      } else {
        resolve({ success: true, appId });
      }
    });
  });
}

// ─── API Routes ─────────────────────────────────────────────────────

// Connect to TV
app.post('/api/connect', async (req, res) => {
  const { tvIp, tvPort } = req.body;

  if (!tvIp) {
    return res.status(400).json({ error: 'TV IP address is required' });
  }

  // Validate IP is a valid unicast address
  if (!isValidDeviceIp(tvIp)) {
    return res.status(400).json({ error: `Invalid IP address: ${tvIp}. Multicast, broadcast, and reserved addresses are not allowed.` });
  }

  try {
    const result = await connectToTV(tvIp, tvPort || 8002);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Disconnect from TV
app.post('/api/disconnect', (req, res) => {
  const { tvIp } = req.body;

  if (tvConnections.has(tvIp)) {
    const tvWs = tvConnections.get(tvIp);
    try { tvWs.close(); } catch (e) { }
    tvConnections.delete(tvIp);
  }

  res.json({ success: true, message: 'Disconnected' });
});

// Send key command
app.post('/api/key', async (req, res) => {
  const { tvIp, key } = req.body;

  if (!tvIp || !key) {
    return res.status(400).json({ error: 'TV IP and key are required' });
  }

  const keyCode = SAMSUNG_KEYS[key] || key;

  try {
    const result = await sendKey(tvIp, keyCode);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Launch app
app.post('/api/app', async (req, res) => {
  const { tvIp, appId } = req.body;

  if (!tvIp || !appId) {
    return res.status(400).json({ error: 'TV IP and app ID are required' });
  }

  try {
    const result = await launchApp(tvIp, appId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Wake on LAN
app.post('/api/wake', (req, res) => {
  const { macAddress } = req.body;

  if (!macAddress) {
    return res.status(400).json({ error: 'MAC address is required' });
  }

  wol.wake(macAddress, (error) => {
    if (error) {
      res.status(500).json({ error: `Failed to send WOL: ${error.message}` });
    } else {
      res.json({ success: true, message: 'Wake-on-LAN packet sent' });
    }
  });
});

// Get connection status
app.get('/api/status', (req, res) => {
  const { tvIp } = req.query;

  if (!tvIp) {
    return res.json({ connected: false });
  }

  const tvWs = tvConnections.get(tvIp);
  const connected = tvWs && tvWs.readyState === WebSocket.OPEN;

  res.json({ connected });
});

// Get available keys
app.get('/api/keys', (req, res) => {
  res.json(SAMSUNG_KEYS);
});

// ─── Network Scanner ────────────────────────────────────────────────

// Get local network info
function getLocalNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const results = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        // Calculate subnet base from IP and netmask
        const ipParts = addr.address.split('.').map(Number);
        const maskParts = addr.netmask.split('.').map(Number);
        const networkParts = ipParts.map((p, i) => p & maskParts[i]);
        const network = networkParts.join('.');

        results.push({
          interface: name,
          ip: addr.address,
          netmask: addr.netmask,
          mac: addr.mac,
          network,
          // Calculate CIDR prefix length
          prefix: maskParts.reduce((sum, octet) => {
            let bits = 0;
            let val = octet;
            while (val > 0) { bits += val & 1; val >>= 1; }
            return sum + bits;
          }, 0),
        });
      }
    }
  }
  return results;
}

// Run a command and return stdout
function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
      resolve(stdout || '');
    });
  });
}

// Quick TCP port check
function checkPort(ip, port, timeout = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      resolved = true;
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      if (!resolved) { resolved = true; socket.destroy(); resolve(false); }
    });

    socket.on('error', () => {
      if (!resolved) { resolved = true; socket.destroy(); resolve(false); }
    });

    try {
      socket.connect(port, ip);
    } catch (e) {
      if (!resolved) { resolved = true; resolve(false); }
    }
  });
}

// Try to get Samsung TV info via HTTP API
async function getSamsungTVInfo(ip) {
  return new Promise((resolve) => {
    const req = http.get(`http://${ip}:8001/api/v2/`, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          resolve(info);
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ─── SSDP/UPnP Discovery ─────────────────────────────────────────
function discoverSamsungTVsViaSsdp(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const tvs = new Map(); // ip -> device info

    try {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      // Samsung-specific SSDP search
      const searchMessages = [
        'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 3\r\nST: urn:samsung.com:device:RemoteControlReceiver:1\r\n\r\n',
        'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 3\r\nST: urn:dial-multiscreen-org:service:dial:1\r\n\r\n',
        'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 3\r\nST: ssdp:all\r\n\r\n',
      ];

      sock.on('message', (msg, rinfo) => {
        const response = msg.toString('utf-8');
        const ip = rinfo.address;
        const lowerResp = response.toLowerCase();

        // Check if Samsung device
        if (lowerResp.includes('samsung') || lowerResp.includes('tizen')) {
          // Extract location and server info
          const locationMatch = response.match(/LOCATION:\s*(.+)/i);
          const serverMatch = response.match(/SERVER:\s*(.+)/i);

          if (!tvs.has(ip)) {
            tvs.set(ip, {
              ip,
              location: locationMatch ? locationMatch[1].trim() : '',
              server: serverMatch ? serverMatch[1].trim() : 'Samsung Device',
              isSamsungTV: true,
            });
            console.log(`📺 SSDP found Samsung device: ${ip} - ${serverMatch ? serverMatch[1].trim() : 'Unknown'}`);
          }
        }
      });

      sock.on('error', (err) => {
        console.error('SSDP error:', err.message);
        sock.close();
        resolve(tvs);
      });

      sock.bind(() => {
        try {
          sock.setBroadcast(true);
          sock.setMulticastTTL(4);

          // Send all search messages
          for (const msg of searchMessages) {
            sock.send(Buffer.from(msg), 0, msg.length, 1900, '239.255.255.250');
          }
        } catch (e) {
          console.error('SSDP send error:', e.message);
        }
      });

      // Close after timeout
      setTimeout(() => {
        try { sock.close(); } catch (e) { }
        resolve(tvs);
      }, timeoutMs);

    } catch (e) {
      console.error('SSDP setup error:', e.message);
      resolve(tvs);
    }
  });
}

// Validate if an IP is a valid unicast device address
function isValidDeviceIp(ip) {
  if (!ip) return false;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;

  const first = parts[0];
  const last = parts[3];

  // Filter out:
  // - Multicast (224.0.0.0 - 239.255.255.255)
  // - Broadcast (x.x.x.255 or 255.255.255.255)
  // - Loopback (127.x.x.x)
  // - Link-local (169.254.x.x)
  // - Network address (x.x.x.0)
  // - Reserved (0.x.x.x, 240-255.x.x.x)
  if (first >= 224 && first <= 239) return false; // Multicast
  if (first >= 240) return false;                  // Reserved
  if (first === 0) return false;                   // Invalid
  if (first === 127) return false;                 // Loopback
  if (first === 169 && parts[1] === 254) return false; // Link-local
  if (last === 255) return false;                  // Broadcast
  if (last === 0) return false;                    // Network address
  if (ip === '255.255.255.255') return false;       // Global broadcast

  return true;
}

// Parse ARP table
async function getArpTable() {
  const platform = os.platform();
  let cmd;

  if (platform === 'darwin') {
    cmd = 'arp -a';
  } else if (platform === 'win32') {
    cmd = 'arp -a';
  } else {
    cmd = 'arp -n';
  }

  const output = await runCommand(cmd);
  const devices = [];
  const lines = output.split('\n');

  for (const line of lines) {
    let match;

    if (platform === 'darwin') {
      // macOS: hostname (ip) at mac on interface
      match = line.match(/^\s*([\w.-]*?)\s*\(([\d.]+)\)\s+at\s+([\w:]+)/i);
      if (match) {
        const hostname = match[1] || '';
        const ip = match[2];
        const mac = match[3];
        if (mac !== '(incomplete)' && mac !== 'ff:ff:ff:ff:ff:ff' && isValidDeviceIp(ip)) {
          devices.push({ ip, mac: mac.toUpperCase(), hostname });
        }
      }
    } else if (platform === 'win32') {
      // Windows: ip    mac    type
      match = line.match(/^\s*([\d.]+)\s+([\w-]+)\s+(dynamic|static)/i);
      if (match) {
        const ip = match[1];
        const mac = match[2].replace(/-/g, ':').toUpperCase();
        if (mac !== 'FF:FF:FF:FF:FF:FF' && isValidDeviceIp(ip)) {
          devices.push({ ip, mac, hostname: '' });
        }
      }
    } else {
      // Linux: ip   type   mac   flags   interface
      match = line.match(/^([\d.]+)\s+\w+\s+([\w:]+)/i);
      if (match) {
        const ip = match[1];
        const mac = match[2].toUpperCase();
        if (mac !== '00:00:00:00:00:00' && mac !== 'FF:FF:FF:FF:FF:FF' && isValidDeviceIp(ip)) {
          devices.push({ ip, mac, hostname: '' });
        }
      }
    }
  }

  return devices;
}

// Known Samsung MAC prefixes (OUI)
const SAMSUNG_MAC_PREFIXES = [
  '00:07:AB', '00:12:FB', '00:13:77', '00:15:99', '00:16:32', '00:16:6B',
  '00:16:6C', '00:17:C9', '00:17:D5', '00:18:AF', '00:1A:8A', '00:1B:98',
  '00:1C:43', '00:1D:25', '00:1E:7D', '00:1E:E1', '00:1E:E2', '00:21:19',
  '00:21:D1', '00:21:D2', '00:23:39', '00:23:3A', '00:23:99', '00:23:D6',
  '00:23:D7', '00:24:54', '00:24:90', '00:24:91', '00:25:66', '00:25:67',
  '00:26:37', '00:26:5D', '00:E0:64', '08:08:C2', '08:37:3D', '08:D4:2B',
  '0C:DF:A4', '10:1D:C0', '14:49:E0', '14:89:FD', '18:3A:2D', '1C:62:B8',
  '20:13:E0', '24:4B:03', '28:27:BF', '28:BA:B5', '2C:AE:2B', '30:CD:A7',
  '34:23:BA', '34:C3:AC', '38:01:97', '38:0A:94', '3C:5A:37', '3C:62:00',
  '40:16:7E', '44:F4:59', '48:44:F7', '4C:3C:16', '50:01:BB', '50:A4:C8',
  '54:40:AD', '54:92:BE', '58:C3:8B', '5C:3C:27', '5C:49:7D', '5C:F6:DC',
  '60:6B:BD', '64:77:91', '68:27:37', '6C:B7:49', '70:2A:D5', '70:F9:27',
  '74:45:CE', '78:1F:DB', '78:47:1D', '78:52:1A', '78:AB:BB', '7C:0B:C6',
  '7C:64:56', '80:18:A7', '84:25:DB', '84:38:35', '84:55:A5', '84:A4:66',
  '88:32:9B', '8C:71:F8', '8C:77:12', '90:18:7C', '90:F1:AA', '94:01:C2',
  '94:35:0A', '94:63:D1', '94:B8:6D', '98:0C:82', '98:52:B1', '9C:02:98',
  '9C:3A:AF', 'A0:07:98', 'A0:21:B7', 'A0:82:1F', 'A0:CC:2B', 'A4:30:7A',
  'A8:06:00', 'A8:F2:74', 'AC:36:13', 'AC:5A:14', 'B0:47:BF', 'B0:C4:E7',
  'B4:07:F9', 'B4:3A:28', 'B8:57:D8', 'B8:5A:73', 'BC:14:EF', 'BC:44:86',
  'BC:72:B1', 'BC:8C:CD', 'C0:97:27', 'C0:BD:D1', 'C4:57:6E', 'C4:73:1E',
  'C8:14:79', 'C8:BA:94', 'CC:07:AB', 'D0:22:BE', 'D0:25:44', 'D0:59:E4',
  'D0:66:7B', 'D0:87:E2', 'D4:88:90', 'D8:57:EF', 'D8:90:E8', 'DC:71:44',
  'E0:99:71', 'E0:CB:1D', 'E4:12:1D', 'E4:7C:F9', 'E4:92:FB', 'E4:E0:C5',
  'E8:03:9A', 'EC:1F:72', 'EC:9B:F3', 'F0:25:B7', 'F0:5B:7B', 'F0:6B:CA',
  'F0:72:8C', 'F4:0E:22', 'F4:42:8F', 'F4:7B:5E', 'F4:9F:54', 'F8:04:2E',
  'F8:3F:51', 'FC:A1:3E', 'FC:F1:36',
];

function isSamsungMac(mac) {
  if (!mac) return false;
  const prefix = mac.toUpperCase().substring(0, 8);
  return SAMSUNG_MAC_PREFIXES.includes(prefix);
}

// Classify device type from hostname and mac
function classifyDevice(device) {
  const hn = (device.hostname || '').toLowerCase();
  const mac = (device.mac || '').toUpperCase();

  // Samsung check
  if (isSamsungMac(mac)) {
    return { type: 'samsung', label: 'Samsung Device', icon: '📺' };
  }

  // Common device patterns
  if (hn.includes('iphone') || hn.includes('ipad')) return { type: 'apple', label: 'Apple Device', icon: '📱' };
  if (hn.includes('macbook') || hn.includes('imac') || hn.includes('mac-')) return { type: 'apple', label: 'Apple Computer', icon: '💻' };
  if (hn.includes('android') || hn.includes('galaxy')) return { type: 'android', label: 'Android Device', icon: '📱' };
  if (hn.includes('echo') || hn.includes('alexa')) return { type: 'alexa', label: 'Amazon Echo', icon: '🔊' };
  if (hn.includes('google') || hn.includes('chromecast') || hn.includes('nest')) return { type: 'google', label: 'Google Device', icon: '🔊' };
  if (hn.includes('roku')) return { type: 'roku', label: 'Roku', icon: '📡' };
  if (hn.includes('fire') || hn.includes('amazon')) return { type: 'amazon', label: 'Amazon Device', icon: '🔥' };
  if (hn.includes('printer') || hn.includes('hp-') || hn.includes('epson') || hn.includes('canon')) return { type: 'printer', label: 'Impresora', icon: '🖨️' };
  if (hn.includes('router') || hn.includes('gateway') || hn.includes('modem')) return { type: 'router', label: 'Router', icon: '📡' };
  if (hn.includes('playstation') || hn.includes('ps4') || hn.includes('ps5') || hn.includes('xbox')) return { type: 'console', label: 'Consola', icon: '🎮' };

  // Check common MAC prefixes for other vendors
  const macPrefix = mac.substring(0, 8);
  if (['3C:22:FB', 'A4:83:E7', '00:17:88'].includes(macPrefix)) return { type: 'iot', label: 'Dispositivo IoT', icon: '💡' };

  return { type: 'unknown', label: 'Dispositivo', icon: '🔗' };
}

// Main scan endpoint
app.get('/api/scan', async (req, res) => {
  console.log('🔍 Starting network scan...');

  try {
    const networkInfo = getLocalNetworkInfo();

    if (networkInfo.length === 0) {
      return res.status(500).json({ error: 'No active network interfaces found' });
    }

    const mainNetwork = networkInfo[0];
    console.log(`📡 Scanning network: ${mainNetwork.ip} / ${mainNetwork.netmask}`);

    // Step 1: Ping sweep to populate ARP table
    const ipBase = mainNetwork.ip.split('.').slice(0, 3).join('.');
    console.log(`🏓 Ping sweep on ${ipBase}.0/24...`);

    // Run parallel pings (fast sweep)
    const platform = os.platform();
    let pingCmd;

    if (platform === 'darwin') {
      // macOS: use -c 1 -W 500ms timeout, run up to 20 at once
      const pingCmds = [];
      for (let i = 1; i <= 254; i++) {
        pingCmds.push(`ping -c 1 -W 500 ${ipBase}.${i} > /dev/null 2>&1 &`);
      }
      // Run in batches to avoid too many processes
      const batchSize = 50;
      for (let i = 0; i < pingCmds.length; i += batchSize) {
        const batch = pingCmds.slice(i, i + batchSize).join(' ');
        await runCommand(batch + ' wait');
      }
    } else if (platform === 'win32') {
      // Windows
      const pingCmds = [];
      for (let i = 1; i <= 254; i++) {
        pingCmds.push(`start /b ping -n 1 -w 500 ${ipBase}.${i} > nul`);
      }
      await runCommand(pingCmds.join(' & '));
      await new Promise(r => setTimeout(r, 3000));
    } else {
      // Linux
      await runCommand(`for i in $(seq 1 254); do ping -c 1 -W 1 ${ipBase}.$i > /dev/null 2>&1 & done; wait`);
    }

    // Small delay to let ARP table populate
    await new Promise(r => setTimeout(r, 1500));

    // Step 2: Run SSDP discovery in parallel with ARP reading
    console.log('📻 Running SSDP/UPnP discovery...');
    const [arpDevices, ssdpTVs] = await Promise.all([
      getArpTable(),
      discoverSamsungTVsViaSsdp(4000),
    ]);
    console.log(`   Found ${arpDevices.length} devices in ARP table`);
    console.log(`   Found ${ssdpTVs.size} Samsung devices via SSDP`);

    // Merge SSDP-discovered TVs into ARP list (TVs that don't respond to ping)
    for (const [ssdpIp, ssdpInfo] of ssdpTVs) {
      const alreadyInArp = arpDevices.some(d => d.ip === ssdpIp);
      if (!alreadyInArp) {
        // Try to get MAC from a quick ARP lookup
        let mac = '';
        try {
          const arpLine = await runCommand(`arp -n ${ssdpIp} 2>/dev/null || arp ${ssdpIp} 2>/dev/null`);
          const macMatch = arpLine.match(/([0-9a-f]{1,2}:[0-9a-f]{1,2}:[0-9a-f]{1,2}:[0-9a-f]{1,2}:[0-9a-f]{1,2}:[0-9a-f]{1,2})/i);
          if (macMatch) mac = macMatch[1].toUpperCase();
        } catch (e) { }

        arpDevices.push({
          ip: ssdpIp,
          mac: mac,
          hostname: '',
          _ssdpDiscovered: true,
          _ssdpServer: ssdpInfo.server,
        });
        console.log(`   ➕ Added SSDP device ${ssdpIp} (not in ARP table)`);
      } else {
        // Mark existing device as SSDP-discovered Samsung
        const existing = arpDevices.find(d => d.ip === ssdpIp);
        if (existing) {
          existing._ssdpDiscovered = true;
          existing._ssdpServer = ssdpInfo.server;
        }
      }
    }

    // Step 3: Check each device for Samsung TV ports and classify
    console.log('🔎 Checking for Samsung TVs...');
    const devices = [];

    // Check all devices in parallel (with concurrency limit)
    const checkDevice = async (device) => {
      const classification = classifyDevice(device);

      // Check Samsung TV ports
      const [port8001, port8002] = await Promise.all([
        checkPort(device.ip, 8001, 2000),
        checkPort(device.ip, 8002, 2000),
      ]);

      let tvInfo = null;
      let isSamsungTV = false;

      // If found via SSDP, it's definitely a Samsung device
      if (device._ssdpDiscovered) {
        isSamsungTV = true;
      }

      if (port8001 || port8002) {
        // Try to get TV info from Samsung API
        tvInfo = await getSamsungTVInfo(device.ip);
        if (tvInfo && tvInfo.device) {
          isSamsungTV = true;
        } else if (classification.type === 'samsung') {
          isSamsungTV = true;
        }
      }

      return {
        ip: device.ip,
        mac: device.mac,
        hostname: device.hostname || '',
        type: isSamsungTV ? 'samsung-tv' : classification.type,
        label: isSamsungTV ? (tvInfo?.device?.name || device._ssdpServer || 'Samsung Smart TV') : classification.label,
        icon: isSamsungTV ? '📺' : classification.icon,
        isSamsungTV,
        tvInfo: tvInfo?.device || null,
        ports: {
          samsung_http: port8001,
          samsung_wss: port8002,
        },
      };
    };

    // Process in batches of 10 for port scanning
    const batchSize = 10;
    for (let i = 0; i < arpDevices.length; i += batchSize) {
      const batch = arpDevices.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(checkDevice));
      devices.push(...results);
    }

    // Sort: Samsung TVs first, then by IP
    devices.sort((a, b) => {
      if (a.isSamsungTV && !b.isSamsungTV) return -1;
      if (!a.isSamsungTV && b.isSamsungTV) return 1;
      // Sort by IP numerically
      const aNum = a.ip.split('.').reduce((acc, oct) => acc * 256 + parseInt(oct), 0);
      const bNum = b.ip.split('.').reduce((acc, oct) => acc * 256 + parseInt(oct), 0);
      return aNum - bNum;
    });

    console.log(`✅ Scan complete: ${devices.length} devices, ${devices.filter(d => d.isSamsungTV).length} Samsung TVs`);

    res.json({
      success: true,
      network: {
        interface: mainNetwork.interface,
        localIp: mainNetwork.ip,
        subnet: `${ipBase}.0/24`,
      },
      totalDevices: devices.length,
      samsungTVs: devices.filter(d => d.isSamsungTV).length,
      devices,
    });
  } catch (error) {
    console.error('❌ Scan error:', error);
    res.status(500).json({ error: `Scan failed: ${error.message}` });
  }
});

// ─── WebSocket for real-time communication ──────────────────────────
wss.on('connection', (ws) => {
  console.log('🌐 Client connected via WebSocket');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.action) {
        case 'connect':
          try {
            const result = await connectToTV(data.tvIp, data.tvPort);
            ws.send(JSON.stringify({ type: 'connected', ...result }));
          } catch (error) {
            ws.send(JSON.stringify({ type: 'error', message: error.message }));
          }
          break;

        case 'key':
          try {
            const keyCode = SAMSUNG_KEYS[data.key] || data.key;
            const result = await sendKey(data.tvIp, keyCode);
            ws.send(JSON.stringify({ type: 'keyResult', ...result }));
          } catch (error) {
            ws.send(JSON.stringify({ type: 'error', message: error.message }));
          }
          break;

        case 'app':
          try {
            const result = await launchApp(data.tvIp, data.appId);
            ws.send(JSON.stringify({ type: 'appResult', ...result }));
          } catch (error) {
            ws.send(JSON.stringify({ type: 'error', message: error.message }));
          }
          break;
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log('🌐 Client disconnected');
  });
});

// ─── Start Server ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     📺 Samsung TV Virtual Remote Control 📺     ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Server running on: http://localhost:${PORT}        ║`);
  console.log('║                                                  ║');
  console.log('║  Access from other devices on the same network:  ║');
  console.log('║  → Find your computer IP and open in browser     ║');
  console.log('║  → http://YOUR_IP:3000                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});
