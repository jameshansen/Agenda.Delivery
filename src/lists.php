<?php
// Mailing lists, the addresses on them, and unsubscribing.
declare(strict_types=1);

const LISTS_PER_ACCOUNT = 5;
const MEMBERS_PER_LIST = 100;
const INVITES_PER_DAY = 100;

// A name that reaches people who haven't confirmed yet: letters, numbers, spaces and a little punctuation only,
// so a confirmation request can't carry a link or an advertisement. Null if it holds anything else.
function plain_label(string $s, int $max = 60): ?string
{
    $s = trim((string)preg_replace('/\s+/', ' ', $s));
    return $s !== '' && mb_strlen($s) <= $max && preg_match('/^[\p{L}\p{N} \'&,()-]+$/u', $s) ? $s : null;
}

// Whether this address has unsubscribed from this account's mail, or from everyone's.
function is_blocked(string $email, int $uid): bool
{
    return (bool)val('SELECT 1 FROM mail_block WHERE email = ? AND (user_id IS NULL OR user_id = ?)', [$email, $uid]);
}

function unsub_url(string $token): string { return cfg('base_url') . '/unsubscribe?u=' . $token; }

// A mailing list is a destination of kind "list". Returns [its id, null] or [null, what went wrong].
function create_list(int $uid, array $in): array
{
    $name = plain_label((string)($in['name'] ?? ''));
    if ($name === null) return [null, 'Name the list with letters, numbers and spaces, up to 60 characters.'];
    if ((int)val("SELECT count(*) FROM target WHERE user_id = ? AND kind = 'list'", [$uid]) >= LISTS_PER_ACCOUNT) {
        return [null, 'Each account can keep up to ' . LISTS_PER_ACCOUNT . ' mailing lists.'];
    }
    if (val("SELECT 1 FROM target WHERE user_id = ? AND kind = 'list' AND name = ? COLLATE NOCASE", [$uid, $name])) return [null, 'You already have a list with that name.'];
    q("INSERT INTO target (user_id, kind, name, address, confirmed) VALUES (?, 'list', ?, '', 1)", [$uid, $name]);
    return [(int)db()->lastInsertId(), null];
}

function own_list(int $uid, int $id): ?array
{
    return row("SELECT * FROM target WHERE id = ? AND user_id = ? AND kind = 'list'", [$id, $uid]);
}

// The list's name, who its mail says it's from, the text around each send and when it sends.
function save_list(array $list, array $in): ?string
{
    $name = plain_label((string)($in['name'] ?? ''));
    if ($name === null) return 'Name the list with letters, numbers and spaces, up to 60 characters.';
    if (val("SELECT 1 FROM target WHERE user_id = ? AND kind = 'list' AND name = ? COLLATE NOCASE AND id != ?", [$list['user_id'], $name, $list['id']])) {
        return 'You already have a list with that name.';
    }
    // How it sends: as agenda.delivery, or as custom with the organization from Settings or a name and logo of its own.
    $brand = ($in['send_as'] ?? '') !== 'custom' ? 'agenda' : (($in['brand_source'] ?? '') === 'list' ? 'list' : 'account');
    $sender = $brand === 'list' ? trim((string)($in['sender_name'] ?? '')) : (string)$list['sender_name'];
    if ($brand === 'list' && $sender !== '' && ($sender = plain_label($sender, 40)) === null) return 'The name to send as takes letters, numbers and spaces, up to 40 characters.';
    $intro = trim((string)($in['intro'] ?? ''));
    $footer = trim((string)($in['footer'] ?? ''));
    if (mb_strlen($intro) > 1000 || mb_strlen($footer) > 1000) return 'The opening and closing text can each be up to 1000 characters.';
    [$digest, $day] = digest_choice('list', $in);
    // The list's own colours, set alongside its own name and logo, or none to use the account's.
    $colours = (string)($list['mail_colours'] ?? '');
    if ($brand === 'list') {
        require_once __DIR__ . '/colours.php';
        if (!empty($in['colours_inherit'])) $colours = '';
        elseif (isset($in['colour_fg'])) {
            [$colours, $err] = check_colours($in);
            if ($err) return $err;
            // The default picked on purpose is kept as the default's own value, so it doesn't fall back to the account's.
            if ($colours === '') $colours = implode(',', MAIL_COLOURS);
        }
    }
    q('UPDATE target SET name = ?, brand = ?, sender_name = ?, reply_to_owner = ?, intro = ?, footer = ?, digest = ?, digest_day = ?, mail_colours = ? WHERE id = ?', [
        $name, $brand, $sender, empty($in['reply_to_owner']) ? 0 : 1, $intro, $footer, $digest, $day, $colours, $list['id'],
    ]);
    return null;
}

