<?php
// Fans unsent events out to the rules that want them, straight away or into a destination's next digest.
declare(strict_types=1);
require_once __DIR__ . '/monitors.php';   // monitor_url(), for bin/tick.php, which loads only this file
require_once __DIR__ . '/lists.php';
require_once __DIR__ . '/media.php';
require_once __DIR__ . '/colours.php';
require_once __DIR__ . '/whatsapp.php';

// Sends one message to a destination. Returns [null or a short error, how many addresses or endpoints it reached].
function deliver(array $t, string $subject, string $text, string $url, array $extra = []): array
{
    $uid = (int)$t['user_id'];
    if ($t['kind'] === 'email' || $t['kind'] === 'list') {
        $owner = row('SELECT * FROM user WHERE id = ?', [$uid]);
        $send = function (string $to, string $unsub = '') use ($t, $owner, $subject, $text, $url): int {
            $mail = notification_mail($t, $owner, $subject, $text, $url, $unsub, $to);
            return send_mail($to, $mail['subject'], $mail['text'], $mail['opt']) ? 1 : 0;
        };
        if ($t['kind'] === 'email' && $t['is_default']) return $send($t['address']) ? [null, 1] : ['mail not accepted', 0];
        if ($t['kind'] === 'email') {
            // Someone else's address: only once its owner has confirmed, and never after they unsubscribe.
            if (!$t['confirmed'] || is_blocked($t['address'], $uid)) return ['the address has not confirmed', 0];
            if (!$t['unsub_token']) q('UPDATE target SET unsub_token = ? WHERE id = ?', [$t['unsub_token'] = bin2hex(random_bytes(24)), $t['id']]);
            return $send($t['address'], unsub_url($t['unsub_token'])) ? [null, 1] : ['mail not accepted', 0];
        }
        $n = $tried = 0;
        foreach (rows("SELECT * FROM list_member WHERE target_id = ? AND status = 'active'", [$t['id']]) as $m) {
            if (is_blocked($m['email'], $uid)) continue;
            $tried++;
            $n += $send($m['email'], unsub_url($m['unsub_token']));
        }
        return [$n ? null : ($tried ? 'mail not accepted' : 'no confirmed addresses'), $n];
    }
    if ($t['kind'] === 'whatsapp') return wa_send($t, $subject, $text, $url);
    if ($t['kind'] === 'pushover') {
        // A phone notification: the subject as its title, the news trimmed to Pushover's 1024 characters, and the link.
        $msg = mb_strlen($text) > 1024 ? mb_substr($text, 0, 1020) . '…' : $text;
        [$code, $out] = http_request('POST', 'https://api.pushover.net/1/messages.json', http_build_query(array_filter([
            'token' => $t['token'] !== '' ? $t['token'] : cfg('pushover_token'), 'user' => $t['address'],
            'title' => mb_substr($subject, 0, 250), 'message' => $msg !== '' ? $msg : $subject,
            'url' => mb_strlen($url) <= 512 ? $url : '', 'url_title' => $url !== '' && mb_strlen($url) <= 512 ? 'Read the agenda' : '',
        ])), ['Content-Type: application/x-www-form-urlencoded']);
        $r = json_decode((string)$out, true);
        return $code === 200 && ($r['status'] ?? 0) === 1 ? [null, 1] : ["Pushover: HTTP $code " . mb_substr(implode(' ', (array)($r['errors'] ?? [])), 0, 200), 0];
    }
    if ($t['kind'] === 'discord') {
        $msg = "**$subject**\n" . $text . ($url ? "\n$url" : '');
        if (mb_strlen($msg) > 2000) $msg = mb_substr($msg, 0, 1990 - mb_strlen($url)) . "…\n$url";
        [$code, $out] = post_json($t['address'], ['content' => $msg, 'allowed_mentions' => ['parse' => []]]);
    } else {
        [$code, $out] = post_json($t['address'], ['subject' => $subject, 'text' => $text, 'url' => $url] + $extra);
    }
    return ($code >= 200 && $code < 300) ? [null, 1] : ["HTTP $code " . mb_substr((string)$out, 0, 200), 0];
}

