<?php
// Monitors, the sites they watch, notification destinations and rules.
declare(strict_types=1);

const MONITOR_LIST_SQL = "SELECT m.*, s.agenda_url, s.setup_state, s.health, a.actual_state, a.last_run_end, a.next_run, a.last_exit,
    (SELECT count(*) FROM agenda g WHERE g.monitor_id = m.id) AS agendas,
    (SELECT count(*) FROM pending_item p WHERE p.monitor_id = m.id AND p.open = 1) AS pending,
    (SELECT max(found_at) FROM agenda g WHERE g.monitor_id = m.id) AS latest
  FROM monitor m JOIN site s ON s.id = m.site_id LEFT JOIN agent a ON a.monitor_id = m.id";

function user_monitors(int $uid): array
{
    return rows(MONITOR_LIST_SQL . ' WHERE m.user_id = ? ORDER BY m.name', [$uid]);
}

// The monitor with its site, by the account's own number for it, only if it belongs to this account.
function own_monitor(int $uid, int $num): ?array
{
    return row("SELECT m.*, s.agenda_url, s.layout_notes, s.members, s.meeting_types AS site_types, s.setup_state, s.health,
        s.repair_monitor, s.repair_note, s.name AS site_name
        FROM monitor m JOIN site s ON s.id = m.site_id WHERE m.num = ? AND m.user_id = ?", [$num, $uid]);
}

// A monitor's address: the account's number for it, then its name, which is only there to read and is ignored.
function monitor_url(array $m, string $action = ''): string
{
    return '/m/' . (int)$m['num'] . '/' . slugify((string)$m['name']) . ($action !== '' ? '/' . ltrim($action, '/') : '');
}

function normalize_url(string $url): string
{
    $url = trim($url);
    if ($url !== '' && !preg_match('#^https?://#i', $url)) $url = 'https://' . $url;
    return rtrim($url, '/');
}

// Every account watching the same agenda page and video page shares one site record: how the pages work,
// the meeting types and the member names. Each account still gets its own monitor and agent.
function create_monitor(int $uid, array $in): array
{
    $name = trim((string)($in['name'] ?? ''));
    $agendaUrl = normalize_url((string)($in['agenda_url'] ?? ''));
    $videoUrl = normalize_url((string)($in['video_url'] ?? ''));
    $kind = array_key_exists($in['kind'] ?? '', monitor_kinds()) ? $in['kind'] : 'other';
    if (($in['visibility'] ?? 'public') !== 'public') return [null, 'Private organizations are coming soon. For now agenda.delivery watches public pages only.'];
    if ($name === '' || mb_strlen($name) > 120) return [null, 'Give the organization a name.'];
    if (!filter_var($agendaUrl, FILTER_VALIDATE_URL) || !safe_url($agendaUrl)) return [null, 'The agenda page address needs to be a public web address.'];
    if ($videoUrl !== '' && (!filter_var($videoUrl, FILTER_VALIDATE_URL) || !safe_url($videoUrl))) return [null, 'The video page address needs to be a public web address.'];
    if ((int)val('SELECT count(*) FROM monitor WHERE user_id = ?', [$uid]) >= 10) return [null, 'Each account can have up to ten monitors.'];

    $site = find_site($agendaUrl, $videoUrl, $name);
    if (val('SELECT 1 FROM monitor WHERE user_id = ? AND site_id = ?', [$uid, $site['id']])) {
        return [null, 'You already monitor that agenda page.'];
    }

    // A site another agent has already learned skips straight to choosing.
    $state = $site['setup_state'] === 'ready' ? 'choose' : 'setup';
    // The account's next number, never reused, so an old address can't come to mean another monitor.
    q('UPDATE user SET monitor_seq = monitor_seq + 1 WHERE id = ?', [$uid]);
    $num = (int)val('SELECT monitor_seq FROM user WHERE id = ?', [$uid]);
    q('INSERT INTO monitor (slug, num, user_id, site_id, name, kind, visibility, video_url, video_source, state, summary_prompt, voice_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        'new-' . bin2hex(random_bytes(6)), $num, $uid, $site['id'], $name, $kind, 'public', $videoUrl, ($in['video_source'] ?? '') === 'youtube' ? 'youtube' : 'page',
        $state, default_summary_prompt(), default_voice($uid)['id'],
    ]);
    $id = (int)db()->lastInsertId();
    // The agent's key is the monitor's own id, so nothing a person typed reaches its folder, gateway or logs.
    $slug = "m-$id";
    q('UPDATE monitor SET slug = ? WHERE id = ?', [$slug, $id]);
    q('INSERT INTO agent (monitor_id, home, unit) VALUES (?, ?, ?)', [$id, rtrim(cfg('data_dir'), '/') . "/agents/$slug", "agent:$slug"]);
    // A new monitor starts out sending its summaries to the account's own email address.
    q('INSERT INTO rule (user_id, monitor_id, target_id) VALUES (?, ?, ?)', [$uid, $id, default_target($uid)['id']]);
    nudge_service($slug);
    flash($state === 'choose'
        ? "$name is added. Choose the meetings to follow and how its summaries are written."
        : "$name is added. Its agent is learning how the site works and which meetings it has, which takes a few minutes.");
    return [row('SELECT * FROM monitor WHERE id = ?', [$id]), null];
}

