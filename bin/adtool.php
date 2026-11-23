<?php
// adtool: the only shell command an agent may run. It reads the web for the agent and writes what the
// agent finds into the database, scoped to the agent's own monitor (taken from its HOME folder) and the
// site that monitor watches, which every agent watching the same agenda page shares.
declare(strict_types=1);
require __DIR__ . '/../src/app.php';
require __DIR__ . '/../src/tools.php';
require __DIR__ . '/../src/summary.php';

const HELP = <<<TXT
Anywhere a URL goes you can give a link's handle instead, such as L12, from the LINKS adtool lists.
Values can be several words: --title Regular Council Meeting --status third reading Dec 1
Text with punctuation such as ; ( ) ' or $ breaks the shell, so write it to a file in your workspace and pass
--title-file, --status-file or --detail-file instead.

Reading
adtool context                         what you're monitoring, the site's notes and state, what's already saved
adtool fetch URL [--page N]            a page's text and links (plain HTTP, fast)
adtool render URL [--page N]           the same through a real Chrome, for pages that need scripts or block plain HTTP
adtool pdf URL [--page N]              a PDF's text
adtool videos URL                      recent videos on a YouTube channel or playlist (url, title, date)
adtool transcript URL [--page N]       a video's captions as text, members' names corrected

Saving (read the agenda or transcript first; its summary is written for you)
adtool save-agenda URL --type KEY --title T --date YYYY-MM-DD    record an agenda of a meeting type this monitor tracks
adtool save-video URL --type KEY --title T --date YYYY-MM-DD     record a meeting video the same way
adtool pending KEY --title T --status S [--detail D] [--url U] [--closed]  add or update a pending item

The site, shared with every agent watching it
adtool notes --file F                  replace the site's notes on how it's laid out
adtool members --file F                replace the member names, one full name per line
adtool types --file F                  set the site's meeting types, one per line: Name | yes   (yes = followed by default)
adtool setup-done                      finish setting up the site
adtool site broken --detail-file F     say the site has changed, which makes you its repairer if no one else is
adtool site fixed [--url NEW]          say the notes match the site again (and where the agenda page is now, if it moved), which wakes the other agents
TXT;

$monitor = current_monitor();
$args = parse_args(array_slice($argv, 1));
$cmd = array_shift($args['_']) ?? 'help';
// The URL comes first, or as --url (except for pending, whose first argument is its key and --url its source).
$url = $args['_'][0] ?? ($cmd !== 'pending' && $cmd !== 'site' && is_string($args['url'] ?? null) ? $args['url'] : '');
$page = (int)($args['page'] ?? 1);

ob_start();
try {
    if ($url !== '' && !in_array($cmd, ['pending', 'site'], true)) $url = resolve_url($url);
    $args = expand_file_args($args);
    switch ($cmd) {
        case 'context':     echo context($monitor); break;
        case 'fingerprint': echo fingerprint($monitor); break;
        case 'fetch':       // A link that turns out to be a PDF is read as one, not shown as page text.
            $html = fetch_html($url);
            echo str_starts_with($html, '%PDF-') ? page_of(pdf_text($url), $page) : show_page($url, $html, $page);
            break;
        case 'render':      echo show_page($url, render_html($url), $page); break;
        case 'pdf':         echo page_of(pdf_text($url), $page); break;
        case 'videos':      echo list_videos($url); break;
        case 'transcript':  echo page_of(transcript($url), $page); break;
        case 'save-agenda': echo save_item('agenda', $monitor, $url, $args); break;
        case 'save-video':  echo save_item('video', $monitor, $url, $args); break;
        case 'pending':     echo save_pending($monitor, $url, $args); break;
        case 'notes':
            q("UPDATE site SET layout_notes = ?, updated_at = datetime('now') WHERE id = ?", [mb_substr(text_arg($args, 'file', 'text'), 0, 6000), $monitor['site_id']]);
            echo "The site's notes are saved, for every agent watching it.\n";
            break;
        case 'members':
            $names = array_filter(array_map('trim', preg_split('/[\n;]+/', text_arg($args, 'file', 'text'))));
            q('UPDATE site SET members = ? WHERE id = ?', [implode("\n", array_slice($names, 0, 60)), $monitor['site_id']]);
            echo count($names) . " members saved.\n";
            break;
        case 'types':       echo save_types($monitor, text_arg($args, 'file', 'text')); break;
        case 'setup-done':  echo setup_done($monitor); break;
        case 'site':        echo site_status($monitor, $url, $args); break;
        default:            echo HELP, "\n";
    }
} catch (Throwable $e) {
    ob_end_clean();
    fwrite(STDERR, 'adtool: ' . clean_text($e->getMessage()) . "\n");
    exit(1);
}
// Page breaks and other control characters from PDFs break the model API request, so only newlines and tabs get through.
echo clean_text((string)ob_get_clean());