function event_subject(string $monitor, string $kind, string $title): string
{
    return "$monitor: " . (['agenda' => 'New agenda', 'video' => 'New video', 'pending' => 'Pending item update'][$kind] ?? 'Update') . ", $title";
}

// The name, logo and colours a destination's mail goes out under. Only a mailing list set to send as custom has any:
// the account's organization from Settings, or the list's own, which falls back to the account's where it's empty.
// Everything else, mail to the account's own address included, uses the agenda.delivery default.
function branding(array $t, array $owner): array
{
    if ($t['kind'] !== 'list' || !in_array($t['brand'], ['account', 'list'], true)) return ['name' => '', 'logo' => '', 'colours' => MAIL_COLOURS];
    $own = $t['brand'] === 'list';
    return [
        'name' => $own && $t['sender_name'] !== '' ? $t['sender_name'] : $owner['org_name'],
        'logo' => $own && $t['logo'] !== '' ? $t['logo'] : $owner['logo'],
        'colours' => mail_colours($own && ($t['mail_colours'] ?? '') !== '' ? $t['mail_colours'] : (string)($owner['mail_colours'] ?? '')),
    ];
}

// One notification email, as sent to one address of an email destination or mailing list: its subject, the plain
// text, the same as HTML, and the options send_mail() takes (sender name, reply address, unsubscribe link).
// A list's opening and closing text go around the news, and the last lines say why it came and how to stop it.
function notification_mail(array $t, array $owner, string $subject, string $text, string $url, string $unsub = '', string $to = ''): array
{
    $list = $t['kind'] === 'list';
    $brand = branding($t, $owner);
    $body = $text . ($url ? ($text === '' ? '' : "\n\n") . $url : '');
    [$intro, $footer] = $list ? [$t['intro'], $t['footer']] : ['', ''];
    $why = $unsub === '' ? 'Manage notifications at ' . cfg('base_url') . '/notifications'
        : ($list ? "You get this because you confirmed your subscription to {$t['name']}, sent by {$owner['email']} through agenda.delivery."
                 : "You get these because you confirmed notifications from {$owner['email']} on agenda.delivery.");
    $plain = ($intro !== '' ? "$intro\n\n" : '') . $body . ($footer !== '' ? "\n\n$footer" : '') . "\n\n--\n$why" . ($unsub !== '' ? "\nUnsubscribe: $unsub" : '');
    $card = mail_card($brand, $subject, $intro, $text, $url, $footer, $why, $unsub, $list ? $t['name'] : '', $to !== '' ? $to : $owner['email']);
    $html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
        . '<body style="margin:0;padding:0;background:' . ($brand['colours'] ?? MAIL_COLOURS)['bg1'] . '">' . "\n"
        . '<div style="display:none;max-height:0;overflow:hidden">' . h(mb_substr(trim((string)preg_replace('/\s+/', ' ', $text)), 0, 140)) . "</div>\n$card\n</body></html>";
    return ['subject' => $subject, 'text' => $plain, 'html' => $html, 'card' => $card, 'from_name' => $brand['name'], 'opt' => [
        'from_name' => $brand['name'], 'reply_to' => $list && $t['reply_to_owner'] ? $owner['email'] : '', 'unsubscribe' => $unsub, 'html' => $html,
    ]];
}

