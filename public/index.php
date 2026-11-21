<?php
// Front controller. Every request that isn't a static file lands here.
declare(strict_types=1);
if (PHP_SAPI === 'cli-server' && is_file(__DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH))) return false;
require __DIR__ . '/../src/app.php';
require __DIR__ . '/../src/monitors.php';
require __DIR__ . '/../src/lists.php';
require __DIR__ . '/../src/media.php';
require __DIR__ . '/../src/summary.php';
require __DIR__ . '/../src/join.php';
require __DIR__ . '/../src/report.php';
require __DIR__ . '/../src/whatsapp.php';

$path = rtrim(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/') ?: '/';
$post = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
// A logo: /media/<24 hex>.<png|jpg|webp> and nothing else. Public, since it's shown in mail.
if (preg_match('#^/media/([a-f0-9]{24}\.(?:png|jpg|webp))$#', $path, $mm) && !$post) { serve_media($mm[1]); exit; }
if ($path === '/media' || str_starts_with($path, '/media/')) { http_response_code(404); header('Content-Type: text/plain; charset=utf-8'); exit('Not found'); }

// A form bigger than PHP accepts arrives with nothing in it, its token included. The only forms that can be are
// the ones with a logo, so say what happened instead of "Form expired".
if ($post && !$_POST && !$_FILES && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > LOGO_MAX_BYTES) {
    flash('That file is too big. A logo can be up to 500 KB.', 'danger');
    redirect(preg_match('#^(/notifications/list/\d+)/settings$#', $path, $mm) ? "$mm[1]#l-settings" : '/settings');
}

// Every POST carries the form token, except the one a mail app sends for its own unsubscribe button (RFC 8058),
// where the link itself is the proof.
if ($post && !($path === '/unsubscribe' && ($_POST['List-Unsubscribe'] ?? '') === 'One-Click')) check_csrf();

// ---- public pages ----------------------------------------------------------

if ($path === '/') {
    $me = user();
    if (!$me) render('landing');
    elseif (!member_session($me)) redirect('/join');
    else render('dashboard', ['monitors' => user_monitors((int)$me['id'])]);
    exit;
}

// About is always the front page's panel with its About tab open.
if ($path === '/about') { render('landing', ['tab' => 'about']); exit; }

// The link in a "confirm notifications" email; like sign-in links, opening it shows a button.
if ($path === '/confirm') {
    $t = (string)($_POST['t'] ?? $_GET['t'] ?? '');
    $done = $post && !too_many('confirm:' . client_ip(), 30, 3600) ? (confirm_target($t) ?? confirm_member($t)) : null;
    render('confirm', ['t' => $t, 'post' => $post, 'done' => $done]);
    exit;
}

// The unsubscribe link in every email to an address that isn't the account's own. It works signed out.
// Opening it shows a button, so mail scanners that open links don't unsubscribe anyone.
if ($path === '/unsubscribe') {
    $token = (string)($_GET['u'] ?? $_POST['u'] ?? '');
    $s = too_many('unsub:' . client_ip(), 60, 3600) ? null : unsubscribe_subject($token);
    $did = null;
    if ($post && $s) {
        $did = ($_POST['do'] ?? '') === 'resubscribe' ? 'resubscribed' : 'unsubscribed';
        $did === 'resubscribed' ? resubscribe($s) : unsubscribe($s, !empty($_POST['everything']));
        $s = unsubscribe_subject($token);
    }
    render('unsubscribe', ['s' => $s, 'token' => $token, 'did' => $did]);
    exit;
}

// Anyone can report a problem, signed in or not, including people waiting to join or turned away.
if ($path === '/report') {
    $kind = (string)($_POST['kind'] ?? $_GET['about'] ?? '');
    $error = $post ? submit_report(user(), $_POST) : null;
    render('report', ['sent' => $post && !$error, 'error' => $error, 'kind' => $kind, 'old' => $_POST]);
    exit;
}

if ($path === '/login') {
    if (!$post) { render('login', ['next' => $_GET['next'] ?? '/']); exit; }
    $email = strtolower(trim((string)($_POST['email'] ?? '')));
    $next = safe_next($_POST['next'] ?? '/');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        render('login', ['next' => $next, 'error' => 'That email address does not look right.']);
        exit;
    }
    if (too_many('login:' . client_ip(), 20, 3600)) {
        render('login', ['next' => $next, 'error' => 'Too many sign-ins from here. Wait an hour and try again.']);
        exit;
    }
    // A new address skips the code and goes straight to joining; letting it in sends the link that proves it.
    // Members still prove it every time, or anyone could sign in as them by typing their address.
    $known = row('SELECT * FROM user WHERE email = ?', [$email]);
    if (!($known ? is_member($known) : is_admin(['email' => $email]))) {
        login_as($email, '', null, false);
        redirect('/join');
    }
    // Three codes per ten minutes and ten a day for an address, each with five tries: about 50 guesses a day at a million codes.
    if ((int)val("SELECT count(*) FROM login_code WHERE email = ? AND created_at > datetime('now', '-10 minutes')", [$email]) >= 3
        || too_many("code-sent:$email", 10, 86400)) {
        render('login', ['next' => $next, 'error' => 'Too many codes sent. Wait a while and try again, or ask for help on the Report a problem page.']);
        exit;
    }
    $code = (string)random_int(100000, 999999);
    q("INSERT INTO login_code (email, code_hash, expires_at) VALUES (?, ?, datetime('now', '+15 minutes'))", [$email, hash('sha256', $code)]);
    if (!send_mail($email, "Your agenda.delivery code: $code", "Your sign-in code is $code\n\nIt works for 15 minutes. If you didn't ask for it, ignore this email.")) {
        render('login', ['next' => $next, 'error' => 'We couldn\'t send the email just now. Try again in a few minutes.']);
        exit;
    }
    render('login_code', ['email' => $email, 'next' => $next]);
    exit;
}