function clean_text(string $s): string
{
    return preg_replace('/[\x00-\x08\x0B-\x1F\x7F]/', "\n", mb_convert_encoding($s, 'UTF-8', 'UTF-8'));
}

// ---------------------------------------------------------------------------

function current_monitor(): array
{
    static $m = null;
    if ($m) return $m;
    $slug = basename((string)getenv('HOME'));
    $m = row("SELECT m.*, s.agenda_url, s.layout_notes, s.members, s.meeting_types AS site_types, s.setup_state, s.setup_monitor,
        s.health, s.repair_monitor, s.repair_note, s.repair_started, s.name AS site_name
        FROM monitor m JOIN site s ON s.id = m.site_id WHERE m.slug = ?", [$slug]);
    if (!$m) { fwrite(STDERR, "adtool: no monitor for HOME=" . getenv('HOME') . "\n"); exit(2); }
    return $m;
}

// Long URLs get mistyped when the model copies them, so every link adtool shows gets a short handle (L12)
// that any command accepts in place of the URL. Handles last for the agent's whole history.
function link_handle(string $url): string
{
    static $map = null;
    $file = getenv('HOME') . '/cache/links.json';
    $map ??= is_file($file) ? (json_decode((string)file_get_contents($file), true) ?: []) : [];
    $id = array_search($url, $map, true);
    if ($id === false) {
        $id = count($map) + 1;
        $map[$id] = $url;
        @mkdir(dirname($file), 0700, true);
        file_put_contents($file, json_encode($map, JSON_UNESCAPED_SLASHES));
    }
    return "L$id";
}

function resolve_url(string $arg): string
{
    if (!preg_match('/^L(\d+)$/i', trim($arg), $m)) return trim($arg, " \t\"'");
    $file = getenv('HOME') . '/cache/links.json';
    $map = is_file($file) ? (json_decode((string)file_get_contents($file), true) ?: []) : [];
    return $map[$m[1]] ?? throw new RuntimeException("no link $arg, fetch the page again to see its links");
}

// Text with punctuation breaks the shell before adtool sees it: ; is refused, ( and ' are syntax errors and
// $5,000 loses its $5. So any --name-file option reads that value from a file in the agent's workspace.
function read_workspace_file(string $f): string
{
    // Only the workspace: the agent's config (with the model key) and logs sit next to it in HOME.
    $ws = realpath(getenv('HOME') . '/.nullclaw/workspace');
    if ($f === '' || $f[0] !== '/') $f = "$ws/$f";
    $real = realpath($f);
    if (!$ws || !$real || !is_file($real) || !str_starts_with($real, $ws . '/')) {
        throw new RuntimeException("can't read $f, keep files inside your workspace");
    }
    return trim((string)file_get_contents($real));
}

function expand_file_args(array $args): array
{
    foreach ($args as $k => $v) {
        if (is_string($k) && $k !== 'file' && str_ends_with($k, '-file') && is_string($v)) $args[substr($k, 0, -5)] = read_workspace_file($v);
    }
    return $args;
}

function text_arg(array $args, string $fileKey, string $inlineKey): string
{
    if (!empty($args[$fileKey]) && is_string($args[$fileKey])) return read_workspace_file($args[$fileKey]);
    return trim((string)($args[$inlineKey] ?? ''));
}

function need_url(string $url): void
{
    if (!filter_var($url, FILTER_VALIDATE_URL) || !safe_url($url)) throw new RuntimeException("not a public http(s) URL: $url");
}

// Pages and PDFs are cached per site, so every agent watching the same site reads them once between them.
function cache_path(string $kind, string $url): string
{
    $dir = cfg('data_dir') . '/sites/' . current_monitor()['site_id'] . '/cache';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);  // parallel jobs may create it first
    return "$dir/$kind-" . sha1($url);
}