// The agenda.delivery email: a cream page, the wordmark (or a list's logo and name) above a white card with the news
// in Georgia, a button to the agenda, and the small print below. Event subjects ("Monitor: New agenda, Title") give
// the card its label, heading and subtitle; any other subject is the heading. Everything someone wrote is escaped.
function mail_card(array $brand, string $subject, string $intro, string $text, string $url, string $footer, string $why,
    string $unsub, string $listName = '', string $to = ''): string
{
    $serif = "font-family:Georgia,'Times New Roman',serif";
    $sans = 'font-family:Arial,Helvetica,sans-serif';
    // Colours come from mail_colours(), so each is a checked #rrggbb.
    ['fg' => $fg, 'bg1' => $bg1, 'bg2' => $bg2] = $brand['colours'] ?? MAIL_COLOURS;
    if (preg_match('/^(.+?): (New agenda|New video|Pending item update), (.+)$/u', $subject, $m)) {
        [, $heading, $label, $sub] = $m;
    } else {
        [$heading, $label, $sub] = [$subject, '', ''];
    }

    if ($brand['name'] !== '' || $brand['logo'] !== '') {
        $top = '<td align="center" style="padding:4px 4px 18px">'
            . ($brand['logo'] !== '' && media_path($brand['logo'])
                ? '<img src="' . h(logo_url($brand['logo'])) . '" alt="' . h($brand['name']) . '" style="display:block;max-width:180px;max-height:90px;width:auto;height:auto;border:0;margin:0 auto 10px">' : '')
            . ($brand['name'] !== '' ? "<div style=\"$serif;font-size:20px;color:$fg\">" . h($brand['name']) . '</div>' : '')
            . ($listName !== '' ? "<div style=\"$sans;font-size:13px;color:#6f6c60;margin-top:2px\">" . ($listName !== $brand['name'] ? h($listName) . ' &middot; ' : '') . date('F j, Y') . '</div>' : '')
            . '</td>';
    } else {
        $top = "<td style=\"padding:0 4px 14px;$serif;font-size:22px\"><a href=\"" . h((string)cfg('base_url')) . '" style="text-decoration:none">'
            . "<span style=\"color:$fg\">agenda</span><span style=\"color:" . ($fg === MAIL_COLOURS['fg'] ? '#4f8a2f' : $fg) . "\">.delivery</span></a></td>";
    }

    $pill = "display:inline-block;margin:0 8px 8px 0;padding:11px 22px;border-radius:999px;border:1px solid $fg;$sans;font-size:14px;font-weight:bold;text-decoration:none";
    $button = '';
    if ($url !== '') {
        $toSite = str_starts_with($url, (string)cfg('base_url'));
        $button = '<div style="margin-top:22px"><a href="' . h($url) . "\" style=\"$pill;background:$fg;color:#ffffff\">"
            . ($toSite ? 'Open on agenda.delivery' : ($label === 'New video' ? 'Watch the meeting' : 'Read the agenda')) . '</a></div>';
    }
    $small = $unsub !== ''
        ? ($to !== '' ? 'Sent to ' . h($to) . ' &middot; ' : '') . '<a href="' . h($unsub) . "\" style=\"color:$fg\">Unsubscribe</a><br>"
            . h($why) . "<br>Delivered by <a href=\"https://agenda.delivery\" style=\"color:$fg\">agenda.delivery</a>"
        : link_urls($why, $fg);

    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' . $bg1 . ';padding:24px 12px">' . "\n"
        . '<tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">' . "\n"
        . "<tr>$top</tr>\n"
        . "<tr><td style=\"background:#ffffff;border:1px solid #e4e0d2;border-radius:14px;padding:28px;$serif;color:#1c1b16;font-size:16px;line-height:1.6\">\n"
        . ($label !== '' ? "<div style=\"$sans;font-size:12px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:$fg\">" . h($label) . "</div>\n" : '')
        . '<h1 style="margin:' . ($label !== '' ? '6px' : '0') . ' 0 4px;font-size:26px;line-height:1.25;font-weight:normal;color:#1c1b16">' . h($heading) . "</h1>\n"
        . ($sub !== '' ? "<div style=\"margin:0 0 20px;$sans;font-size:14px;line-height:1.5;color:#6f6c60\">" . h($sub) . "</div>\n" : "<div style=\"height:14px\"></div>\n")
        . text_to_html($intro, $fg) . text_to_html($text, $fg) . text_to_html($footer, $fg) . $button
        . "</td></tr>\n"
        . '<tr><td style="padding:16px 18px;' . ($unsub !== '' ? "background:$bg2;border-radius:12px;" : '') . "$sans;font-size:12px;line-height:1.5;color:#6f6c60;text-align:center\">$small</td></tr>\n"
        . '</table></td></tr></table>';
}

// A short sample email in the given colours, name and logo, for the colour picker's preview.
function colour_preview(array $colours, string $name, string $logo): string
{
    return mail_card(['name' => $name, 'logo' => $logo, 'colours' => $colours], 'City of Example: New agenda, Regular Council Meeting', '',
        "Council meets Monday at 7 pm in Council Chambers.\n\n• Third reading of Zoning Amendment Bylaw 2140, allowing up to four homes on lots near the town centre.",
        'https://example.com/agenda.pdf', '', 'You get this because you confirmed your subscription.', cfg('base_url') . '/unsubscribe?u=sample', $name, 'sam@example.com');
}