// The site for this agenda page and video page, made if it's new. A new site starts from what's known about
// $copyFrom (the same agenda page with another video page), so changing a video page doesn't mean setting up again.
function find_site(string $agendaUrl, string $videoUrl, string $name, ?array $copyFrom = null): array
{
    $site = row('SELECT * FROM site WHERE agenda_url = ? AND video_url = ?', [$agendaUrl, $videoUrl]);
    if ($site) return $site;
    q('INSERT INTO site (agenda_url, video_url, name) VALUES (?, ?, ?)', [$agendaUrl, $videoUrl, $name]);
    $id = (int)db()->lastInsertId();
    if ($copyFrom) {
        q('UPDATE site SET layout_notes = ?, members = ?, meeting_types = ?, setup_state = ? WHERE id = ?', [$copyFrom['layout_notes'],
            $copyFrom['members'], $copyFrom['meeting_types'], $copyFrom['setup_state'] === 'ready' ? 'ready' : 'pending', $id]);
    }
    return row('SELECT * FROM site WHERE id = ?', [$id]);
}

// Removing a monitor removes its agent and everything it found. The site and its notes stay for other accounts.
function remove_monitor(int $uid, int $mid): void
{
    $slug = (string)val('SELECT slug FROM monitor WHERE id = ? AND user_id = ?', [$mid, $uid]);
    if ($slug === '') return;
    q('DELETE FROM monitor WHERE id = ?', [$mid]);
    nudge_service($slug);
}

// The site's meeting types, as found at setup: [key => ['name' => ..., 'default' => bool]].
function site_meeting_types(string $json): array
{
    $out = [];
    foreach (json_decode($json, true) ?: [] as $t) {
        if (!empty($t['key'])) $out[$t['key']] = ['name' => (string)($t['name'] ?? $t['key']), 'default' => !empty($t['default'])];
    }
    return $out;
}

// Saves which meeting types a monitor tracks and its summary prompt; a monitor that was choosing starts now.
function save_choices(array $m, array $in): ?string
{
    $types = site_meeting_types($m['site_types']);
    $picked = array_values(array_intersect(array_keys($types), (array)($in['types'] ?? [])));
    if (!$picked) return 'Pick at least one kind of meeting to follow.';
    [$refused, $cols] = voice_choice($m, $in);
    if ($refused) return $refused;
    save_monitor_voice($m, $cols);
    q("UPDATE monitor SET meeting_types = ?, state = 'ready' WHERE id = ?", [json_encode($picked), $m['id']]);
    if ($m['state'] !== 'ready') {
        q('UPDATE agent SET run_requested = 1 WHERE monitor_id = ?', [$m['id']]);
        nudge_service($m['slug']);
    }
    return null;
}

// The database holds what each agent should be doing and the service checks it every 10 seconds;
// this just tells it to look now. Nothing is lost if the service can't be reached.
function nudge_service(string $slug): void
{
    service('POST', "/agents/$slug/sync", null, 2);
}


// ---- destinations and rules ------------------------------------------------

// The account's own email address as a destination. Every account has one; it can be paused but not removed.
function default_target(int $uid): array
{
    $t = row('SELECT * FROM target WHERE user_id = ? AND is_default = 1', [$uid]);
    if ($t) return $t;
    q("INSERT OR IGNORE INTO target (user_id, kind, name, address, confirmed, is_default) SELECT id, 'email', 'My email', email, 1, 1 FROM user WHERE id = ?", [$uid]);
    return row('SELECT * FROM target WHERE user_id = ? AND is_default = 1', [$uid]);
}