function cached(string $kind, string $url, callable $make, int $ttl = 3600): string
{
    $f = cache_path($kind, $url);
    $fresh = is_file($f) && filemtime($f) > time() - $ttl;
    // A posted PDF or caption track doesn't change, so an agent's own copy from an earlier run is still good.
    if ($fresh && !(in_array($kind, ['html', 'render'], true) && own_earlier_copy($f))) return (string)file_get_contents($f);
    $out = $make();
    file_put_contents($f, $out);
    file_put_contents("$f.by", (string)current_monitor()['id']);
    return $out;
}

// A page this agent fetched in an earlier run is fetched again: the page cache is for agents on the same site sharing
// a download, not for one agent checking twice in a row and reading its own stale copy.
function own_earlier_copy(string $f): bool
{
    $m = current_monitor();
    if (@file_get_contents("$f.by") !== (string)$m['id']) return false;
    $start = val('SELECT last_run_start FROM agent WHERE monitor_id = ?', [$m['id']]);
    return $start && filemtime($f) < strtotime($start . ' UTC');
}

function fetch_html(string $url): string
{
    need_url($url);
    // Pages are cached only long enough for agents on the same site running back to back to share a download;
    // any longer and a run reads yesterday's page and misses a new meeting or a redesign.
    return cached('html', $url, function () use ($url) {
        [$code, $body] = http_request('GET', $url, null, ['Accept: text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language: en-CA,en;q=0.9']);
        if ($code >= 400 || $code === 0) throw new RuntimeException("HTTP $code from $url, try adtool render, or the page may have moved");
        return (string)$body;
    }, 120);
}

// Every executable runs through the agenda delivery service, which queues it (2 Chrome instances at a time),
// applies its time limit and records it in the job table.
function run_tool(string $tool, array $args, string $target): array
{
    $r = service('POST', '/exec', ['tool' => $tool, 'args' => $args, 'monitor_id' => (int)current_monitor()['id'], 'target' => $target],
        (int)cfg('browser_wait') + 200);
    if ($r === null) throw new RuntimeException('the agenda delivery service is not answering, try again later');
    return $r;
}

// Chrome loads the page and returns its HTML; with $saveTo it downloads the URL to that file instead.
function in_browser(string $url, ?string $saveTo = null): string
{
    $r = run_tool('render', $saveTo ? [$url, $saveTo] : [$url], $url);
    if ($r['exit'] !== 0) throw new RuntimeException("browser failed ({$r['exit']}): " . mb_substr($r['stderr'] ?: $r['stdout'], -300));
    return $r['stdout'];
}

// Scratch files sit under the data folder, which adtool and the service both see.
function scratch(): string
{
    $dir = cfg('data_dir') . '/tmp';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);  // parallel jobs may create it first
    return $dir;
}

function render_html(string $url): string
{
    need_url($url);
    return cached('render', $url, fn() => in_browser($url), 120);
}

// Page text and links cost tokens on every later model call, so pages are cut into small pieces.
function show_page(string $url, string $html, int $page): string
{
    [$text, $links] = html_to_text($html, $url);
    file_put_contents(cache_path('text', $url), $text);
    $out = "TEXT\n" . page_of($text, $page, 5000) . "\n\nLINKS (" . count($links) . ")\n";
    foreach (array_slice($links, 0, 150, true) as $href => $label) {
        $out .= link_handle($href) . '  ' . ($label !== '' ? mb_substr($label, 0, 80) . ' → ' : '') . "$href\n";
    }
    if (count($links) > 150) $out .= "(" . (count($links) - 150) . " more links not shown)\n";
    if (mb_strlen($text) < 200) $out .= "\n(little text came back; if the page needs scripts, try adtool render)\n";
    return $out;
}