// Addresses from pasted text or a CSV: one per line as "sam@example.com", "Sam Rivers <sam@example.com>",
// "sam@example.com, Sam Rivers" or "Sam Rivers, sam@example.com", or several addresses on a line with commas.
// Returns [[email => name], [rows that held no address]].
function parse_addresses(string $raw): array
{
    $valid = $invalid = [];
    foreach (preg_split('/\r\n?|\n/', $raw) as $i => $line) {
        $line = trim($line);
        // A spreadsheet's heading row.
        if ($line === '' || ($i === 0 && !str_contains($line, '@') && stripos($line, 'mail') !== false)) continue;
        foreach (substr_count($line, '@') > 1 ? preg_split('/[,;]+/', $line) : [$line] as $entry) {
            $entry = trim($entry, " \t\"'");
            if ($entry === '') continue;
            if (preg_match('/^(.*?)<([^>]+)>$/', $entry, $mm)) {
                [$name, $email] = [trim($mm[1], " \t\"'"), trim($mm[2])];
            } else {
                $parts = array_values(array_filter(array_map(fn($p) => trim($p, " \t\"'"), preg_split('/[,;\t]+/', $entry)), 'strlen'));
                $email = current(array_filter($parts, fn($p) => (bool)filter_var($p, FILTER_VALIDATE_EMAIL))) ?: '';
                $name = implode(' ', array_filter($parts, fn($p) => $p !== $email));
            }
            $email = strtolower($email);
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { $invalid[] = mb_strimwidth($entry, 0, 60, '…'); continue; }
            $valid[$email] ??= mb_substr($name, 0, 80);
        }
    }
    return [$valid, $invalid];
}

// Adds addresses to a list and asks each to confirm. Returns how many were added, asked, already there,
// unsubscribed, over the list's size, held back by a sending limit, and the rows that held no address.
function add_members(array $list, string $raw): array
{
    [$valid, $invalid] = parse_addresses($raw);
    $uid = (int)$list['user_id'];
    $owner = (string)val('SELECT email FROM user WHERE id = ?', [$uid]);
    $r = ['added' => 0, 'asked' => 0, 'already' => 0, 'unsubscribed' => 0, 'full' => 0, 'held' => 0, 'invalid' => $invalid];
    $count = (int)val('SELECT count(*) FROM list_member WHERE target_id = ?', [$list['id']]);
    foreach ($valid as $email => $name) {
        $email = (string)$email;
        if (val('SELECT 1 FROM list_member WHERE target_id = ? AND email = ?', [$list['id'], $email])) { $r['already']++; continue; }
        // Once an address unsubscribes, only its owner can bring it back.
        if (is_blocked($email, $uid)) { $r['unsubscribed']++; continue; }
        if ($count >= MEMBERS_PER_LIST) { $r['full']++; continue; }
        $own = strcasecmp($email, $owner) === 0;
        // Confirmation requests are limited for the account by the day and for each address by the week,
        // whoever is asking, so a list can't be used to pester anyone.
        if (!$own && (too_many("invite-day:$uid", INVITES_PER_DAY, 86400) || too_many("invite:$email", 3, 604800))) { $r['held']++; continue; }
        q("INSERT INTO list_member (target_id, user_id, email, name, status, unsub_token, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
            $list['id'], $uid, $email, $name, $own ? 'active' : 'pending', bin2hex(random_bytes(24)), $own ? gmdate('Y-m-d H:i:s') : null,
        ]);
        $count++;
        $r['added']++;
        if (!$own && invite_member((int)db()->lastInsertId())) $r['asked']++;
    }
    return $r;
}

// What add_members did, as a sentence or two for the page.
function describe_added(array $r): string
{
    $n = fn(int $c, string $one, string $many) => $c . ' ' . ($c === 1 ? $one : $many);
    $out = [];
    if ($r['added']) $out[] = $n($r['added'], 'address', 'addresses') . ' added' . ($r['asked'] ? ', and ' . ($r['asked'] === $r['added'] ? 'each was' : $n($r['asked'], 'was', 'were')) . ' sent a link to confirm' : '') . '.';
    if ($r['already']) $out[] = $n($r['already'], 'was', 'were') . ' already on the list.';
    if ($r['unsubscribed']) $out[] = $n($r['unsubscribed'], 'has', 'have') . ' unsubscribed, and only the address itself can subscribe again.';
    if ($r['full']) $out[] = $n($r['full'], "didn't", "didn't") . ' fit: a list holds up to ' . MEMBERS_PER_LIST . ' addresses.';
    if ($r['held']) $out[] = $n($r['held'], 'was', 'were') . ' held back by the limit on confirmation emails. Add them again tomorrow.';
    if ($r['invalid']) $out[] = $n(count($r['invalid']), "row didn't", "rows didn't") . ' hold an email address: ' . implode('; ', array_slice($r['invalid'], 0, 5)) . (count($r['invalid']) > 5 ? ' and more.' : '.');
    return $out ? implode(' ', $out) : 'No addresses found. Paste one per line.';
}