// When a destination sends: [digest, weekday]. Only email and mailing lists can wait for a digest.
function digest_choice(string $kind, array $in): array
{
    $digest = in_array($in['digest'] ?? '', ['daily', 'weekly'], true) && in_array($kind, ['email', 'list'], true) ? $in['digest'] : 'now';
    return [$digest, max(1, min(7, (int)($in['digest_day'] ?? 1)))];
}

function add_target(int $uid, array $in): ?string
{
    $kind = $in['kind'] ?? '';
    $name = trim((string)($in['name'] ?? ''));
    $addr = trim((string)($in['address'] ?? ''));
    if (!in_array($kind, ['email', 'discord', 'pushover', 'webhook', 'whatsapp'], true)) return 'Pick a destination type.';
    if ($kind === 'whatsapp') {
        // It sends to one of the linked account's groups, chosen once it's linked; nothing is entered here.
        $addr = '';
        if (!whatsapp_available()) return "WhatsApp isn't available on this site.";
        if (val("SELECT 1 FROM target WHERE user_id = ? AND kind = 'whatsapp'", [$uid])) return 'Each account can link one WhatsApp.';
        if ((int)val("SELECT count(*) FROM target WHERE kind = 'whatsapp'") >= (int)(cfg('whatsapp_max') ?: 20)) return "WhatsApp is full on this site for now. Try again later.";
        if ($name === '') $name = 'WhatsApp';
    }
    $token = $kind === 'pushover' ? trim((string)($in['token'] ?? '')) : '';
    if ($kind === 'email') $addr = strtolower($addr);
    if ($name === '') $name = $kind === 'email' ? $addr : ucfirst($kind);
    if ($kind === 'email' && !filter_var($addr, FILTER_VALIDATE_EMAIL)) return 'That email address does not look right.';
    if ($kind === 'discord' && !preg_match('#^https://(?:ptb\.|canary\.)?discord(?:app)?\.com/api/webhooks/\d+/[\w-]+$#', $addr)) {
        return 'Paste the full Discord webhook URL, from Channel settings, Integrations, Webhooks.';
    }
    if ($kind === 'webhook' && (!filter_var($addr, FILTER_VALIDATE_URL) || !str_starts_with($addr, 'https://') || !safe_url($addr))) {
        return 'Webhooks need a public https:// address.';
    }
    if ($kind === 'pushover' && ($err = check_pushover($uid, $addr, $token))) return $err;
    if ($kind === 'email' && strcasecmp($addr, (string)val('SELECT email FROM user WHERE id = ?', [$uid])) === 0) {
        return 'Your own address is already your default destination.';
    }
    if (val('SELECT 1 FROM target WHERE user_id = ? AND kind = ? AND lower(address) = lower(?)', [$uid, $kind, $addr])) return 'You already have that destination.';
    if ((int)val('SELECT count(*) FROM target WHERE user_id = ?', [$uid]) >= 25) return 'Each account can keep up to 25 destinations.';
    if ($kind === 'email') {
        // Once an address unsubscribes, only its owner can bring it back, from the link in the mail it was sent.
        if (is_blocked($addr, $uid)) return 'That address has unsubscribed, so it can\'t be added. Its owner can subscribe again from the link in any email it was sent.';
        if (too_many("confirm-mail:$uid", 5, 86400)) return "You've added a few email addresses today. Try again tomorrow.";
        if (too_many("invite:$addr", 3, 604800)) return 'That address has been asked to confirm a few times this week. Try again in a few days.';
    }
    q('INSERT INTO target (user_id, kind, name, address, token, confirmed, unsub_token) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        $uid, $kind, mb_substr($name, 0, 80), $addr, $token, $kind === 'email' ? 0 : 1, $kind === 'email' ? bin2hex(random_bytes(24)) : null,
    ]);
    if ($kind === 'email') send_target_confirmation((int)db()->lastInsertId());
    return null;
}