if ($path === '/login/code' && $post) {
    $email = strtolower(trim((string)($_POST['email'] ?? '')));
    $next = safe_next($_POST['next'] ?? '/');
    $c = row("SELECT rowid, * FROM login_code WHERE email = ? AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1", [$email]);
    // The try is counted before the code is compared, in one statement, so parallel guesses can't share a try.
    $counted = $c && q('UPDATE login_code SET tries = tries + 1 WHERE rowid = ? AND tries < 5', [$c['rowid']])->rowCount() === 1;
    $ok = $counted && !too_many('code-try:' . client_ip(), 30, 3600)
        && hash_equals($c['code_hash'], hash('sha256', trim((string)($_POST['code'] ?? ''))));
    if (!$ok) {
        render('login_code', ['email' => $email, 'next' => $next, 'error' => 'That code didn\'t match. Check the latest email and try again.']);
        exit;
    }
    q('DELETE FROM login_code WHERE email = ?', [$email]);
    login_as($email);
    redirect($next);
}

// The link in a "you're in" email: opening it shows a button, so mail scanners that open links don't use it up.
if ($path === '/login/link') {
    $t = (string)($_POST['t'] ?? $_GET['t'] ?? '');
    if (!$post) { render('login_link', ['t' => $t]); exit; }
    $email = use_sign_in_link($t);
    if (!$email) { render('login', ['next' => '/', 'error' => 'That link has been used or has expired. Sign in with your email for a code.']); exit; }
    login_as($email);
    redirect('/');
}

if ($path === '/auth/google') {
    if (!cfg('google_id')) redirect('/login');
    start_session();
    $_SESSION['oauth_state'] = bin2hex(random_bytes(16));
    $_SESSION['oauth_next'] = safe_next($_GET['next'] ?? '/');
    redirect('https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
        'client_id' => cfg('google_id'), 'redirect_uri' => cfg('base_url') . '/api/auth/callback/google',
        'response_type' => 'code', 'scope' => 'openid email profile', 'state' => $_SESSION['oauth_state'],
        'prompt' => 'select_account',
    ]));
}

if ($path === '/api/auth/callback/google') {
    start_session();
    if (empty($_GET['code']) || !hash_equals($_SESSION['oauth_state'] ?? '', (string)($_GET['state'] ?? ''))) redirect('/login');
    [, $tok] = http_request('POST', 'https://oauth2.googleapis.com/token', http_build_query([
        'code' => $_GET['code'], 'client_id' => cfg('google_id'), 'client_secret' => cfg('google_secret'),
        'redirect_uri' => cfg('base_url') . '/api/auth/callback/google', 'grant_type' => 'authorization_code',
    ]), ['Content-Type: application/x-www-form-urlencoded']);
    $access = json_decode((string)$tok, true)['access_token'] ?? '';
    [, $info] = http_request('GET', 'https://openidconnect.googleapis.com/v1/userinfo', null, ["Authorization: Bearer $access"]);
    $info = json_decode((string)$info, true) ?: [];
    if (empty($info['email']) || empty($info['email_verified'])) {
        render('login', ['next' => '/', 'error' => 'Google sign-in didn\'t return a verified email.']);
        exit;
    }
    login_as(strtolower($info['email']), $info['name'] ?? '', $info['sub'] ?? null);
    redirect($_SESSION['oauth_next'] ?? '/');
}

if ($path === '/logout' && $post) {
    start_session();
    session_destroy();
    redirect('/');
}

// ---- everything below needs an account -------------------------------------

$me = require_user();
$uid = (int)$me['id'];

