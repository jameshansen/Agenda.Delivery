<?php
// WhatsApp destinations. Each one has a Baileys bridge (whatsapp/bridge.mjs) that agenda-delivery.service starts,
// keeps running and removes with the destination. The site talks to a bridge over its Unix socket for the linking
// code and to send; the service records each bridge's state, which the tick uses to tell the owner when a link drops.
declare(strict_types=1);

// Whether WhatsApp destinations can be added: switched on in config, and the bridge's packages installed.
function whatsapp_available(): bool
{
    return cfg('whatsapp') !== false && is_dir(ROOT . '/whatsapp/node_modules');
}

function wa_socket(int $tid): string
{
    return dirname((string)(cfg('service_socket') ?: '/run/agenda-delivery/service.sock')) . "/wa-$tid.sock";
}

// One request to a destination's bridge. Returns [HTTP status, the JSON reply], or [0, null] when it doesn't answer.
function wa_call(int $tid, string $method, string $path, ?array $body = null, int $timeout = 8): array
{
    if (!file_exists(wa_socket($tid))) return [0, null];
    $ch = curl_init('http://bridge' . $path);
    curl_setopt_array($ch, [
        CURLOPT_UNIX_SOCKET_PATH => wa_socket($tid), CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout, CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $out = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return [$code, is_string($out) ? json_decode($out, true) : null];
}

// The destination's state in a few words.
function wa_label(string $state, string $me): string
{
    return [
        'open' => 'Linked' . ($me !== '' ? ' to +' . $me : ''), 'qr' => 'Waiting to be linked', 'connecting' => 'Connecting',
        'closed' => 'Disconnected, reconnecting', 'logged_out' => 'Unlinked from the phone', 'starting' => 'Starting',
    ][$state] ?? 'Starting';
}

// The linking panel under a WhatsApp destination: its state, and while it isn't linked, the code to scan. It asks
// the bridge directly so the code is current; the page polls it (data-wa) until the link is made.
function wa_panel(array $t): string
{
    [, $st] = wa_call((int)$t['id'], 'GET', '/status', null, 3);
    $state = (string)($st['state'] ?? ($t['wa_state'] ?: 'starting'));
    $me = (string)($st['me'] ?? $t['wa_me']);
    $out = '<div class="wa-panel" data-wa="/notifications/' . (int)$t['id'] . '/whatsapp" data-wa-state="' . h($state) . '">';
    $out .= '<p class="wa-state wa-is-' . h($state) . '">' . icon($state === 'open' ? 'circle-check' : ($state === 'qr' ? 'qrcode' : 'spinner')) . ' ' . h(wa_label($state, $me)) . '</p>';
    if ($state === 'qr' && !empty($st['qr']) && str_starts_with(ltrim($st['qr']), '<svg')) {
        // Shown as an image, so nothing in it can run on the page.
        $out .= '<div class="wa-link"><img class="wa-qr" alt="WhatsApp linking code" src="data:image/svg+xml;base64,' . base64_encode($st['qr']) . '">'
            . '<ol class="small mb-0"><li>Open WhatsApp on the phone with the number to send from.</li>'
            . '<li>Go to Settings, then Linked devices, then Link a device.</li>'
            . '<li>Scan this code. It changes every so often, and this panel keeps up.</li></ol></div>';
    } elseif ($state === 'logged_out') {
        $out .= '<p class="small mb-0">It was unlinked from the phone. A new code to scan appears here in a moment.</p>';
    }
    return $out . '</div>';
}

// Sends one update through a destination's bridge. Returns [null or a short error, how many it reached].
function wa_send(array $t, string $subject, string $text, string $url): array
{
    if (!preg_match('/^[0-9]+(-[0-9]+)?@g\.us$/', $t['address'])) return ['Choose a group for it to send to first.', 0];
    $msg = "*$subject*" . ($text !== '' ? "\n\n$text" : '') . ($url !== '' ? "\n\n$url" : '');
    if (mb_strlen($msg) > 4000) $msg = mb_substr($msg, 0, 3990 - mb_strlen($url)) . "…\n\n$url";
    [$code, $r] = wa_call((int)$t['id'], 'POST', '/send', ['to' => $t['address'], 'text' => $msg], 30);
    if ($code === 200) return [null, 1];
    if ($code === 409) return ["WhatsApp isn't linked yet. Scan the code under it first.", 0];
    return [$code === 0 ? "WhatsApp's link isn't running. It restarts by itself; try again in a minute." : 'WhatsApp: ' . mb_substr((string)($r['error'] ?? "HTTP $code"), 0, 150), 0];
}

// Emails the owner of each WhatsApp destination that was linked and has now been off for ten minutes, once per drop.
// Runs from bin/tick.php. Returns how many were told.
function whatsapp_alerts(): int
{
    q("UPDATE target SET wa_alerted = 0 WHERE kind = 'whatsapp' AND wa_state = 'open' AND wa_alerted = 1");
    $n = 0;
    foreach (rows("SELECT t.*, u.email AS owner FROM target t JOIN user u ON u.id = t.user_id
        WHERE t.kind = 'whatsapp' AND t.wa_linked = 1 AND t.wa_alerted = 0 AND t.wa_state NOT IN ('open', '')
          AND t.wa_since < datetime('now', '-10 minutes')") as $t) {
        $why = $t['wa_state'] === 'logged_out' ? 'It was unlinked from the phone.' : "Its connection to WhatsApp dropped and hasn't come back.";
        send_mail($t['owner'], "WhatsApp is disconnected: {$t['name']}",
            "Your WhatsApp destination \"{$t['name']}\" on agenda.delivery isn't linked any more. $why\n\n"
            . "Until it's linked again, its updates can't be sent. To link it, open " . cfg('base_url') . "/notifications and scan the code shown under it.");
        q('UPDATE target SET wa_alerted = 1 WHERE id = ?', [$t['id']]);
        $n++;
    }
    return $n;
}