// Checks a Pushover user key, and the account's own app token if it gave one, with Pushover itself, so a typo is
// caught now rather than at the first meeting. Returns null, or what's wrong.
function check_pushover(int $uid, string $user, string $token): ?string
{
    if (!preg_match('/^[A-Za-z0-9]{30}$/', $user)) return 'Paste your Pushover user key, the 30 letters and numbers at the top of your Pushover dashboard.';
    if ($token !== '' && !preg_match('/^[A-Za-z0-9]{30}$/', $token)) return 'A Pushover app token is 30 letters and numbers, from the application you made at pushover.net.';
    if ($token === '' && !cfg('pushover_token')) return 'Paste an app token as well: make an application at pushover.net and copy its token.';
    if (too_many("pushover-check:$uid", 10, 3600)) return "That's a lot of tries in an hour. Wait a little and try again.";
    [$code, $out] = http_request('POST', 'https://api.pushover.net/1/users/validate.json',
        http_build_query(['token' => $token !== '' ? $token : cfg('pushover_token'), 'user' => $user]), ['Content-Type: application/x-www-form-urlencoded'], 15);
    $r = json_decode((string)$out, true);
    if ($code === 200 && ($r['status'] ?? 0) === 1) return null;
    if ($code >= 400 && $code < 500) return 'Pushover says ' . (($r['errors'][0] ?? '') ?: 'that key or token is not valid') . '. Check it and try again.';
    return "Pushover didn't answer just now. Try again in a few minutes.";
}

