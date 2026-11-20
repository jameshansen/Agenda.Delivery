<?php
// Joining: a new address goes straight to the join step, without an email code, and gets in with a sign-up code
// or a short registration that an admin approves. Either way it's sent a sign-in link, and opening that link is
// what proves the address is theirs. Google sign-ins are proved already.
declare(strict_types=1);

function is_member(array $u): bool
{
    return $u['status'] === 'approved' || is_admin($u);
}

// A member whose session has proved its email address: the only kind that gets past the join step.
function member_session(?array $u): bool
{
    return $u && is_member($u) && !empty($_SESSION['verified']);
}

function send_sign_in_link(string $email, string $subject, string $intro): bool
{
    $t = bin2hex(random_bytes(24));
    q("INSERT INTO login_link (token_hash, email, expires_at) VALUES (?, ?, datetime('now', '+7 days'))", [hash('sha256', $t), $email]);
    return send_mail($email, $subject, "$intro\n\nSign in here:\n" . cfg('base_url') . "/login/link?t=$t\n\nThe link works once, for 7 days. "
        . "After that, sign in with your email for a code.");
}

// Returns the email a link was sent to, using the link up, or null if it's unknown, used or expired.
function use_sign_in_link(string $t): ?string
{
    $r = row("SELECT * FROM login_link WHERE token_hash = ? AND expires_at > datetime('now')", [hash('sha256', $t)]);
    if (!$r) return null;
    q('DELETE FROM login_link WHERE token_hash = ?', [$r['token_hash']]);
    return $r['email'];
}

// Returns null when the code let them in, or what went wrong.
function join_with_code(array $u, string $code): ?string
{
    $code = trim($code);
    if (too_many('signup-code:' . client_ip(), 5, 3600)) return 'Too many tries. Wait an hour, or fill in the registration instead.';
    $c = $code === '' ? null : row('SELECT * FROM signup_code WHERE code = ? AND (uses_left IS NULL OR uses_left > 0)', [$code]);
    if (!$c) {
        return "That code didn't work. Check it with whoever gave it to you, or fill in the registration instead.";
    }
    q('UPDATE signup_code SET used = used + 1, uses_left = CASE WHEN uses_left IS NULL THEN NULL ELSE uses_left - 1 END WHERE code = ?', [$c['code']]);
    q("UPDATE user SET status = 'approved', signup_code = ? WHERE id = ?", [$c['code'], $u['id']]);
    return null;
}

function join_fields(): array
{
    return [
        'name' => 'Your name', 'organization' => 'Organization or group', 'community' => 'Your community',
        'about' => 'Who you are', 'use_for' => "What you'll use it for",
    ];
}

// Returns null when the request is in, or what's missing.
function submit_join_request(array $u, array $in): ?string
{
    $v = [];
    foreach (join_fields() as $k => $label) {
        $v[$k] = trim(mb_substr((string)($in[$k] ?? ''), 0, $k === 'about' || $k === 'use_for' ? 1500 : 150));
        if ($v[$k] === '' && $k !== 'organization') return "$label is needed.";
    }
    if (mb_strlen($v['use_for']) < 20) return "Say a little more about what you'll use it for.";
    if (too_many('join:' . client_ip(), 3, 86400)) return "We've had a few requests from here today already. Try again tomorrow.";
    q('INSERT OR REPLACE INTO join_request (user_id, name, organization, community, about, use_for) VALUES (?, ?, ?, ?, ?, ?)',
        [$u['id'], $v['name'], $v['organization'], $v['community'], $v['about'], $v['use_for']]);
    q("UPDATE user SET status = 'pending', name = CASE WHEN name = '' THEN ? ELSE name END WHERE id = ?", [$v['name'], $u['id']]);
    foreach ((array)cfg('admin_emails') as $admin) {
        send_mail($admin, "New agenda.delivery request: {$v['name']}",
            "{$v['name']} ({$u['email']}) asked to join.\n\nOrganization: " . ($v['organization'] ?: 'none') . "\nCommunity: {$v['community']}\n\n"
            . "Who they are:\n{$v['about']}\n\nWhat they'll use it for:\n{$v['use_for']}\n\nApprove or decline it at " . cfg('base_url') . "/admin#a-signups");
    }
    return null;
}

function decide_join(int $uid, bool $approve): void
{
    $u = row('SELECT * FROM user WHERE id = ?', [$uid]);
    if (!$u) return;
    q("UPDATE user SET status = ? WHERE id = ?", [$approve ? 'approved' : 'declined', $uid]);
    q("UPDATE join_request SET decided_at = datetime('now') WHERE user_id = ?", [$uid]);
    if ($approve) {
        send_sign_in_link($u['email'], "You're in at agenda.delivery",
            "Your agenda.delivery account is approved. Use the link below to sign in, then add the first agenda page you want to follow.");
    }
}

// Adds a sign-up code; a blank code gets a random one. Returns the code, or null if it's taken.
function create_signup_code(array $in): ?string
{
    $code = preg_replace('/[^A-Za-z0-9-]/', '', (string)($in['code'] ?? ''));
    // A short code could be guessed, so anything under 8 characters gets a random one instead.
    if (strlen($code) < 8) {
        $code = '';
        $abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        for ($i = 0; $i < 10; $i++) $code .= $abc[random_int(0, strlen($abc) - 1)];
    }
    $uses = (int)($in['uses'] ?? 0);
    if (val('SELECT 1 FROM signup_code WHERE code = ?', [$code])) return null;
    q('INSERT INTO signup_code (code, note, uses_left) VALUES (?, ?, ?)', [mb_substr($code, 0, 40), mb_substr(trim((string)($in['note'] ?? '')), 0, 200), $uses > 0 ? $uses : null]);
    return $code;
}
