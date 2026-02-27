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
define('UPLOAD_DIR', __DIR__ . '/uploads/');
define('MAX_UPLOAD_SIZE', 10 * 1024 * 1024); // 10MB
define('ALLOWED_TYPES', ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'video/mp4', 'video/webm', 'application/pdf']);

// Ensure directories exist
if (!is_dir(__DIR__ . '/data'))
    mkdir(__DIR__ . '/data', 0755, true);
if (!is_dir(UPLOAD_DIR))
    mkdir(UPLOAD_DIR, 0755, true);

// ─── Helper: load messages ───────────────────────────────────────────────
function loadMessages()
{
    if (!file_exists(MSG_FILE))
        return [];
    $data = json_decode(file_get_contents(MSG_FILE), true);
    return is_array($data) ? $data : [];
}

function saveMessages($msgs)
{
    $msgs = array_slice($msgs, -MAX_MESSAGES);
    file_put_contents(MSG_FILE, json_encode($msgs, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function validateToken($token)
{
    $tokenFile = __DIR__ . '/data/tokens.json';
    $tokens = file_exists($tokenFile) ? json_decode(file_get_contents($tokenFile), true) : [];
    return isset($tokens[$token]) && $tokens[$token]['expires'] >= time();
}

function getBaseUrl()
{
    $proto = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    return $proto . '://' . $_SERVER['HTTP_HOST'] . dirname($_SERVER['SCRIPT_NAME']);
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
        $role = $input['role'] ?? 'user';
        $token = $input['token'] ?? ($apiKey ?: '');
        $attachment = $input['attachment'] ?? null; // {url, type, name}

        if (empty($content) && empty($attachment)) {
            http_response_code(400);
            echo json_encode(['error' => 'Empty message']);
            break;
        }

        if ($role === 'agent' && $token !== API_KEY) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid API key']);
            break;
        }
        if ($role === 'user' && !validateToken($token)) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid or expired token']);
            break;
        }

        $msgs = loadMessages();
        $msg = [
            'id' => uniqid('msg_', true),
            'role' => $role,
            'content' => $content ?: '',
            'timestamp' => round(microtime(true) * 1000),
            'time' => date('H:i:s')
        ];
        if ($attachment) {
            $msg['attachment'] = $attachment;
        }
        $msgs[] = $msg;
        saveMessages($msgs);
        echo json_encode(['success' => true, 'message' => $msg]);
        break;

    case 'upload':
        // File upload endpoint
        $token = $_POST['token'] ?? ($apiKey ?: '');
        $role = $_POST['role'] ?? 'user';

        // Auth
        if ($role === 'agent' && $token !== API_KEY) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid API key']);
            break;
        }
        if ($role === 'user' && !validateToken($token)) {
            http_response_code(403);
            echo json_encode(['error' => 'Invalid or expired token']);
            break;
        }

        if (empty($_FILES['file'])) {
            http_response_code(400);
            echo json_encode(['error' => 'No file uploaded']);
            break;
        }

        $file = $_FILES['file'];
        if ($file['error'] !== UPLOAD_ERR_OK) {
            http_response_code(400);
            echo json_encode(['error' => 'Upload error: ' . $file['error']]);
            break;
        }
        if ($file['size'] > MAX_UPLOAD_SIZE) {
            http_response_code(400);
            echo json_encode(['error' => 'File too large (max 10MB)']);
            break;
        }

        $mime = mime_content_type($file['tmp_name']);
        if (!in_array($mime, ALLOWED_TYPES)) {
            http_response_code(400);
            echo json_encode(['error' => 'File type not allowed: ' . $mime]);
            break;
        }

        // Generate unique filename
        $ext = pathinfo($file['name'], PATHINFO_EXTENSION) ?: 'bin';
        $newName = uniqid('file_') . '.' . strtolower($ext);
        $destPath = UPLOAD_DIR . $newName;

        if (!move_uploaded_file($file['tmp_name'], $destPath)) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to save file']);
            break;
        }

        $fileUrl = getBaseUrl() . '/uploads/' . $newName;
        $mediaType = explode('/', $mime)[0]; // image, audio, video, application

        echo json_encode([
            'success' => true,
            'file' => [
                'url' => $fileUrl,
                'name' => $file['name'],
                'type' => $mediaType,
                'mime' => $mime,
                'size' => $file['size']
            ]
        ]);
        break;

    case 'inbox':
        $since = intval($_GET['since'] ?? 0);
        $role = $_GET['role'] ?? '';
        $msgs = loadMessages();

        if ($since > 0) {
            $msgs = array_values(array_filter($msgs, function ($m) use ($since) {
                return $m['timestamp'] > $since;
            }));
        }
        if ($role) {
            $msgs = array_values(array_filter($msgs, function ($m) use ($role) {
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
        $input = json_decode(file_get_contents('php://input'), true) ?: [];
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
        echo json_encode(['error' => 'Unknown action. Use: health, login, send, upload, inbox, ping, agent_status']);
}