// Escapes text and turns the web addresses in it into links.
function link_urls(string $text, string $colour = '#3d5e2b'): string
{
    $out = '';
    foreach (preg_split('#(https?://[^\s<>"\']*[^\s<>"\'.,;:!?)])#', $text, -1, PREG_SPLIT_DELIM_CAPTURE) as $i => $part) {
        $out .= $i % 2 ? '<a href="' . h($part) . '" style="color:' . h($colour) . '">' . h($part) . '</a>' : h($part);
    }
    return $out;
}

// Plain text as simple HTML: blank lines separate paragraphs, lines that start with a bullet become a list,
// and a line of dashes (between the items of a digest) becomes a rule.
function text_to_html(string $text, string $link = '#3d5e2b'): string
{
    $out = '';
    $p = 'margin:0 0 14px';
    foreach (preg_split('/\n\s*\n/', trim(str_replace("\r", '', $text))) as $block) {
        if ($block === '') continue;
        if (preg_match('/^(?:- ){2,}-$/', trim($block))) { $out .= '<hr style="border:0;border-top:1px solid #e4e0d2;margin:22px 0">' . "\n"; continue; }
        $para = $items = [];
        $flush = function () use (&$out, &$para, &$items, $p, $link) {
            if ($para) $out .= "<p style=\"$p\">" . implode("<br>\n", array_map(fn($x) => link_urls($x, $link), $para)) . "</p>\n";
            if ($items) $out .= "<ul style=\"$p;padding-left:22px\">\n" . implode('', array_map(fn($i) => '<li style="margin:0 0 6px">' . link_urls($i, $link) . "</li>\n", $items)) . "</ul>\n";
            $para = $items = [];
        };
        foreach (explode("\n", $block) as $line) {
            if (preg_match('/^\s*[•*-]\s+(.+)$/u', $line, $mm)) { if ($para) $flush(); $items[] = $mm[1]; }
            else { if ($items) $flush(); $para[] = $line; }
        }
        $flush();
    }
    return $out;
}

// A made-up agenda notification from a made-up city, laid out for this list exactly as a real one would be.
// It's what the list's Preview tab shows and what "Send me a test" sends. The unsubscribe link is the account's
// own if its address is on the list, and otherwise a sample that unsubscribes no one.
function sample_list_mail(array $list, array $owner): array
{
    $token = val('SELECT unsub_token FROM list_member WHERE target_id = ? AND email = ?', [$list['id'], $owner['email']]);
    return notification_mail($list, $owner, event_subject('City of Example', 'agenda', 'Regular Council Meeting'),
        "Council meets Monday at 7 pm in Council Chambers, and the meeting is streamed on the city's website.\n\n"
        . "The main items:\n"
        . "• Third reading of Zoning Amendment Bylaw 2140, which would allow up to four homes on lots within 400 metres of the town centre. Council can adopt it at the following meeting.\n"
        . "• A staff report on the Main Street sidewalk program, asking for \$1.2 million in next year's budget to finish the stretch between 2nd and 5th Avenue.\n"
        . "• A request from the farmers' market to close Mill Street on Saturdays from May to September.\n\n"
        . "Anyone can speak to the zoning bylaw at the start of the meeting by signing up with the clerk before 4 pm that day.",
        'https://example.com/council/agendas/regular-council-meeting.pdf', unsub_url($token ?: 'sample'));
}

// Why a destination gets nothing right now, or null when it can be sent to.
function skip_reason(array $t): ?string
{
    if ($t['paused']) return 'The destination is paused';
    if (!$t['confirmed']) return 'The address has not confirmed';
    if ($t['kind'] === 'list' && !val("SELECT 1 FROM list_member WHERE target_id = ? AND status = 'active'", [$t['id']])) return 'No one on the list has confirmed yet';
    if ($t['kind'] === 'email' && !$t['is_default'] && is_blocked($t['address'], (int)$t['user_id'])) return 'The address unsubscribed';
    return null;
}

