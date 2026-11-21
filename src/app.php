<?php
// Shared core: config, database, sessions, rendering, mail and HTTP helpers.
declare(strict_types=1);

const ROOT = __DIR__ . '/..';

// cfg(null) returns every setting, which bin/config-json.php hands to the Python service.
function cfg(?string $key)
{
    static $c = null;
    if ($c === null) {
        $file = getenv('AGENDA_CONFIG') ?: ROOT . '/config.php';
        $c = (is_file($file) ? require $file : []) + (require ROOT . '/config.example.php');
    }
    return $key === null ? $c : ($c[$key] ?? null);
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $dir = cfg('data_dir');
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    $pdo = new PDO('sqlite:' . $dir . '/agenda.db', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    // WAL lets the web, the agents' adtool calls and the notifier share the file.
    // Foreign keys on, so removing a monitor, target or user removes what hangs off it. Without them SQLite reuses
    // the id, and the next monitor anyone adds would inherit the old one's agendas, agent and notification rules.
    $pdo->exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    $pdo->exec(file_get_contents(__DIR__ . '/schema.sql'));
    return $pdo;
}

function q(string $sql, array $args = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st;
}
function row(string $sql, array $args = []): ?array { return q($sql, $args)->fetch() ?: null; }
function rows(string $sql, array $args = []): array { return q($sql, $args)->fetchAll(); }
function val(string $sql, array $args = []) { $v = q($sql, $args)->fetchColumn(); return $v === false ? null : $v; }

function h(?string $s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
// Counts one attempt at $key and says whether there have been more than $max in the last $seconds.
// Kept in the database, so dropping a cookie doesn't reset it.
function too_many(string $key, int $max, int $seconds): bool
{
    if (random_int(1, 200) === 1) q('DELETE FROM hit WHERE at < ?', [time() - 86400 * 2]);
    $n = (int)val('SELECT count(*) FROM hit WHERE key = ? AND at > ?', [$key, time() - $seconds]);
    if ($n >= $max) return true;
    q('INSERT INTO hit (key, at) VALUES (?, ?)', [$key, time()]);
    return false;
}

function client_ip(): string { return (string)($_SERVER['REMOTE_ADDR'] ?? 'cli'); }

// A link from stored data: only http(s), so a javascript: URL an agent was fed can't run in someone's browser.
function href(?string $url): string { return preg_match('#^https?://#i', (string)$url) ? h($url) : '#'; }

// A Font Awesome icon, decorative only: the text beside it carries the meaning.
// $spin turns it while something is in progress; the spinner icon always does.
function icon(string $name, string $set = 'solid', bool $spin = false): string
{
    $spin = $spin || $name === 'spinner';
    return '<i class="fa-' . $set . ' fa-' . $name . ' fa-fw' . ($spin ? ' fa-spin' : '') . '" aria-hidden="true"></i>';
}

function slugify(string $s): string
{
    $s = strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '-', $s), '-'));
    return substr($s, 0, 48) ?: 'monitor';
}

// ---- sessions and auth --------------------------------------------------

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 60,
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => str_starts_with((string)cfg('base_url'), 'https'),
    ]);
    session_name('ad');
    ini_set('session.use_strict_mode', '1');  // a session ID the server didn't make is replaced, not adopted
    // Sessions are kept with the data for as long as the cookie lasts. Ubuntu's shared session folder is purged
    // after 24 idle minutes by a cron job, which signed everyone out after a short break.
    $dir = rtrim((string)cfg('data_dir'), '/') . '/sessions';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    ini_set('session.save_path', $dir);
    ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 60));
    ini_set('session.gc_probability', '1');  // PHP clears expired ones itself, about once in 1000 requests
    ini_set('session.gc_divisor', '1000');
    session_start();
}

function user(): ?array
{
    static $u = false;
    if ($u !== false) return $u;
    start_session();
    $u = empty($_SESSION['uid']) ? null : row('SELECT * FROM user WHERE id = ?', [$_SESSION['uid']]);
    return $u;
}

function require_user(): array
{
    $u = user();
    if (!$u) redirect('/login?next=' . urlencode($_SERVER['REQUEST_URI'] ?? '/'));
    return $u;
}

function is_admin(?array $u): bool
{
    return $u && in_array(strtolower($u['email']), array_map('strtolower', cfg('admin_emails')), true);
}

// $verified is false only for a new address that hasn't proved it's theirs yet; it can reach the join step and nothing else.
function login_as(string $email, string $name = '', ?string $googleSub = null, bool $verified = true): void
{
    $u = row('SELECT * FROM user WHERE email = ?', [$email]);
    if (!$u) {
        q('INSERT INTO user (email, name, google_sub) VALUES (?, ?, ?)', [$email, $name, $googleSub]);
        $id = (int)db()->lastInsertId();
    } else {
        $id = (int)$u['id'];
        if ($googleSub && !$u['google_sub']) q('UPDATE user SET google_sub = ? WHERE id = ?', [$googleSub, $id]);
        if ($name && !$u['name']) q('UPDATE user SET name = ? WHERE id = ?', [$name, $id]);
    }
    start_session();
    session_regenerate_id(true);
    $_SESSION['uid'] = $id;
    $_SESSION['verified'] = $verified;
    q("UPDATE user SET last_seen = datetime('now') WHERE id = ?", [$id]);
}

