<?php
/**
 * Antigravity PHP Relay — Ultra-simple message API
 * Deploy to: ~/public_html/antigravity/api.php (or subdomain root)
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Api-Key');

// Handle CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ─── Config ──────────────────────────────────────────────────────────────
define('API_KEY', 'ag_antigravity_permanent_key_2025');
define('MSG_FILE', __DIR__ . '/data/messages.json');
define('MAX_MESSAGES', 200);
define('LOGIN_EMAIL', 'hanibal@virtualtec.com');
define('LOGIN_PASS', 'VirtualTec2025!');

// Ensure data directory exists
if (!is_dir(__DIR__ . '/data')) {
    mkdir(__DIR__ . '/data', 0755, true);
}

// ─── Helper: load messages ───────────────────────────────────────────────
function loadMessages() {
    if (!file_exists(MSG_FILE)) return [];
    $data = json_decode(file_get_contents(MSG_FILE), true);
    return is_array($data) ? $data : [];
}

function saveMessages($msgs) {
    // Keep only last MAX_MESSAGES
    $msgs = array_slice($msgs, -MAX_MESSAGES);
    file_put_contents(MSG_FILE, json_encode($msgs, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

// ─── Get action ──────────────────────────────────────────────────────────
$action = $_GET['action'] ?? $_POST['action'] ?? '';
$apiKey = $_GET['key'] ?? $_POST['key'] ?? ($_SERVER['HTTP_X_API_KEY'] ?? '');

// ─── Actions ─────────────────────────────────────────────────────────────
switch ($action) {

    case 'health':
        echo json_encode(['status' => 'ok', 'time' => date('c')]);
        break;

    case 'login':
        $input = json_decode(file_get_contents('php://input'), true) ?: $_POST;
        $email = $input['email'] ?? '';
        $pass = $input['password'] ?? '';
        if ($email === LOGIN_EMAIL && $pass === LOGIN_PASS) {
            // Generate a simple session token
            $token = bin2hex(random_bytes(32));
            $tokenFile = __DIR__ . '/data/tokens.json';
            $tokens = file_exists($tokenFile) ? json_decode(file_get_contents($tokenFile), true) : [];
            $tokens[$token] = ['email' => $email, 'created' => time(), 'expires' => time() + 86400 * 7];
            file_put_contents($tokenFile, json_encode($tokens), LOCK_EX);
            echo json_encode(['success' => true, 'token' => $token, 'name' => 'Hanibal']);
        } else {
            http_response_code(401);
            echo json_encode(['error' => 'Credenciales incorrectas']);
        }
        break;

    case 'send':
        $input = json_decode(file_get_contents('php://input'), true) ?: $_POST;
        $content = trim($input['content'] ?? '');
        $role = $input['role'] ?? 'user'; // 'user' from mobile, 'agent' from Mac
        $token = $input['token'] ?? ($apiKey ?: '');

        if (empty($content)) {
            http_response_code(400);
            echo json_encode(['error' => 'Empty message']);
            break;
        }

        // Validate: agent uses API key, user uses session token
        if ($role === 'agent' && $token !== API_KEY) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid API key']);
            break;
        }
        if ($role === 'user') {
            $tokenFile = __DIR__ . '/data/tokens.json';
            $tokens = file_exists($tokenFile) ? json_decode(file_get_contents($tokenFile), true) : [];
            if (!isset($tokens[$token]) || $tokens[$token]['expires'] < time()) {
                http_response_code(403);
                echo json_encode(['error' => 'Invalid or expired token']);
                break;
            }
        }

        $msgs = loadMessages();
        $msg = [
            'id' => uniqid('msg_', true),
            'role' => $role,
            'content' => $content,
            'timestamp' => round(microtime(true) * 1000),
            'time' => date('H:i:s')
        ];
        $msgs[] = $msg;
        saveMessages($msgs);
        echo json_encode(['success' => true, 'message' => $msg]);
        break;

    case 'inbox':
        $since = intval($_GET['since'] ?? 0);
        $role = $_GET['role'] ?? ''; // filter by role
        $msgs = loadMessages();

        if ($since > 0) {
            $msgs = array_values(array_filter($msgs, function($m) use ($since) {
                return $m['timestamp'] > $since;
            }));
        }
        if ($role) {
            $msgs = array_values(array_filter($msgs, function($m) use ($role) {
                return $m['role'] === $role;
            }));
        }

        echo json_encode(['messages' => $msgs]);
        break;

    case 'ping':
        if ($apiKey !== API_KEY) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid API key']);
            break;
        }
        // Store agent last-seen timestamp
        file_put_contents(__DIR__ . '/data/agent_status.json', json_encode([
            'online' => true,
            'lastSeen' => time(),
            'hostname' => $input['hostname'] ?? 'unknown'
        ], JSON_UNESCAPED_UNICODE), LOCK_EX);
        echo json_encode(['success' => true]);
        break;

    case 'agent_status':
        $statusFile = __DIR__ . '/data/agent_status.json';
        if (file_exists($statusFile)) {
            $status = json_decode(file_get_contents($statusFile), true);
            $status['online'] = (time() - $status['lastSeen']) < 60;
            echo json_encode($status);
        } else {
            echo json_encode(['online' => false]);
        }
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Unknown action. Use: health, login, send, inbox, ping, agent_status']);
}