// Sentences of $text that mention any keyword as whole words, or null when none match.
function keyword_hits(string $text, string $keywords): ?string
{
    $words = array_values(array_filter(array_map('trim', preg_split('/[,\n]+/', $keywords))));
    if (!$words) return null;
    // Whole words only, so "8 Avenue" doesn't match "48 Avenue".
    $pattern = '/(?<![\p{L}\p{N}])(?:' . implode('|', array_map(fn($w) => preg_quote($w, '/'), $words)) . ')(?![\p{L}\p{N}])/iu';
    // PDF text breaks at every printed line; join lines back into paragraphs before splitting sentences.
    $text = preg_replace(["/[ \t]+/", "/(?<!\n)\n(?!\n)/"], [' ', ' '], $text);
    $hits = [];
    // "Bylaw No. 6227" and "St." don't end a sentence.
    foreach (preg_split('/(?<=[.!?])(?<!\bNo\.)(?<!\bSt\.)(?<!\bAve\.)\s+|\n{2,}/', $text) as $s) {
        $s = trim($s);
        if ($s === '' || !preg_match($pattern, $s)) continue;
        $hits[] = '• ' . mb_strimwidth($s, 0, 300, '…');
        if (count($hits) >= 10) break;
    }
    return $hits ? 'Matches for ' . implode(', ', $words) . ":\n" . implode("\n", array_unique($hits)) : null;
}

// What a rule sends for an event, or null when it should stay quiet.
function shape(array $rule, array $ev): ?string
{
    $source = $ev['text'] ?: $ev['body'];
    switch ($rule['content']) {
        case 'link':     return '';
        case 'keywords': return keyword_hits($source, $rule['keywords']);
        case 'prompt':
            return llm("You read public meeting material for someone and answer their standing request about it. Be brief and specific. If nothing in the material is relevant, reply with exactly NOTHING.",
                "Request: {$rule['prompt']}\n\nMaterial ({$ev['title']}):\n" . mb_substr($source, 0, 60000), (int)$ev['monitor_id']);
        default:         return $ev['body'];
    }
}

// Each waiting event goes to every rule that wants it, and what became of it is recorded in delivery:
// sent, quiet (nothing matched), queued for a digest, skipped (paused and the like) or failed.
function drain_events(): int
{
    $sent = 0;
    foreach (rows('SELECT e.*, m.name AS monitor_name, m.num, m.slug FROM event e JOIN monitor m ON m.id = e.monitor_id WHERE e.sent_at IS NULL ORDER BY e.id LIMIT 200') as $ev) {
        // Only confirmed destinations: an address that hasn't said yes gets nothing.
        $rules = rows("SELECT r.* FROM rule r JOIN target t ON t.id = r.target_id
            WHERE t.confirmed = 1 AND r.monitor_id = ? AND (',' || r.events || ',') LIKE ? AND r.id NOT IN (SELECT rule_id FROM delivery WHERE event_id = ?)",
            [$ev['monitor_id'], '%,' . $ev['kind'] . ',%', $ev['id']]);
        $failed = false;
        $subject = event_subject($ev['monitor_name'], $ev['kind'], $ev['title']);
        foreach ($rules as $r) {
            $t = row('SELECT * FROM target WHERE id = ?', [$r['target_id']]);
            [$state, $note, $n] = ['sent', '', 0];
            // News with no document of its own links to the monitor's page, which only its account can open,
            // so that link is left out of mail to other people.
            $others = $t['kind'] === 'list' || ($t['kind'] === 'email' && !$t['is_default']);
            $link = $ev['url'] ?: ($others ? '' : cfg('base_url') . monitor_url(['num' => $ev['num'], 'name' => $ev['monitor_name']]));
            try {
                if ($why = skip_reason($t)) {
                    [$state, $note] = ['skipped', $why];
                } elseif (($content = shape($r, $ev)) === null || trim($content) === 'NOTHING') {
                    $state = 'quiet';
                } elseif ($t['digest'] !== 'now' && in_array($t['kind'], ['email', 'list'], true)) {
                    q('INSERT INTO digest_item (target_id, rule_id, event_id, subject, body, url) VALUES (?, ?, ?, ?, ?, ?)', [$t['id'], $r['id'], $ev['id'], $subject, $content, $link]);
                    $state = 'queued';
                } else {
                    [$err, $n] = deliver($t, $subject, $content, $link, ['event' => $ev['kind'], 'monitor' => $ev['monitor_name']]);
                    if ($err) [$state, $note] = ['failed', $err];
                }
            } catch (Throwable $e) {
                [$state, $note] = ['failed', $e->getMessage()];
            }
            // A failed send is retried on the next drain, up to a day after the event.
            if ($state === 'failed' && strtotime($ev['created_at'] . ' UTC') > time() - 86400) { $failed = true; continue; }
            q('INSERT OR REPLACE INTO delivery (event_id, rule_id, ok, error, state, recipients) VALUES (?, ?, ?, ?, ?, ?)',
                [$ev['id'], $r['id'], $state === 'failed' ? 0 : 1, mb_substr($note, 0, 300), $state, $n]);
            $sent += $state === 'sent' ? 1 : 0;
        }
        if (!$failed) q("UPDATE event SET sent_at = datetime('now'), text = '' WHERE id = ?", [$ev['id']]);
    }
    return $sent;
}