// Where to go after signing in: only a path on this site.
function safe_next($n): string
{
    $n = (string)$n;
    // Browsers read a backslash as a slash, so /\evil.example is another site too.
    return preg_match('#^/(?![/\\\\])[^\\\\\x00-\x1f]*$#', $n) ? $n : '/';
}

function csrf_token(): string
{
    start_session();
    return $_SESSION['csrf'] ??= bin2hex(random_bytes(16));
}
function csrf_field(): string { return '<input type="hidden" name="csrf" value="' . csrf_token() . '">'; }
function check_csrf(): void
{
    if (!hash_equals(csrf_token(), (string)($_POST['csrf'] ?? ''))) {
        http_response_code(400);
        exit('Form expired. Go back and try again.');
    }
}

function flash(?string $msg = null, string $type = 'success'): ?array
{
    start_session();
    if ($msg !== null) { $_SESSION['flash'] = [$msg, $type]; return null; }
    $f = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return $f;
}

function redirect(string $to): void
{
    header('Location: ' . $to);
    exit;
}

function render(string $view, array $vars = []): void
{
    extract($vars);
    $me = user();
    ob_start();
    require __DIR__ . "/views/$view.php";
    $content = ob_get_clean();
    require __DIR__ . '/views/layout.php';
}

// ---- outbound ------------------------------------------------------------

// Plain fetch. Only http(s), never to a private address, and that's checked again at every redirect,
// with curl held to the address that was checked, so neither a redirect nor DNS rebinding can point it inside.
function http_request(string $method, string $url, ?string $body = null, array $headers = [], int $timeout = 20): array
{
    $opts = [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers, CURLOPT_ENCODING => '', CURLOPT_TIMEOUT => $timeout];
    if ($body !== null) $opts[CURLOPT_POSTFIELDS] = $body;
    return fetch_url($url, $opts);
}

// Runs curl on $url, following up to 5 redirects by hand. With CURLOPT_FILE in $opts the body goes to that
// file; otherwise it's returned, up to 40 MB. Returns [HTTP code, body or error].
function fetch_url(string $url, array $opts): array
{
    $fh = $opts[CURLOPT_FILE] ?? null;
    for ($hop = 0; $hop <= 5; $hop++) {
        $ip = public_address($url);
        if ($ip === null) return [0, 'blocked url'];
        $p = parse_url($url);
        $port = $p['port'] ?? ($p['scheme'] === 'https' ? 443 : 80);
        if ($fh) { ftruncate($fh, 0); rewind($fh); }
        $ch = curl_init($url);
        curl_setopt_array($ch, $opts + [
            CURLOPT_RETURNTRANSFER => !$fh,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
            CURLOPT_NOPROGRESS     => false,
            CURLOPT_PROGRESSFUNCTION => fn($c, $dlTotal, $dl) => $dl > ($fh ? 150 : 40) * 1024 * 1024 ? 1 : 0,
        ]);
        if ($fh) curl_setopt($ch, CURLOPT_FILE, $fh);
        if ($ip !== $p['host']) curl_setopt($ch, CURLOPT_RESOLVE, ["{$p['host']}:$port:$ip"]);
        $out = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $next = (string)curl_getinfo($ch, CURLINFO_REDIRECT_URL);
        $err = curl_error($ch);
        curl_close($ch);
        if ($code < 300 || $code >= 400 || $next === '') return [$code, $out === false ? $err : $out];
        $url = $next;
        if (($opts[CURLOPT_CUSTOMREQUEST] ?? 'GET') === 'POST' && in_array($code, [301, 302, 303], true)) {
            $opts[CURLOPT_CUSTOMREQUEST] = 'GET';
            unset($opts[CURLOPT_POSTFIELDS]);
        }
    }
    return [0, 'too many redirects'];
}

function safe_url(string $url): bool
{
    return public_address($url) !== null;
}

// The address $url may be fetched from: a public IP, or the host itself for a test site named in config. Null if neither.
function public_address(string $url): ?string
{
    $p = parse_url($url);
    if (!$p || !in_array($p['scheme'] ?? '', ['http', 'https'], true) || empty($p['host']) || isset($p['user'])) return null;
    // Test councils run on loopback ports; config lists them so the agents may read them.
    foreach ((array)cfg('test_sites') as $t) {
        if ($url === rtrim($t, '/') || str_starts_with($url, rtrim($t, '/') . '/')) return $p['host'];
    }
    // ponytail: the first IPv4 address only; a host with only IPv6 addresses is refused
    $ip = filter_var($p['host'], FILTER_VALIDATE_IP) ? $p['host'] : gethostbyname($p['host']);
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) ? $ip : null;
}

function post_json(string $url, array $body, array $headers = [], int $timeout = 20): array
{
    return http_request('POST', $url, json_encode($body), array_merge(['Content-Type: application/json'], $headers), $timeout);
}