function pdf_text(string $url): string
{
    need_url($url);
    return cached('pdf', $url, function () use ($url) {
        // Agenda packages run to tens of megabytes, so they go straight to disk, not memory.
        $tmp = tempnam(scratch(), 'pdf');
        try {
            $code = download($url, $tmp);
            // Sites behind a bot check refuse plain downloads; a real browser gets through.
            if (in_array($code, [403, 429, 503], true)) {
                in_browser($url, $tmp);
                $code = 200;
            }
            $head = (string)file_get_contents($tmp, false, null, 0, 5);
            if ($code !== 200 || $head !== '%PDF-') throw new RuntimeException("not a PDF (HTTP $code), try adtool fetch, or the file may have moved");
            $r = run_tool('pdftotext', [$tmp], $url);
            $lines = explode("\n", $r['stdout']);
        } finally {
            @unlink($tmp);
        }
        $text = trim(preg_replace("/[ \t]{2,}/", ' ', implode("\n", $lines)));
        file_put_contents(cache_path('text', $url), $text);
        return $text;
    }, 86400);
}

function download(string $url, string $file): int
{
    $fh = fopen($file, 'w');
    [$code] = fetch_url($url, [CURLOPT_FILE => $fh, CURLOPT_TIMEOUT => 180]);
    fclose($fh);
    return $code;
}

function yt_dlp(array $args): array
{
    $r = run_tool('yt-dlp', $args, (string)end($args));
    if ($r['exit'] !== 0) throw new RuntimeException('yt-dlp: ' . implode(' ', array_slice(explode("\n", trim($r['stderr'] ?: $r['stdout'])), -3)));
    return array_values(array_filter(explode("\n", $r['stdout']), 'strlen'));
}

function list_videos(string $url): string
{
    need_url($url);
    $args = ['--flat-playlist', '--playlist-end', '15', '--print', '%(url)s\t%(title)s\t%(upload_date)s'];
    // A channel's meetings are usually past live streams; channels that never streamed only have /videos.
    if (preg_match('#youtube\.com/(@[^/]+|channel/[^/]+|c/[^/]+)/?$#', $url)) {
        try {
            return implode("\n", yt_dlp([...$args, rtrim($url, '/') . '/streams'])) . "\n";
        } catch (RuntimeException $e) {
            $url = rtrim($url, '/') . '/videos';
        }
    }
    return implode("\n", yt_dlp([...$args, $url])) . "\n";
}

function transcript(string $url): string
{
    need_url($url);
    return cached('transcript', $url, function () use ($url) {
        $dir = scratch() . '/vtt-' . bin2hex(random_bytes(4));
        mkdir($dir);
        try {
            // One English track per video, since each track is another request and YouTube limits how many it answers.
            // "en" is the captions a person wrote when there are some, and otherwise the automatic ones; "en-orig" is
            // asked for only when a video has no "en" track at all.
            $get = fn(string $lang) => yt_dlp(['--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', $lang, '--sub-format', 'vtt', '-o', "$dir/v", $url]);
            $get('en');
            if (!glob("$dir/*.vtt")) $get('en-orig');
            $files = glob("$dir/*.vtt");
            if (!$files) throw new RuntimeException('this video has no captions');
            $text = correct_names(vtt_to_text((string)file_get_contents($files[0])), array_filter(explode("\n", current_monitor()['members'])));
        } finally {
            array_map('unlink', glob("$dir/*") ?: []);
            rmdir($dir);
        }
        file_put_contents(cache_path('text', $url), $text);
        return $text;
    }, 86400 * 30);
}

// ---- saving ------------------------------------------------------------------