// Sends a list address its confirmation link. Nothing else reaches it until that link is used.
function invite_member(int $id): bool
{
    $m = row('SELECT lm.*, t.name AS list, u.email AS owner FROM list_member lm JOIN target t ON t.id = lm.target_id JOIN user u ON u.id = lm.user_id WHERE lm.id = ?', [$id]);
    if (!$m || $m['status'] !== 'pending' || is_blocked($m['email'], (int)$m['user_id'])) return false;
    $token = bin2hex(random_bytes(24));
    q("UPDATE list_member SET confirm_hash = ?, invited_at = datetime('now') WHERE id = ?", [hash('sha256', $token), $id]);
    return send_mail($m['email'], "Confirm your subscription to {$m['list']}",
        "{$m['owner']} added this address to \"{$m['list']}\", a mailing list that sends agenda.delivery summaries of public meetings.\n\n"
        . "If you want them, confirm here:\n" . cfg('base_url') . "/confirm?t=$token\n\n"
        . "If you don't, ignore this email and nothing more is sent. To stop any more requests from this account:\n" . unsub_url($m['unsub_token']));
}

// Confirms the list address a link was sent for. Returns the address, or null if the link is unknown or used.
function confirm_member(string $token): ?string
{
    $m = row("SELECT * FROM list_member WHERE confirm_hash = ? AND status = 'pending'", [hash('sha256', $token)]);
    if (!$m || is_blocked($m['email'], (int)$m['user_id'])) return null;
    q("UPDATE list_member SET status = 'active', confirm_hash = NULL, confirmed_at = datetime('now') WHERE id = ?", [$m['id']]);
    return $m['email'];
}

// Who an unsubscribe link belongs to: an address on a mailing list or an email destination. Null for an unknown link.
function unsubscribe_subject(string $token): ?array
{
    if (!preg_match('/^[a-f0-9]{48}$/', $token)) return null;
    $s = row("SELECT 'member' AS type, lm.id, lm.email, lm.user_id, t.name AS list, u.email AS owner
        FROM list_member lm JOIN target t ON t.id = lm.target_id JOIN user u ON u.id = lm.user_id WHERE lm.unsub_token = ?", [$token])
      ?: row("SELECT 'target' AS type, t.id, t.address AS email, t.user_id, '' AS list, u.email AS owner
        FROM target t JOIN user u ON u.id = t.user_id WHERE t.unsub_token = ? AND t.kind = 'email' AND t.is_default = 0", [$token]);
    return $s ? $s + ['blocked' => is_blocked($s['email'], (int)$s['user_id'])] : null;
}

// Stops this account's notification mail to the address, or with $everything, every account's. It stays stopped:
// the address can't be added again by anyone until its owner subscribes again from the same link.
function unsubscribe(array $s, bool $everything = false): void
{
    q('INSERT OR IGNORE INTO mail_block (email, user_id) VALUES (?, ?)', [$s['email'], $everything ? null : $s['user_id']]);
    $who = $everything ? '' : ' AND user_id = ' . (int)$s['user_id'];
    q("UPDATE list_member SET status = 'unsubscribed', confirm_hash = NULL WHERE email = ?$who", [$s['email']]);
    q("UPDATE target SET confirmed = 0 WHERE kind = 'email' AND is_default = 0 AND lower(address) = lower(?)$who", [$s['email']]);
}

// Undoes an unsubscribe for the list or destination the link came from. An address that never confirmed still has to.
function resubscribe(array $s): void
{
    q('DELETE FROM mail_block WHERE email = ? AND (user_id IS NULL OR user_id = ?)', [$s['email'], $s['user_id']]);
    if ($s['type'] === 'member') {
        q("UPDATE list_member SET status = CASE WHEN confirmed_at IS NULL THEN 'pending' ELSE 'active' END WHERE id = ?", [$s['id']]);
    } else {
        q('UPDATE target SET confirmed = 1 WHERE id = ? AND confirm_hash IS NULL', [$s['id']]);
    }
}