// Mail goes through the host's Postfix via sendmail, which signs it with DKIM. It always comes from mail_from.
// $opt may hold 'from_name' (shown as "Name via agenda.delivery"), 'reply_to' (an email address), 'unsubscribe'
// (a link, sent as the headers mail apps use for their own unsubscribe button) and 'html' (the same message as
// HTML, sent beside the plain text so mail apps show whichever they prefer).
function send_mail(string $to, string $subject, string $text, array $opt = []): bool
{
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) return false;
    // Only letters, numbers, spaces and a little punctuation reach the From line, so it can't carry a header or a link.
    $name = trim((string)preg_replace('/[^\p{L}\p{N} \'&,()-]+/u', '', (string)($opt['from_name'] ?? '')));
    $label = mb_substr($name, 0, 40) . ' via agenda.delivery';
    $from = $name === '' ? 'agenda.delivery' : (preg_match('/^[\x20-\x7e]+$/', $label) ? "\"$label\"" : mb_encode_mimeheader($label, 'UTF-8', 'B', "\r\n"));
    $headers = "From: $from <" . cfg('mail_from') . '>';
    if (filter_var($opt['reply_to'] ?? '', FILTER_VALIDATE_EMAIL)) $headers .= "\r\nReply-To: {$opt['reply_to']}";
    if (preg_match('#^https?://[^\s<>]+$#', (string)($opt['unsubscribe'] ?? ''))) {
        $headers .= "\r\nList-Unsubscribe: <{$opt['unsubscribe']}>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click";
    }
    if (isset($opt['html'])) {
        // Two versions of one message. The HTML is quoted-printable, which keeps its lines short enough for any mail server.
        $edge = 'ad-' . bin2hex(random_bytes(12));
        $headers .= "\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"$edge\"";
        $text = "--$edge\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: 8bit\n\n$text\n\n"
            . "--$edge\nContent-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\n"
            . str_replace("\r\n", "\n", quoted_printable_encode($opt['html'])) . "\n\n--$edge--\n";
    } else {
        $headers .= "\r\nContent-Type: text/plain; charset=utf-8";
    }
    // With mail_capture set, mail is appended to that file instead of sent, for development and the self-check.
    if ($file = cfg('mail_capture')) {
        return file_put_contents($file, "To: $to\nSubject: $subject\n" . str_replace("\r\n", "\n", $headers) . "\n\n$text\n\n", FILE_APPEND) !== false;
    }
    return mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $text, $headers, '-f' . cfg('mail_from'));
}

// A call to the agenda delivery service's API on its Unix socket. Null when the service can't be reached.
function service(string $method, string $path, ?array $body = null, int $timeout = 10): ?array
{
    $ch = curl_init('http://service' . $path);
    curl_setopt_array($ch, [
        CURLOPT_UNIX_SOCKET_PATH => cfg('service_socket'),
        CURLOPT_CUSTOMREQUEST    => $method,
        CURLOPT_RETURNTRANSFER   => true,
        CURLOPT_TIMEOUT          => $timeout,
        CURLOPT_HTTPHEADER       => ['Content-Type: application/json'],
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $out = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return ($out === false || $code === 0) ? null : json_decode((string)$out, true);
}

// One chat call to Ollama Cloud, logged to ai_usage.
function llm(string $system, string $user, ?int $monitorId = null, string $source = 'prompt'): string
{
    [$code, $out] = post_json(rtrim(cfg('ollama_base'), '/') . '/v1/chat/completions', [
        'model'    => cfg('model'),
        'messages' => [['role' => 'system', 'content' => $system], ['role' => 'user', 'content' => $user]],
    ], ['Authorization: Bearer ' . cfg('ollama_key')], 120);  // a long agenda takes the model 15 to 30 seconds
    $j = json_decode((string)$out, true);
    if ($code !== 200 || !isset($j['choices'][0]['message']['content'])) {
        throw new RuntimeException("LLM call failed ($code)");
    }
    q('INSERT INTO ai_usage (monitor_id, source, model, prompt_tokens, completion_tokens) VALUES (?, ?, ?, ?, ?)', [
        $monitorId, $source, cfg('model'), $j['usage']['prompt_tokens'] ?? 0, $j['usage']['completion_tokens'] ?? 0,
    ]);
    return trim($j['choices'][0]['message']['content']);
}

function monitor_kinds(): array
{
    return [
        'council' => 'Council', 'regional_district' => 'Regional district', 'school_board' => 'School board',
        'committee' => 'Committee', 'organization' => 'Organization', 'other' => 'Other',
    ];
}

function ago(?string $ts): string
{
    if (!$ts) return 'never';
    $d = time() - strtotime($ts . ' UTC');
    if ($d < 0) {
        $d = -$d;
        return 'in ' . ($d < 3600 ? max(1, intdiv($d, 60)) . ' min' : ($d < 86400 ? intdiv($d, 3600) . ' h' : intdiv($d, 86400) . ' d'));
    }
    if ($d < 60) return 'just now';
    if ($d < 3600) return intdiv($d, 60) . ' min ago';
    if ($d < 86400) return intdiv($d, 3600) . ' h ago';
    return intdiv($d, 86400) . ' d ago';
}