// A new account joins with a sign-up code or a registration an admin approves, after signing in.
if ($path === '/join') {
    if (member_session($me)) redirect('/');
    $error = null;
    $via = (string)($_POST['via'] ?? '');
    // A request can only be sent once, so someone typing another person's address can't rewrite theirs.
    if ($post && ($via === 'code' ? !is_member($me) && $me['status'] !== 'declined' : $me['status'] === 'new')) {
        $error = $via === 'code' ? join_with_code($me, (string)($_POST['code'] ?? '')) : submit_join_request($me, $_POST);
        if (!$error && $via === 'code') {
            if (!empty($_SESSION['verified'])) redirect('/');
            send_sign_in_link($me['email'], 'Finish joining agenda.delivery',
                'Your sign-up code worked. Use the link below to confirm this is your email and sign in.');
        }
        if (!$error) redirect('/join');
    }
    render('join', ['error' => $error, 'via' => $_POST['via'] ?? '', 'old' => $_POST,
        'request' => row('SELECT * FROM join_request WHERE user_id = ?', [$uid])]);
    exit;
}
if (!member_session($me)) redirect('/join');

// "Fill from the organization's website": streams what the scan is doing, then the fields, as server-sent events.
if ($path === '/monitors/scan' && $post) {
    require __DIR__ . '/../src/scan.php';
    $limited = too_many("scan:$uid", 20, 3600);
    session_write_close();  // the rest of the site stays usable while a scan runs
    set_time_limit(300);
    header('Content-Type: text/event-stream');
    header('Cache-Control: no-cache');
    header('X-Accel-Buffering: no');
    while (ob_get_level()) ob_end_flush();
    $send = function (string $type, $data) { echo "data: " . json_encode([$type => $data]) . "\n\n"; flush(); };
    if ($limited) { $send('error', "That's a lot of scans in an hour. Wait a little, or fill in the form yourself."); exit; }
    try {
        $send('done', scan_organization((string)($_POST['url'] ?? ''), fn($msg) => $send('say', $msg)));
    } catch (Throwable $e) {
        $send('error', $e instanceof RuntimeException ? $e->getMessage() : "The scan didn't finish. Try again, or fill in the form yourself.");
    }
    exit;
}

if ($path === '/monitors/new') {
    if (!$post) redirect('/#add');
    [$m, $error] = create_monitor($uid, $_POST);
    if ($error) {
        render('dashboard', ['monitors' => user_monitors($uid), 'error' => $error, 'old' => $_POST]);
        exit;
    }
    redirect(monitor_url($m));
}

// An address from before monitors were numbered, /m/<name>, goes to the account's monitor of that name.
if (!$post && preg_match('#^/m/([a-z][a-z0-9-]*)$#', $path, $mm)) {
    foreach (user_monitors($uid) as $old) if (slugify($old['name']) === $mm[1]) redirect(monitor_url($old));
    http_response_code(404); render('not_found'); exit;
}