// Renames a destination and sets when it sends. The address stays as it is.
function update_target(array $t, array $in): ?string
{
    $name = trim((string)($in['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 80) return 'Give the destination a name of up to 80 characters.';
    [$digest, $day] = digest_choice($t['kind'], $in);
    q('UPDATE target SET name = ?, digest = ?, digest_day = ? WHERE id = ?', [$name, $digest, $day, $t['id']]);
    // WhatsApp sends to one group, and only one the linked account is in right now, by WhatsApp's own list.
    if ($t['kind'] === 'whatsapp' && ($gid = (string)($in['group'] ?? '')) !== '' && $gid !== $t['address']) {
        [, $groups] = wa_call((int)$t['id'], 'GET', '/groups', null, 8);
        $pick = current(array_filter((array)$groups, fn($g) => ($g['id'] ?? '') === $gid));
        if (!$pick || !preg_match('/^[0-9]+(-[0-9]+)?@g\.us$/', $gid)) return "That group isn't one of this WhatsApp's groups. Reload the page and choose again.";
        q('UPDATE target SET address = ?, wa_group = ? WHERE id = ?', [$gid, mb_substr((string)$pick['name'], 0, 100), $t['id']]);
    }
    return null;
}

// Asks the owner of an email address to confirm they want notifications from this account.
function send_target_confirmation(int $tid): bool
{
    $t = row('SELECT t.*, u.email AS owner FROM target t JOIN user u ON u.id = t.user_id WHERE t.id = ?', [$tid]);
    if (!$t || $t['kind'] !== 'email' || $t['confirmed'] || is_blocked($t['address'], (int)$t['user_id'])) return false;
    $token = bin2hex(random_bytes(24));
    $unsub = $t['unsub_token'] ?: bin2hex(random_bytes(24));
    q('UPDATE target SET confirm_hash = ?, unsub_token = ? WHERE id = ?', [hash('sha256', $token), $unsub, $tid]);
    return send_mail($t['address'], 'Confirm agenda.delivery notifications',
        "{$t['owner']} wants to send agenda.delivery meeting notifications to this address.\n\n"
        . "If you want them, confirm here:\n" . cfg('base_url') . "/confirm?t=$token\n\n"
        . "If you don't, ignore this email and nothing more is sent. To stop any more requests from this account:\n" . unsub_url($unsub));
}

// Confirms the destination a link was sent for. Returns its address, or null if the link is unknown or used.
function confirm_target(string $token): ?string
{
    $t = row('SELECT * FROM target WHERE confirm_hash = ? AND confirmed = 0', [hash('sha256', $token)]);
    if (!$t || is_blocked($t['address'], (int)$t['user_id'])) return null;
    q('UPDATE target SET confirmed = 1, confirm_hash = NULL WHERE id = ?', [$t['id']]);
    return $t['address'];
}

function add_rule(int $uid, int $mid, array $in): ?string
{
    $target = row('SELECT * FROM target WHERE id = ? AND user_id = ?', [(int)($in['target_id'] ?? 0), $uid]);
    if (!$target) return 'Pick a destination.';
    $content = in_array($in['content'] ?? '', ['summary', 'link', 'keywords', 'prompt'], true) ? $in['content'] : 'summary';
    $keywords = $content === 'keywords' ? trim((string)($in['keywords'] ?? '')) : '';
    $prompt = $content === 'prompt' ? trim((string)($in['prompt'] ?? '')) : '';
    if ($content === 'keywords' && ($keywords === '' || mb_strlen($keywords) > 500)) return 'List at least one keyword, up to 500 characters in all.';
    if ($content === 'prompt' && ($prompt === '' || mb_strlen($prompt) > 1000)) return 'Write a prompt of up to 1000 characters.';
    // A notification's own prompt runs on every new agenda, so it's screened like a summary prompt.
    if ($content === 'prompt' && ($refused = screen_summary_prompt($prompt, $mid))) return $refused;
    $events = array_values(array_intersect(['agenda', 'video', 'pending'], (array)($in['events'] ?? [])));
    if (!$events) return 'Pick at least one kind of update.';
    if ((int)val('SELECT count(*) FROM rule WHERE user_id = ?', [$uid]) >= 50) return 'Each account can keep up to 50 notifications.';
    q('INSERT INTO rule (user_id, monitor_id, target_id, content, keywords, prompt, events) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        $uid, $mid, $target['id'], $content, $keywords, $prompt, implode(',', $events),
    ]);
    return null;
}

// The account's destinations, its own address first, each with how much it's used, what's waiting for its next
// digest, whether its address unsubscribed and, for a mailing list, how many addresses are in each state.
function user_targets(int $uid): array
{
    default_target($uid);
    return rows("SELECT t.*,
        (SELECT count(*) FROM rule r WHERE r.target_id = t.id) AS uses,
        (SELECT max(d.sent_at) FROM delivery d JOIN rule r ON r.id = d.rule_id WHERE r.target_id = t.id AND d.state = 'sent') AS last_sent,
        (SELECT count(*) FROM digest_item i WHERE i.target_id = t.id) AS waiting,
        (SELECT count(*) FROM list_member lm WHERE lm.target_id = t.id AND lm.status = 'active') AS active,
        (SELECT count(*) FROM list_member lm WHERE lm.target_id = t.id AND lm.status = 'pending') AS pending,
        (SELECT count(*) FROM list_member lm WHERE lm.target_id = t.id AND lm.status = 'unsubscribed') AS unsubscribed,
        EXISTS (SELECT 1 FROM mail_block b WHERE t.kind = 'email' AND b.email = t.address AND (b.user_id IS NULL OR b.user_id = t.user_id)) AS blocked
      FROM target t WHERE t.user_id = ? ORDER BY t.is_default DESC, t.kind = 'list', t.name COLLATE NOCASE", [$uid]);
}

// How each kind of destination is shown: [label, icon, colour].
function destination_kinds(): array
{
    return [
        'email'   => ['Email', icon('envelope'), 'var(--o-blue)'],
        'list'    => ['Mailing list', icon('users'), 'var(--o-blue)'],
        'discord' => ['Discord', icon('discord', 'brands'), 'var(--o-mint)'],
        'pushover' => ['Pushover', icon('mobile-screen'), 'var(--o-mint)'],
        'whatsapp' => ['WhatsApp', icon('whatsapp', 'brands'), 'var(--o-mint)'],
        'webhook' => ['Webhook', icon('code'), 'var(--o-yellow)'],
    ];
}

const WEEKDAYS = [1 => 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// When a destination sends, in words.
function digest_label(array $t): string
{
    $hour = date('g a', mktime((int)cfg('digest_hour'), 0, 0));
    if ($t['digest'] === 'daily') return "Daily roundup at $hour";
    if ($t['digest'] === 'weekly') return 'Weekly roundup on ' . (WEEKDAYS[(int)$t['digest_day']] ?? 'Monday') . " at $hour";
    return 'Sends straight away';
}

// What a rule sends, in words: "Agendas, Videos · Keyword matches: bike lane".
function rule_label(array $r): string
{
    $events = ['agenda' => 'Agendas', 'video' => 'Videos', 'pending' => 'Pending items'];
    $content = ['summary' => 'Summary', 'link' => 'Link only', 'keywords' => 'Keyword matches', 'prompt' => 'Custom prompt'];
    return implode(', ', array_map(fn($e) => $events[$e] ?? $e, explode(',', $r['events']))) . ' · ' . ($content[$r['content']] ?? $r['content'])
        . ($r['content'] === 'keywords' ? ': ' . $r['keywords'] : '') . ($r['content'] === 'prompt' ? ': ' . mb_strimwidth($r['prompt'], 0, 90, '…') : '');
}