// The meeting type key for --type, which must be one this monitor tracks.
function tracked_type(array $m, string $given): string
{
    require_once __DIR__ . '/../src/monitors.php';
    $types = site_meeting_types($m['site_types']);
    $tracked = json_decode($m['meeting_types'], true) ?: [];
    $want = strtolower(trim($given));
    $key = null;
    foreach ($types as $k => $t) {
        if ($want === $k || $want === strtolower($t['name'])) $key = $k;
    }
    $list = implode(', ', array_map(fn($k) => "$k ({$types[$k]['name']})", $tracked));
    if ($key === null) throw new RuntimeException("--type must be one of this monitor's meeting types: $list");
    if (!in_array($key, $tracked, true)) throw new RuntimeException("this monitor doesn't follow {$types[$key]['name']} meetings, so don't save it. It follows: $list");
    return $key;
}

function save_item(string $kind, array $m, string $url, array $args): string
{
    need_url($url);
    if ($m['state'] !== 'ready') throw new RuntimeException("this monitor's owner hasn't chosen its meetings yet, so nothing can be saved");
    $title = trim((string)($args['title'] ?? ''));
    if ($title === '') throw new RuntimeException('--title is required');
    $type = tracked_type($m, (string)($args['type'] ?? ''));
    $date = (string)($args['date'] ?? '');
    $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $date : null;
    // A meeting already saved stays saved when a redesign moves its file: same date and type is the same meeting.
    $existing = row("SELECT id FROM $kind WHERE monitor_id = ? AND (url = ? OR (meeting_date = ? AND meeting_type = ?))", [$m['id'], $url, $date, $type]);
    if ($existing) {
        q("UPDATE OR IGNORE $kind SET url = ?, title = ?, meeting_type = ?, meeting_date = coalesce(?, meeting_date) WHERE id = ?", [$url, $title, $type, $date, $existing['id']]);
        return "Already saved, so nothing new for its owner. Updated its link, title, type and date.\n";
    }
    $known = cache_path('text', $url);
    $text = is_file($known) ? (string)file_get_contents($known) : '';
    if (mb_strlen($text) < 100 || str_starts_with($text, '%PDF-')) {
        throw new RuntimeException($kind === 'video' ? 'read the transcript first with adtool transcript' : 'read the agenda first with adtool pdf or adtool fetch');
    }
    // The summary is written in this monitor's voice, the same way its Summary tab previews it.
    $voice = monitor_voice($m);
    $summary = summarize($voice['prompt'], $title, $text, (int)$m['id'], null, $voice['markdown']);
    if ($kind === 'video') {
        q('INSERT INTO video (monitor_id, url, title, meeting_date, meeting_type, summary, transcript) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$m['id'], $url, $title, $date, $type, $summary, $text]);
    } else {
        q('INSERT INTO agenda (monitor_id, url, title, meeting_date, meeting_type, summary, text) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$m['id'], $url, $title, $date, $type, $summary, mb_substr($text, 0, 200000)]);
    }
    record_summary((int)$m['id'], $kind, (int)db()->lastInsertId(), $voice, $summary);
    // Until the first check is done the agent is catching up on meetings already posted: saved, not sent.
    if (!$m['notify_from']) return "Saved, and its summary is written. This is the monitor's first check, so meetings already posted are saved without notifying its owner.\n";
    // A meeting dated before the monitor started was posted before it too, even if it's only being saved now.
    if ($date !== null && $date < substr($m['notify_from'], 0, 10)) return "Saved, and its summary is written. It's an older meeting, so its owner isn't notified.\n";
    q('INSERT INTO event (monitor_id, kind, title, url, body, text) VALUES (?, ?, ?, ?, ?, ?)', [$m['id'], $kind, $title, $url, $summary, mb_substr($text, 0, 200000)]);
    return "Saved the new $kind, and its summary is written. Its owner will be notified.\n";
}

function save_pending(array $m, string $key, array $args): string
{
    $key = substr(slugify($key), 0, 80);
    if ($key === '' || empty($args['title']) || empty($args['status'])) throw new RuntimeException('KEY, --title and --status are required');
    $open = empty($args['closed']) ? 1 : 0;
    $detail = mb_substr((string)($args['detail'] ?? ''), 0, 1000);
    $args['url'] = is_string($args['url'] ?? null) ? resolve_url($args['url']) : '';
    if ($args['url'] !== '') need_url($args['url']);
    $old = row('SELECT * FROM pending_item WHERE monitor_id = ? AND item_key = ?', [$m['id'], $key]);
    if ($old && $old['status'] === $args['status'] && (int)$old['open'] === $open && $old['detail'] === $detail) return "No change.\n";
    q("INSERT INTO pending_item (monitor_id, item_key, title, status, detail, source_url, open) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (monitor_id, item_key) DO UPDATE SET title = excluded.title, status = excluded.status, detail = excluded.detail,
       source_url = CASE WHEN excluded.source_url = '' THEN source_url ELSE excluded.source_url END, open = excluded.open, updated_at = datetime('now')",
        [$m['id'], $key, $args['title'], $args['status'], $detail, (string)($args['url'] ?? ''), $open]);
    q('INSERT INTO pending_history (monitor_id, item_key, title, status, detail, open) VALUES (?, ?, ?, ?, ?, ?)',
        [$m['id'], $key, $args['title'], $args['status'], $detail, $open]);
    if ($m['notify_from'] && (!$old || $old['status'] !== $args['status'] || (int)$old['open'] !== $open)) {
        q('INSERT INTO event (monitor_id, kind, title, url, body) VALUES (?, ?, ?, ?, ?)', [
            $m['id'], 'pending', $args['title'], (string)($args['url'] ?? ''),
            ($open ? "Now: {$args['status']}" : "Settled: {$args['status']}") . ($old ? " (was: {$old['status']})" : '') . ($detail ? "\n$detail" : ''),
        ]);
    }
    return ($old ? 'Updated' : 'Added') . " pending item $key.\n";
}

// ---- the site: setup and repair ---------------------------------------------------

function save_types(array $m, string $text): string
{
    $types = [];
    foreach (preg_split('/\n+/', $text) as $line) {
        $parts = array_map('trim', explode('|', $line));
        if (($parts[0] ?? '') === '') continue;
        $key = substr(slugify($parts[0]), 0, 40);
        $types[$key] = ['key' => $key, 'name' => mb_substr($parts[0], 0, 80), 'default' => preg_match('/^(y|yes|true|default)/i', $parts[1] ?? '') === 1];
    }
    if (!$types) throw new RuntimeException('no meeting types found, one per line: Name | yes');
    q("UPDATE site SET meeting_types = ?, updated_at = datetime('now') WHERE id = ?", [json_encode(array_values($types)), $m['site_id']]);
    return count($types) . " meeting types saved: " . implode(', ', array_map(fn($t) => $t['name'] . ($t['default'] ? ' (default)' : ''), $types)) . "\n";
}

function setup_done(array $m): string
{
    $site = row('SELECT * FROM site WHERE id = ?', [$m['site_id']]);
    if (trim($site['layout_notes']) === '') throw new RuntimeException('write the notes on how the site is laid out first, with adtool notes');
    if ((json_decode($site['meeting_types'], true) ?: []) === []) throw new RuntimeException('save the meeting types first, with adtool types');
    q("UPDATE site SET setup_state = 'ready', setup_monitor = NULL, updated_at = datetime('now') WHERE id = ?", [$m['site_id']]);
    // Every account waiting on this site can now choose its meetings.
    $n = q("UPDATE monitor SET state = 'choose' WHERE site_id = ? AND state = 'setup'", [$m['site_id']])->rowCount();
    return "The site is set up. $n monitor(s) can now choose their meetings. End this run: your owner chooses next, and monitoring starts after that.\n";
}

function site_status(array $m, string $what, array $args): string
{
    $site = row('SELECT * FROM site WHERE id = ?', [$m['site_id']]);
    $mine = (int)$site['repair_monitor'] === (int)$m['id'];
    // A repair nobody finished in 45 minutes is up for grabs again.
    $stale = $site['repair_started'] && strtotime($site['repair_started'] . ' UTC') < time() - 2700;
    if ($what === 'broken') {
        $note = mb_substr(trim((string)($args['detail'] ?? '')), 0, 1000);
        if ($site['health'] === 'repairing' && $site['repair_monitor'] && !$mine && !$stale) {
            return "Another agent watching this site is already repairing it. Don't explore or change the notes; end this run now. You'll be run again once it's fixed.\n";
        }
        q("UPDATE site SET health = 'repairing', repair_monitor = ?, repair_note = ?, repair_started = datetime('now'), updated_at = datetime('now') WHERE id = ?",
            [$m['id'], $note, $m['site_id']]);
        return "You're repairing this site for every agent watching it. Find where the meetings and agendas are now, rewrite the notes with adtool notes, check the meeting types with adtool types if they changed, then run adtool site fixed. After that, carry on with your normal check.\n";
    }
    if ($what === 'fixed') {
        if (!$mine) throw new RuntimeException("you aren't repairing this site, so there's nothing to mark fixed");
        q("UPDATE site SET health = 'ok', repair_monitor = NULL, repair_started = NULL, fixed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [$m['site_id']]);
        // The agenda page itself may have moved; the site's link follows it unless another site already watches that page.
        if (is_string($args['url'] ?? null)) {
            $new = resolve_url($args['url']);
            need_url($new);
            q('UPDATE OR IGNORE site SET agenda_url = ? WHERE id = ?', [$new, $m['site_id']]);
        }
        // The other agents watching this site run again now, with the new notes.
        $n = q("UPDATE agent SET run_requested = 2 WHERE monitor_id IN (SELECT id FROM monitor WHERE site_id = ? AND id != ? AND state = 'ready')",
            [$m['site_id'], $m['id']])->rowCount();
        return "The site is marked fixed. $n other agent(s) watching it will run again with your notes. Carry on with your normal check.\n";
    }
    throw new RuntimeException('use adtool site broken --detail-file F, or adtool site fixed');
}

// ---- context -------------------------------------------------------------------

// The links on the agenda page and the videos listed, as one hash. The service skips a scheduled run when it
// matches the last full run, since nothing new can have been posted. A page built by scripts shows too few links
// to tell, so it fails and the agent runs as usual.
function fingerprint(array $m): string
{
    $links = fn(string $u) => array_keys(html_to_text(fetch_html($u), $u)[1]);
    $parts = $links($m['agenda_url']);
    if (count($parts) < 10) throw new RuntimeException('too few links on the agenda page to tell whether it changed');
    if ($m['video_url']) {
        $parts = array_merge($parts, $m['video_source'] === 'youtube'
            ? array_map(fn($l) => strtok($l, "\t"), array_filter(explode("\n", list_videos($m['video_url']))))
            : $links($m['video_url']));
    }
    $parts = array_unique($parts);
    sort($parts);
    return sha1(implode("\n", $parts)) . "\n";
}

function context(array $m): string
{
    require_once __DIR__ . '/../src/monitors.php';
    $site = row('SELECT * FROM site WHERE id = ?', [$m['site_id']]);
    $types = site_meeting_types($site['meeting_types']);
    $tracked = json_decode($m['meeting_types'], true) ?: [];
    $others = (int)val('SELECT count(*) FROM monitor WHERE site_id = ? AND id != ?', [$m['site_id'], $m['id']]);

    // The name is the one thing an account types that its agent sees, so it's kept to a short plain label.
    $label = mb_substr(trim(preg_replace("/[^\\p{L}\\p{N} .,&()'-]+/u", ' ', $m['name'])), 0, 60);
    $out = 'Today is ' . date('l, F j, Y') . ".\n\nMONITOR\nName: $label\nType: " . (monitor_kinds()[$m['kind']] ?? $m['kind'])
        . "\nAgenda page: {$site['agenda_url']}\n";
    $out .= 'Video page: ' . ($m['video_url'] ? "{$m['video_url']} ({$m['video_source']})" : 'none') . "\n";
    $out .= "Other agents watching this site: $others\n";

    $out .= "\nSITE STATE\n";
    if ($site['setup_state'] !== 'ready') {
        $out .= "Not set up yet. This run is the setup: follow the Setup section of AGENTS.md.\n";
    } elseif ($site['health'] === 'repairing' && !$site['repair_monitor']) {
        $out .= "THE SITE WAS FOUND CHANGED AND NOBODY HAS FINISHED REPAIRING IT (noted: {$site['repair_note']}). Take on the repair: follow \"When the site has changed\" in AGENTS.md.
";
    } elseif ($site['health'] === 'repairing' && (int)$site['repair_monitor'] !== (int)$m['id']) {
        $out .= "ANOTHER AGENT IS REPAIRING THIS SITE (it said: {$site['repair_note']}). Don't explore or change the notes. End this run now; you'll be run again once it's fixed.\n";
    } elseif ($site['health'] === 'repairing') {
        $out .= "You're repairing this site (you said: {$site['repair_note']}). Finish the repair, then run adtool site fixed.\n";
    } else {
        $out .= "Set up and working" . ($site['fixed_at'] ? ", last repaired {$site['fixed_at']} UTC" : '') . ".\n";
    }

    if ($m['state'] === 'ready') {
        $out .= "\nMEETING TYPES THIS MONITOR FOLLOWS (use the key with --type; skip every other type)\n";
        foreach ($tracked as $k) $out .= "$k  {$types[$k]['name']}\n";
        $skip = array_diff(array_keys($types), $tracked);
        if ($skip) $out .= "Not followed: " . implode(', ', array_map(fn($k) => $types[$k]['name'], $skip)) . "\n";
    } elseif ($types) {
        $out .= "\nMEETING TYPES FOUND AT SETUP\n" . implode("\n", array_map(fn($t) => $t['name'] . ($t['default'] ? ' (default)' : ''), $types)) . "\n";
    }

    $out .= "\nNOTES ON THIS SITE (shared by every agent watching it)\n" . ($site['layout_notes'] ?: '(none yet)') . "\n";
    $out .= "\nMEMBERS\n" . ($site['members'] ?: '(none saved yet)') . "\n";
    $out .= "\nAGENDAS ALREADY SAVED (newest first)\n";
    foreach (rows('SELECT url, title, meeting_date, meeting_type FROM agenda WHERE monitor_id = ? ORDER BY coalesce(meeting_date, found_at) DESC LIMIT 15', [$m['id']]) as $a) {
        $out .= "{$a['meeting_date']}  [{$a['meeting_type']}]  {$a['title']}  {$a['url']}\n";
    }
    $out .= "\nVIDEOS ALREADY SAVED\n";
    foreach (rows('SELECT url, title, meeting_date FROM video WHERE monitor_id = ? ORDER BY coalesce(meeting_date, found_at) DESC LIMIT 10', [$m['id']]) as $v) {
        $out .= "{$v['meeting_date']}  {$v['title']}  {$v['url']}\n";
    }
    $out .= "\nDOCUMENTS YOU'VE ALREADY READ (what they say is already in what you saved and in the pending items, so don't read them again)\n";
    foreach (rows("SELECT target, max(ended_at) AS at FROM job WHERE monitor_id = ? AND tool = 'pdftotext' AND state = 'done'
        AND ended_at > datetime('now', '-60 days') GROUP BY target ORDER BY at DESC LIMIT 40", [$m['id']]) as $d) {
        $out .= "{$d['at']}  {$d['target']}\n";
    }
    $out .= "\nOPEN PENDING ITEMS\n";
    foreach (rows('SELECT item_key, title, status FROM pending_item WHERE monitor_id = ? AND open = 1 ORDER BY updated_at DESC', [$m['id']]) as $p) {
        $out .= "{$p['item_key']}  {$p['title']}  [{$p['status']}]\n";
    }
    return $out;
}