// A monitor: /m/<num>/<name>, then an action. Only the account's number for it and the account find it; the name
// is for reading, and a missing or outdated one sends a page view to the current address.
if (preg_match('#^/m/(\d+)(?:/([a-z0-9-]*))?(?:/(\w+))?(?:/(\d+))?(?:/(\w+))?$#', $path, $found)) {
    require_once __DIR__ . '/../src/summary.php';
    require_once __DIR__ . '/../src/notify.php';   // text_to_html(), which shows summaries formatted
    // A monitor is private to the account that added it.
    $m = own_monitor($uid, (int)$found[1]);
    if (!$m) { http_response_code(404); render('not_found'); exit; }
    $back = monitor_url($m);
    if (!$post && ($found[2] ?? '') !== slugify($m['name'])) redirect($back . (($found[3] ?? '') !== '' ? '/' . $found[3] : ''));
    // The action and its parts, numbered as before: [2] action, [3] an id, [4] what to do with it.
    $mm = [$found[0], $found[1], $found[3] ?? '', $found[4] ?? '', $found[5] ?? ''];
    $mid = (int)$m['id'];
    $action = $mm[2];
    $view = function (array $extra = []) use ($m, $mid, $uid) {
        render('monitor', $extra + [
            'm' => $m,
            'agent' => row('SELECT * FROM agent WHERE monitor_id = ?', [$mid]),
            'run' => row('SELECT * FROM agent_run WHERE monitor_id = ? ORDER BY id DESC LIMIT 1', [$mid]),
            'types' => site_meeting_types($m['site_types']),
            'tracked' => json_decode($m['meeting_types'], true) ?: [],
            'peers' => (int)val('SELECT count(*) FROM monitor WHERE site_id = ? AND id != ?', [$m['site_id'], $mid]),
            'agendas' => rows('SELECT * FROM agenda WHERE monitor_id = ? ORDER BY coalesce(meeting_date, found_at) DESC LIMIT 30', [$mid]),
            'videos' => rows('SELECT id, url, title, meeting_date, meeting_type, summary, length(transcript) AS tlen FROM video WHERE monitor_id = ? ORDER BY coalesce(meeting_date, found_at) DESC LIMIT 20', [$mid]),
            'pending' => rows('SELECT * FROM pending_item WHERE monitor_id = ? AND open = 1 ORDER BY updated_at DESC', [$mid]),
            'history' => summary_history($mid),
            'voices' => user_voices($uid),
            'rules' => rows('SELECT r.*, t.name AS target_name, t.kind AS target_kind, t.paused, t.confirmed FROM rule r JOIN target t ON t.id = r.target_id WHERE r.user_id = ? AND r.monitor_id = ? ORDER BY r.id', [$uid, $mid]),
            'targets' => user_targets($uid),
        ]);
        exit;
    };

    // A video's transcript as a text file.
    if (!$post && $action === 'transcript') {
        $v = row('SELECT title, meeting_date, transcript FROM video WHERE id = ? AND monitor_id = ?', [(int)$mm[3], $mid]);
        if (!$v || $v['transcript'] === '') { http_response_code(404); render('not_found'); exit; }
        $name = trim(($v['meeting_date'] ?? '') . ' ' . slugify($v['title'])) ?: 'transcript';
        header('Content-Type: text/plain; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . str_replace(' ', '-', $name) . '.txt"');
        echo $v['transcript'];
        exit;
    }
    if (!$post) $view();

    switch ($action) {
        case 'remove':
            remove_monitor($uid, $mid);
            flash($m['name'] . ' is removed, along with its agent.');
            redirect('/');
        case 'run':
            q('UPDATE agent SET run_requested = 1 WHERE monitor_id = ?', [$mid]);
            nudge_service($m['slug']);
            flash('The agent will start within a minute.');
            break;
        case 'retry':
            // Setup didn't finish last time; the next agent waiting on the site tries again.
            q("UPDATE site SET setup_state = 'pending', setup_monitor = NULL WHERE id = ? AND setup_state = 'failed'", [$m['site_id']]);
            nudge_service($m['slug']);
            flash('Setting up again. This takes a few minutes.');
            break;
        case 'start':
            $err = save_choices($m, $_POST);
            // A refused prompt stays in the box, so it can be fixed rather than written again.
            if ($err) $view(['draft' => (string)($_POST['summary_prompt'] ?? ''), 'preview' => ['title' => '', 'text' => '', 'error' => $err, 'refused' => true]]);
            flash('Monitoring has started. The agent runs its first check within a minute.');
            break;
        case 'rebuild':
            // A new summary of one agenda or video from the current instructions; the earlier ones stay in its history.
            $kind = $mm[4] === 'video' ? 'video' : 'agenda';
            $tab = $kind === 'video' ? 't-videos' : 't-agendas';
            if (too_many("preview:$uid", 30, 3600)) { flash("That's a lot of summaries in an hour. Wait a little and try again.", 'danger'); redirect("$back#$tab"); }
            try {
                $ok = rebuild_summary($m, $kind, (int)$mm[3]) !== null;
                flash($ok ? 'Rebuilt in the current voice. The earlier revisions are a click away under it.' : 'There is no text on file to summarize for that one.', $ok ? 'success' : 'danger');
            } catch (Throwable $e) {
                flash("The summary couldn't be written just now. Try again in a minute.", 'danger');
            }
            redirect("$back?open=$kind-" . (int)$mm[3] . "#$tab");
        case 'types':
            $picked = array_values(array_intersect(array_keys(site_meeting_types($m['site_types'])), (array)($_POST['types'] ?? [])));
            if (!$picked) { flash('Pick at least one kind of meeting to follow.', 'danger'); redirect("$back#t-types"); }
            q('UPDATE monitor SET meeting_types = ? WHERE id = ?', [json_encode($picked), $mid]);
            flash('Saved. The agent follows these meetings from its next run.');
            redirect("$back#t-types");
        case 'summary':
        case 'preview':
            if (too_many("preview:$uid", 30, 3600)) {
                $view(['preview' => ['title' => '', 'text' => '', 'refused' => true, 'error' => "That's a lot of tries in an hour. Wait a little and try again."]]);
            }
            [$refused, $cols, $prompt, $markdown] = voice_choice($m, $_POST);
            if ($refused) $view(['preview' => ['title' => '', 'text' => '', 'error' => $refused, 'refused' => true]]);
            if ($action === 'summary') {
                save_monitor_voice($m, $cols);
                flash('Saved. New agendas and videos are summarized in this voice.');
                redirect("$back#t-summary");
            }
            $view(['preview' => preview_summary($m, $prompt, $markdown)]);
            // The preview uses the newest agenda any agent on this site has read; it's the same public document.
            $latest = row('SELECT g.title, g.text, g.found_at FROM agenda g JOIN monitor mo ON mo.id = g.monitor_id
                WHERE mo.site_id = ? AND length(g.text) > 100 ORDER BY coalesce(g.meeting_date, g.found_at) DESC LIMIT 1', [$m['site_id']]);
            $preview = null;
            if ($latest) {
                try {
                    $preview = ['title' => $latest['title'], 'text' => summarize($prompt, $latest['title'], $latest['text'], $mid, $latest['found_at'], !empty($_POST['summary_markdown']))];
                } catch (Throwable $e) {
                    $preview = ['title' => $latest['title'], 'text' => '', 'error' => "The preview couldn't be written just now. Try again in a minute."];
                }
            }
            $view(['draft' => $prompt, 'preview' => $preview ?? ['title' => '', 'text' => '', 'error' => 'There is no agenda to preview on yet. Once the first one is in, the preview shows how it would be summarized.']]);
            // no break: $view() exits
        case 'edit':
            $v = normalize_url((string)($_POST['video_url'] ?? ''));
            if ($v !== '' && (!filter_var($v, FILTER_VALIDATE_URL) || !safe_url($v))) {
                flash('The video page address needs to be a public web address.', 'danger');
                break;
            }
            // Another video page is another site, since a site's agents only read pages all of its accounts chose.
            $site = $v === $m['video_url'] ? ['id' => $m['site_id']]
                : find_site($m['agenda_url'], $v, $m['site_name'], row('SELECT * FROM site WHERE id = ?', [$m['site_id']]));
            if ((int)$site['id'] !== (int)$m['site_id'] && val('SELECT 1 FROM monitor WHERE user_id = ? AND site_id = ?', [$uid, $site['id']])) {
                flash('You already monitor that agenda page with that video page.', 'danger');
                break;
            }
            q('UPDATE monitor SET video_url = ?, video_source = ?, site_id = ? WHERE id = ?', [$v, ($_POST['video_source'] ?? '') === 'youtube' ? 'youtube' : 'page', $site['id'], $mid]);
            flash('Saved. The agent picks this up on its next run.');
            redirect("$back#t-settings");
        case 'rule':
            if (($mm[4] ?? '') === 'delete') {
                q('DELETE FROM rule WHERE id = ? AND user_id = ?', [(int)$mm[3], $uid]);
                flash('Notification removed.');
            } else {
                $err = add_rule($uid, $mid, $_POST);
                flash($err ?: 'Notification added.', $err ? 'danger' : 'success');
            }
            redirect("$back#t-notify");
    }
    redirect($back);
}

// ---- notifications: destinations, mailing lists, what's sent and the history -------------------------------

if ($path === '/notifications/lists' && $post) {
    [$id, $err] = create_list($uid, $_POST);
    if ($err) { flash($err, 'danger'); redirect('/notifications/lists'); }
    flash('List created. Add its addresses below.');
    redirect("/notifications/list/$id");
}

// The page's four tabs each have an address of their own, and all of them show the same page with that tab open.
$notifyTabs = ['/notifications' => 'destinations', '/notifications/lists' => 'lists', '/notifications/sent' => 'rules', '/notifications/history' => 'history'];
if (isset($notifyTabs[$path])) {
    if ($post && $path === '/notifications') {
        $err = add_target($uid, $_POST);
        flash($err ?: (($_POST['kind'] ?? '') === 'email' ? 'Destination added. It gets its first notification once its owner confirms from the email we sent.' : 'Destination added.'), $err ? 'danger' : 'success');
    }
    if ($post) redirect($path);
    render('notifications', [
        'tab' => $notifyTabs[$path],
        'targets' => user_targets($uid),
        'monitors' => user_monitors($uid),
        'rules' => rows('SELECT r.*, m.name AS monitor, m.num, t.name AS target_name, t.kind AS target_kind, t.paused, t.confirmed
            FROM rule r JOIN monitor m ON m.id = r.monitor_id JOIN target t ON t.id = r.target_id WHERE r.user_id = ? ORDER BY m.name, r.id', [$uid]),
        'history' => rows('SELECT d.state, d.error, d.recipients, d.sent_at, e.title, e.kind AS event_kind, m.name AS monitor, t.name AS target_name, t.kind AS target_kind
            FROM delivery d JOIN rule r ON r.id = d.rule_id JOIN event e ON e.id = d.event_id JOIN monitor m ON m.id = e.monitor_id JOIN target t ON t.id = r.target_id
            WHERE r.user_id = ? ORDER BY d.sent_at DESC, d.event_id DESC LIMIT 60', [$uid]),
    ]);
    exit;
}

// A WhatsApp destination's linking panel, which the page polls while it waits for the code to be scanned.
if (preg_match('#^/notifications/(\d+)/whatsapp$#', $path, $mm) && !$post) {
    $t = row("SELECT * FROM target WHERE id = ? AND user_id = ? AND kind = 'whatsapp'", [(int)$mm[1], $uid]);
    if (!$t) { http_response_code(404); exit; }
    header('Cache-Control: no-store');
    echo wa_panel($t);
    exit;
}

if (preg_match('#^/notifications/(\d+)/(delete|test|pause|resume|edit)$#', $path, $mm) && $post) {
    $t = row('SELECT * FROM target WHERE id = ? AND user_id = ?', [(int)$mm[1], $uid]);
    $back = $t && $t['kind'] === 'list' ? (($_POST['from'] ?? '') === 'list' ? "/notifications/list/{$t['id']}" : '/notifications/lists') : '/notifications';
    if (!$t) redirect('/notifications');
    if ($mm[2] === 'delete') {
        if ($t['is_default']) {
            flash('Your own address stays as your default destination. Pause it if you want it quiet.', 'danger');
        } else {
            q('DELETE FROM target WHERE id = ?', [$t['id']]);
            delete_logo((string)$t['logo']);
            flash($t['kind'] === 'list' ? 'Mailing list removed, along with its addresses and the notifications that used it.' : 'Destination removed, along with the notifications that used it.');
            if ($t['kind'] === 'list') $back = '/notifications/lists';
        }
    } elseif ($mm[2] === 'pause' || $mm[2] === 'resume') {
        q('UPDATE target SET paused = ? WHERE id = ?', [$mm[2] === 'pause' ? 1 : 0, $t['id']]);
        flash($mm[2] === 'pause' ? "{$t['name']} is paused. Nothing is sent to it until you resume it." : "{$t['name']} is sending again.");
    } elseif ($mm[2] === 'edit') {
        $err = $t['kind'] === 'list' ? 'Change a mailing list from its own page.' : update_target($t, $_POST);
        flash($err ?: 'Saved.', $err ? 'danger' : 'success');
    } elseif (too_many("test:$uid", 10, 3600)) {
        flash("That's a lot of tests in an hour. Wait a little and try again.", 'danger');
    } elseif ($t['kind'] === 'email' && !$t['is_default'] && !$t['confirmed']) {
        // Nothing but a confirmation request reaches an address that hasn't said yes.
        if (is_blocked($t['address'], $uid)) {
            flash("{$t['address']} has unsubscribed. Its owner can subscribe again from the link in any email it was sent.", 'danger');
        } elseif (too_many('invite:' . strtolower($t['address']), 3, 604800)) {
            flash("{$t['address']} has been asked to confirm a few times this week. Try again in a few days.", 'danger');
        } else {
            send_target_confirmation((int)$t['id']);
            flash("{$t['address']} hasn't confirmed yet, so we sent the confirmation email again.");
        }
    } else {
        require_once __DIR__ . '/../src/notify.php';
        if ($t['kind'] === 'list') {
            // A list's test is a sample notification, built the way a real one is, and goes to the account only.
            $mail = sample_list_mail($t, $me);
            $ok = send_mail($me['email'], $mail['subject'], $mail['text'], $mail['opt']);
            flash($ok ? "A sample notification is on its way to {$me['email']} only, the way the list will see it." : 'Test failed: mail not accepted', $ok ? 'success' : 'danger');
        } else {
            [$err] = deliver($t, 'Test from agenda.delivery', 'If you can read this, agenda.delivery can reach this destination.', cfg('base_url'));
            flash($err ? "Test failed: $err" : 'Test sent.', $err ? 'danger' : 'success');
        }
    }
    redirect($back);
}

if (preg_match('#^/notifications/list/(\d+)(?:/(settings|members)|/member/(\d+)/(remove|resend))?$#', $path, $mm)) {
    $list = own_list($uid, (int)$mm[1]);
    if (!$list) { http_response_code(404); render('not_found'); exit; }
    $back = "/notifications/list/{$list['id']}";
    if (!$post) {
        require_once __DIR__ . '/../src/notify.php';
        render('mailing_list', [
            'list' => $list,
            'lists' => array_values(array_filter(user_targets($uid), fn($t) => $t['kind'] === 'list')),
            'preview' => sample_list_mail($list, $me),
            'members' => rows("SELECT * FROM list_member WHERE target_id = ? ORDER BY status = 'active' DESC, status = 'pending' DESC, email", [$list['id']]),
            'waiting' => (int)val('SELECT count(*) FROM digest_item WHERE target_id = ?', [$list['id']]),
        ]);
        exit;
    }
    if (($mm[2] ?? '') === 'settings') {
        $err = save_list($list, $_POST)
            // The list's own logo only matters, and only changes, while it's set to send under its own name.
            ?? (own_list($uid, (int)$list['id'])['brand'] === 'list' ? update_logo('target', (int)$list['id'], $uid, $_FILES['logo'] ?? null, !empty($_POST['remove_logo'])) : null);
        flash($err ?: 'Saved.', $err ? 'danger' : 'success');
        redirect("$back#l-settings");
    }
    if (($mm[2] ?? '') === 'members') {
        $raw = (string)($_POST['addresses'] ?? '');
        $file = $_FILES['file'] ?? null;
        if ($file && ($file['error'] ?? 1) === UPLOAD_ERR_OK && is_uploaded_file($file['tmp_name']) && $file['size'] <= 200000) {
            $raw .= "\n" . file_get_contents($file['tmp_name']);
        }
        if (too_many("list-add:$uid", 30, 3600)) { flash("That's a lot of additions in an hour. Wait a little and try again.", 'danger'); redirect($back); }
        $r = add_members($list, $raw);
        flash(describe_added($r), $r['added'] ? 'success' : 'danger');
        redirect($back);
    }
    $member = row('SELECT * FROM list_member WHERE id = ? AND target_id = ? AND user_id = ?', [(int)$mm[3], $list['id'], $uid]);
    if ($member && $mm[4] === 'remove') {
        q('DELETE FROM list_member WHERE id = ?', [$member['id']]);
        flash("{$member['email']} is off the list.");
    } elseif ($member && $member['status'] === 'pending') {
        if (too_many("invite-day:$uid", INVITES_PER_DAY, 86400) || too_many('invite:' . $member['email'], 3, 604800)) {
            flash("{$member['email']} has been asked to confirm a few times this week. Try again in a few days.", 'danger');
        } else {
            flash(invite_member((int)$member['id']) ? "Sent {$member['email']} the confirmation link again." : "The email couldn't be sent just now.");
        }
    }
    redirect($back);
}

if ($path === '/notifications/rule' && $post) {
    // "All my monitors" adds the same notification to each monitor the account has now.
    $mons = ($_POST['monitor'] ?? '') === 'all' ? user_monitors($uid) : array_filter([own_monitor($uid, (int)($_POST['monitor'] ?? 0))]);
    $err = $mons ? null : 'Pick a monitor.';
    $added = 0;
    foreach ($mons as $mon) {
        if ($err = add_rule($uid, (int)$mon['id'], $_POST)) break;
        $added++;
    }
    flash($err ?: ($added === 1 ? 'Notification added.' : "$added notifications added, one for each monitor."), $err ? 'danger' : 'success');
    redirect('/notifications/sent');
}

if (preg_match('#^/notifications/rule/(\d+)/delete$#', $path, $mm) && $post) {
    q('DELETE FROM rule WHERE id = ? AND user_id = ?', [(int)$mm[1], $uid]);
    flash('Notification removed.');
    redirect('/notifications/sent');
}

// ---- voices: how summaries are written, shared across an account's monitors -------------------------------
// /voices lists them, /voices/new and /voices/<id> show the editor, and its buttons post to .../save, .../rebuild
// (save, then rewrite the newest agenda of each monitor using it), .../preview, .../default and .../delete.
if (preg_match('#^/voices(?:/(new|\d+))?(?:/(\w+))?$#', $path, $mm)) {
    require_once __DIR__ . '/../src/notify.php';   // text_to_html(), for the preview
    $which = $mm[1] ?? '';
    $voice = ctype_digit($which) ? own_voice($uid, (int)$which) : null;
    if (ctype_digit($which) && !$voice) { http_response_code(404); render('not_found'); exit; }
    $show = function (array $extra = []) use ($uid, $voice, $which) {
        render('voices', $extra + ['voices' => user_voices($uid), 'voice' => $voice, 'editing' => $which !== '', 'monitors' => user_monitors($uid),
            'users' => $voice ? rows('SELECT num, name FROM monitor WHERE voice_id = ? ORDER BY name COLLATE NOCASE', [$voice['id']]) : []]);
        exit;
    };
    if (!$post) $show();
    $action = $mm[2] ?? '';
    $back = $voice ? "/voices/{$voice['id']}" : '/voices/new';
    if ($voice && $action === 'default') {
        make_default_voice($uid, $voice);
        flash("{$voice['name']} is now the default voice, so new monitors will use it.");
        redirect('/voices');
    }
    if ($voice && $action === 'delete') {
        if ($err = delete_voice($uid, $voice)) { flash($err, 'danger'); redirect('/voices'); }
        flash("{$voice['name']} has been removed, and its monitors now use the default voice.");
        redirect('/voices');
    }
    if ($action === 'preview') {
        $pm = row('SELECT * FROM monitor WHERE id = ? AND user_id = ?', [(int)($_POST['preview_on'] ?? 0), $uid]);
        $prompt = trim((string)($_POST['prompt'] ?? ''));
        $preview = match (true) {
            !$pm => ['title' => '', 'text' => '', 'error' => 'Add a monitor first. The preview uses its newest agenda.'],
            $prompt === '' => ['title' => '', 'text' => '', 'error' => 'Write how this voice writes first.'],
            too_many("preview:$uid", 30, 3600) => ['title' => '', 'text' => '', 'refused' => true, 'error' => "That's a lot of tries in an hour. Wait a little and try again."],
            default => null,
        };
        if (!$preview && ($why = screen_summary_prompt($prompt, null))) $preview = ['title' => '', 'text' => '', 'error' => $why, 'refused' => true];
        $show(['preview' => $preview ?? preview_summary($pm, $prompt, !empty($_POST['markdown']))]);
    }
    if ($action === 'save' || $action === 'rebuild') {
        [$err, $id] = save_voice($uid, $voice, $_POST);
        if ($err) $show(['preview' => ['title' => '', 'text' => '', 'error' => $err, 'refused' => true]]);
        $n = $action === 'rebuild' ? queue_voice_rebuilds(own_voice($uid, $id)) : 0;
        flash(match (true) { $n === 0 => 'Saved.', $n === 1 => "Saved. Its monitor's newest summary is being rewritten and shows up within a few minutes.",
            default => "Saved. The newest summary for each of its $n monitors is being rewritten, a few each minute." });
        redirect("/voices/$id");
    }
    redirect($back);
}

if ($path === '/settings') {
    if ($post) {
        q('UPDATE user SET name = ?, theme = ? WHERE id = ?', [
            mb_substr(trim((string)($_POST['name'] ?? '')), 0, 80), ($_POST['theme'] ?? '') === 'dark' ? 'dark' : 'light', $uid,
        ]);
        flash('Settings saved.');
        redirect('/settings');
    }
    require_once __DIR__ . '/../src/notify.php';
    render('settings');
    exit;
}

// The organization name and logo that mailing lists set to "my organization settings" send under.
// The colour picker's preview: a small email in the colours being tried, with the name and logo it would carry.
if ($path === '/settings/colour-preview' && !$post) {
    require_once __DIR__ . '/../src/notify.php';
    [$stored, $err] = check_colours(['colour_fg' => $_GET['fg'] ?? '', 'colour_bg1' => $_GET['bg1'] ?? '', 'colour_bg2' => $_GET['bg2'] ?? '']);
    if ($err) { echo '<p class="small text-danger mb-0">' . h($err) . '</p>'; exit; }
    $list = (int)($_GET['list'] ?? 0) ? own_list($uid, (int)$_GET['list']) : null;
    $name = $list && $list['sender_name'] !== '' ? $list['sender_name'] : $me['org_name'];
    $logo = $list && $list['logo'] !== '' ? $list['logo'] : $me['logo'];
    echo colour_preview(mail_colours($stored), $name, $logo);
    exit;
}

if ($path === '/settings/branding' && $post) {
    $org = trim((string)($_POST['org_name'] ?? ''));
    $err = $org !== '' && ($org = plain_label($org, 40)) === null ? 'The organization name takes letters, numbers and spaces, up to 40 characters.' : null;
    require_once __DIR__ . '/../src/colours.php';
    [$colours, $cerr] = check_colours($_POST);
    $err = $err ?? $cerr;
    if (!$err) {
        q('UPDATE user SET org_name = ?, mail_colours = ? WHERE id = ?', [$org, $colours, $uid]);
        $err = update_logo('user', $uid, $uid, $_FILES['logo'] ?? null, !empty($_POST['remove_logo']));
    }
    flash($err ?: 'Saved.', $err ? 'danger' : 'success');
    redirect('/settings');
}

if ($path === '/admin') {
    if (!is_admin($me)) { http_response_code(404); render('not_found'); exit; }
    require __DIR__ . '/../src/admin.php';
    render('admin', admin_data());
    exit;
}

if ($path === '/admin/signups' && $post) {
    if (!is_admin($me)) { http_response_code(404); render('not_found'); exit; }
    $do = (string)($_POST['do'] ?? '');
    if ($do === 'approve' || $do === 'decline') {
        decide_join((int)($_POST['user_id'] ?? 0), $do === 'approve');
        flash($do === 'approve' ? 'Approved, and they have an email saying so.' : 'Declined.');
    } elseif ($do === 'add-code') {
        $code = create_signup_code($_POST);
        flash($code ? "Sign-up code $code is ready." : 'That code is already taken.', $code ? 'success' : 'danger');
    } elseif ($do === 'remove-code') {
        q('DELETE FROM signup_code WHERE code = ?', [(string)($_POST['code'] ?? '')]);
        flash('Code removed. Accounts that joined with it stay.');
    }
    redirect('/admin#a-signups');
}

if ($path === '/admin/reports' && $post) {
    if (!is_admin($me)) { http_response_code(404); render('not_found'); exit; }
    q("UPDATE problem_report SET resolved_at = CASE WHEN resolved_at IS NULL THEN datetime('now') END WHERE id = ?", [(int)($_POST['id'] ?? 0)]);
    redirect('/admin#a-reports');
}

if (preg_match('#^/admin/log/([a-z0-9-]+)$#', $path, $mm)) {
    if (!is_admin($me)) { http_response_code(404); render('not_found'); exit; }
    $log = service('GET', "/agents/{$mm[1]}/log?lines=400", null, 5);
    render('admin_log', ['slug' => $mm[1], 'log' => $log]);
    exit;
}

http_response_code(404);
render('not_found');