// Whether a destination's digest goes out now. $oldest is when its longest-waiting item was queued (UTC).
// A daily digest goes out at digest_hour by the site's clock and a weekly one at that hour on its weekday, with
// everything queued before then; if that hour was missed, it goes out as soon as it can.
function digest_due(array $t, DateTimeImmutable $local, string $oldest): bool
{
    if ($t['digest'] === 'now') return true;   // switched back to sending straight away: send what was waiting
    $edge = $local->setTime((int)cfg('digest_hour'), 0);
    if ($edge > $local) $edge = $edge->modify('-1 day');
    if ($t['digest'] === 'weekly') while ((int)$edge->format('N') !== (int)$t['digest_day']) $edge = $edge->modify('-1 day');
    return strtotime($oldest . ' UTC') < $edge->getTimestamp();
}

// Sends each destination's waiting notifications as one message when its digest is due.
function send_digests(?int $now = null): int
{
    $local = (new DateTimeImmutable('@' . ($now ?? time())))->setTimezone(new DateTimeZone((string)cfg('timezone') ?: 'UTC'));
    $sent = 0;
    foreach (rows('SELECT * FROM target t WHERE EXISTS (SELECT 1 FROM digest_item d WHERE d.target_id = t.id)') as $t) {
        // A paused destination keeps what's waiting until it's resumed.
        $items = rows('SELECT d.*, m.name AS monitor FROM digest_item d JOIN event e ON e.id = d.event_id JOIN monitor m ON m.id = e.monitor_id WHERE d.target_id = ? ORDER BY d.id', [$t['id']]);
        if ($t['paused'] || !digest_due($t, $local, min(array_column($items, 'created_at')))) continue;
        $settle = function (string $state, string $note, int $n, array $items) {
            foreach ($items as $i) {
                q("UPDATE delivery SET state = ?, ok = ?, error = ?, recipients = ?, sent_at = datetime('now') WHERE event_id = ? AND rule_id = ?",
                    [$state, $state === 'failed' ? 0 : 1, $note, $n, $i['event_id'], $i['rule_id']]);
                q('DELETE FROM digest_item WHERE id = ?', [$i['id']]);
            }
        };
        if ($why = skip_reason($t)) { $settle('skipped', $why, 0, $items); continue; }
        $monitors = array_values(array_unique(array_column($items, 'monitor')));
        $subject = count($items) === 1 ? $items[0]['subject']
            : count($items) . ' meeting updates from ' . implode(', ', array_slice($monitors, 0, 3)) . (count($monitors) > 3 ? ' and others' : '');
        $body = implode("\n\n- - - - -\n\n", array_map(fn($i) => (count($items) > 1 ? $i['subject'] . "\n\n" : '') . $i['body'] . ($i['url'] ? ($i['body'] === '' ? '' : "\n\n") . $i['url'] : ''), $items));
        [$err, $n] = deliver($t, $subject, $body, '');
        if ($err) {
            // Tried again on the next tick; anything that has waited ten days is given up on.
            $settle('failed', $err, 0, array_filter($items, fn($i) => strtotime($i['created_at'] . ' UTC') < time() - 10 * 86400));
            continue;
        }
        $settle('sent', '', $n, $items);
        $sent++;
    }
    return $sent;
}
