<?php
// Runnable self-check: php tests/check.php. Uses a throwaway database.
declare(strict_types=1);
$tmp = sys_get_temp_dir() . '/agenda-check-' . getmypid();
putenv('AGENDA_CONFIG=' . $tmp . '/config.php');
@mkdir($tmp);
file_put_contents("$tmp/config.php", '<?php return ["data_dir" => ' . var_export($tmp, true) . ', "base_url" => "http://localhost", "mail_capture" => ' . var_export("$tmp/mail.log", true) . '];');

require __DIR__ . '/../src/app.php';
require __DIR__ . '/../src/tools.php';
require __DIR__ . '/../src/monitors.php';
require __DIR__ . '/../src/lists.php';
require __DIR__ . '/../src/notify.php';
require __DIR__ . '/../src/summary.php';
require __DIR__ . '/../src/join.php';
require __DIR__ . '/../src/report.php';

$n = 0;
function ok(bool $c, string $what): void { global $n; $n++; if (!$c) { fwrite(STDERR, "FAIL: $what\n"); exit(1); } }

// Transcript name correction
$members = ['Eric Woodward', 'Kim Richter', 'Rob Ferguson'];
ok(correct_names('Councillor fergusen moved the motion', $members) === 'Councillor Ferguson moved the motion', 'title + misspelt surname');
ok(correct_names('Mayor Woodword said', $members) === 'Mayor Woodward said', 'mayor surname');
ok(correct_names('Kim Rickter seconded', $members) === 'Kim Richter seconded', 'first name + surname');
ok(correct_names('Councillor Smith spoke', $members) === 'Councillor Smith spoke', 'unrelated name left alone');
ok(correct_names('the long road', $members) === 'the long road', 'ordinary words left alone');

// Command lines the model writes without quotes
$a = parse_args(['pending', 'tree-bylaw', '--title', 'Tree', 'Bylaw', 'Review', '--status', 'third', 'reading', '--closed']);
ok($a['_'] === ['pending', 'tree-bylaw'] && $a['title'] === 'Tree Bylaw Review' && $a['status'] === 'third reading' && $a['closed'] === true, 'multi-word values');
$a = parse_args(['save-agenda', '--title', 'Regular', 'Meeting', 'https://x.ca/a?Id=1&b=2', '--date', '2026-11-16']);
ok($a['_'] === ['save-agenda', 'https://x.ca/a?Id=1&b=2'] && $a['title'] === 'Regular Meeting', 'URL after an option stays positional');
ok(parse_args(['pdf', 'L12', '--page', '2'])['_'] === ['pdf', 'L12'], 'link handle is positional');

// Captions
$vtt = "WEBVTT\nKind: captions\n\n00:00:01.000 --> 00:00:02.000\ngood evening\n\n00:00:02.000 --> 00:00:03.000\ngood evening\nwe'll call<00:00:02.500><c> the</c> meeting\n";
ok(vtt_to_text($vtt) === "good evening we'll call the meeting", 'vtt rolling captions deduped: ' . vtt_to_text($vtt));

// Links
ok(absolute_url('../a/b.pdf', 'https://x.ca/en/c/d.aspx') === 'https://x.ca/en/a/b.pdf', 'relative ../');
ok(absolute_url('/f.pdf', 'https://x.ca/en/c/') === 'https://x.ca/f.pdf', 'root relative');
[$text, $links] = html_to_text('<html><body><script>x()</script><p>Agenda</p><a href="a.pdf">Jan 5 Agenda</a><iframe src="//cal.example.com/m"></iframe></body></html>', 'https://x.ca/m/');
ok(str_contains($text, 'Agenda') && !str_contains($text, 'x()'), 'text without scripts');
ok(($links['https://x.ca/m/a.pdf'] ?? '') === 'Jan 5 Agenda' && isset($links['https://cal.example.com/m']), 'links and frames');

// Keyword rules
ok(keyword_hits('The rezoning at 200 Street passed. Parks were discussed.', 'rezoning') === "Matches for rezoning:\n• The rezoning at 200 Street passed.", 'keyword hit');
ok(keyword_hits('Nothing here.', 'bike lane') === null, 'no keyword hit');
ok(keyword_hits("Rezoning at 22940 - 48 Avenue.", '8 Avenue') === null, 'keywords match whole words only');
ok(keyword_hits("Bylaw No. 6227 rezones 8 Avenue. Next item.", '8 Avenue') === "Matches for 8 Avenue:\n• Bylaw No. 6227 rezones 8 Avenue.", 'No. does not end a sentence');
ok(keyword_hits("Council will consider a
rezoning on 8 Avenue near
the park. Other business.", '8 Avenue') === "Matches for 8 Avenue:
• Council will consider a rezoning on 8 Avenue near the park.", 'PDF lines joined into sentences');

// URL safety
ok(!safe_url('http://127.0.0.1/x') && !safe_url('http://10.0.0.3/') && !safe_url('file:///etc/passwd'), 'private and non-http blocked');

// Monitors: one per account, accounts on the same page share a site, setup moves them all to choosing
q("INSERT INTO user (email) VALUES ('a@x.ca'), ('b@x.ca'), ('c@x.ca')");
$_SESSION = [];
[$m, $err] = create_monitor(1, ['name' => 'Test Council', 'kind' => 'council', 'agenda_url' => 'https://8.8.8.8/agendas/']);
ok($err === null && $m['slug'] === 'm-' . $m['id'] && (int)$m['num'] === 1 && $m['state'] === 'setup', 'monitor created, waiting on setup: ' . $err);
ok(monitor_url($m) === '/m/1/test-council' && monitor_url($m, 'rule') === '/m/1/test-council/rule', 'its address is the account number, then the name');
[$m2, $err] = create_monitor(2, ['name' => 'Same', 'agenda_url' => '8.8.8.8/agendas']);
ok($m2 && $m2['id'] !== $m['id'] && $m2['site_id'] === $m['site_id'] && (int)val('SELECT count(*) FROM site') === 1, 'second account gets its own monitor on the same site');
ok((int)$m2['num'] === 1, "each account numbers its own monitors, so an address says nothing about other accounts");
ok(create_monitor(1, ['name' => 'Again', 'agenda_url' => 'https://8.8.8.8/agendas'])[1] !== null, 'an account cannot add the same page twice');
q("UPDATE site SET layout_notes = 'notes', meeting_types = ? WHERE id = ?", [json_encode([['key' => 'regular', 'name' => 'Regular Council Meeting', 'default' => true], ['key' => 'hearing', 'name' => 'Public Hearing', 'default' => false]]), $m['site_id']]);
q("UPDATE site SET setup_state = 'ready' WHERE id = ?", [$m['site_id']]);
q("UPDATE monitor SET state = 'choose' WHERE site_id = ? AND state = 'setup'", [$m['site_id']]);
[$m3, $err] = create_monitor(3, ['name' => 'Third', 'agenda_url' => 'https://8.8.8.8/agendas']);
ok($m3['state'] === 'choose', 'a later account on a set-up site goes straight to choosing');
$own = own_monitor(1, 1);
ok(save_choices($own, ['types' => [], 'summary_prompt' => 'x']) !== null, 'choices need at least one meeting type');
ok(save_choices($own, ['types' => ['hearing'], 'summary_prompt' => 'Be brief.']) !== null, 'a custom prompt the guard cannot check is refused');
ok(save_choices($own, ['types' => ['hearing', 'bogus'], 'summary_prompt' => default_summary_prompt()]) === null, 'choices saved');
$own = own_monitor(1, 1);
ok($own['state'] === 'ready' && $own['meeting_types'] === '["hearing"]' && $own['summary_prompt'] === default_summary_prompt(), 'monitoring starts with the chosen types and prompt');
ok(own_monitor(2, 1)['id'] === $m2['id'] && own_monitor(2, 2) === null, 'a monitor is found only in its own account');
remove_monitor(3, (int)$m3['id']);
[$m3b] = create_monitor(3, ['name' => 'Third again', 'agenda_url' => 'https://8.8.8.8/agendas']);
ok((int)$m3b['num'] === 2, "a removed monitor's number is never given out again");
remove_monitor(3, (int)$m3b['id']);
ok((int)val('SELECT count(*) FROM monitor WHERE site_id = ?', [$m['site_id']]) === 2 && (int)val('SELECT count(*) FROM site') === 1, 'removing one monitor leaves the site for the others');
ok(create_monitor(1, ['name' => 'P', 'agenda_url' => 'https://8.8.4.4', 'visibility' => 'private'])[1] !== null, 'private refused');

// Destinations: every account has its own address as a default, and a new monitor sends its summaries there.
$mail = fn() => is_file("$tmp/mail.log") ? file_get_contents("$tmp/mail.log") : '';
$state = fn(string $title, string $content) => val('SELECT d.state FROM delivery d JOIN event e ON e.id = d.event_id JOIN rule r ON r.id = d.rule_id
    WHERE e.title = ? AND r.content = ? AND r.target_id = ?', [$title, $content, default_target(1)['id']]);
$happens = function (string $title, string $body = 'Parks.') use ($m) {
    q("INSERT INTO event (monitor_id, kind, title, body) VALUES (?, 'agenda', ?, ?)", [$m['id'], $title, $body]);
    drain_events();
};
$def = default_target(1);
ok((int)$def['is_default'] === 1 && $def['address'] === 'a@x.ca' && (int)$def['confirmed'] === 1 && default_target(1)['id'] === $def['id'], "every account has its own address as its default destination, once");
ok((int)val('SELECT count(*) FROM rule WHERE monitor_id = ? AND target_id = ?', [$m['id'], $def['id']]) === 1, 'a new monitor sends to the default destination');
ok(add_target(1, ['kind' => 'discord', 'address' => 'https://example.com/x']) !== null, 'bad discord url refused');
ok(add_target(1, ['kind' => 'webhook', 'address' => 'http://8.8.8.8/hook']) !== null, 'a webhook must be https');
ok(add_target(1, ['kind' => 'email', 'address' => 'A@x.ca']) !== null, "the account's own address is not added a second time");
ok(add_rule(1, (int)$m['id'], ['target_id' => $def['id'], 'content' => 'keywords', 'events' => ['agenda']]) !== null, 'keywords rule needs keywords');
ok(add_rule(1, (int)$m['id'], ['target_id' => $def['id'], 'content' => 'keywords', 'keywords' => 'nomatch', 'events' => ['agenda']]) === null, 'rule added');
ok(add_rule(2, (int)$m['id'], ['target_id' => $def['id'], 'events' => ['agenda']]) !== null, "a rule can't use another account's destination");
$happens('Jan 5');
ok(val('SELECT sent_at FROM event') !== null && $state('Jan 5', 'summary') === 'sent' && $state('Jan 5', 'keywords') === 'quiet', 'the summary is sent, the non-matching keyword rule stays quiet and the event closes');
ok(str_contains($mail(), "To: a@x.ca\nSubject: Test Council: New agenda, Jan 5") && !str_contains($mail(), 'Unsubscribe'), "mail to the account's own address is sent, with no unsubscribe link");

// Pausing and digests
q('UPDATE target SET paused = 1 WHERE id = ?', [$def['id']]);
$happens('Jan 12');
ok($state('Jan 12', 'summary') === 'skipped' && !str_contains($mail(), 'Jan 12'), 'a paused destination gets nothing');
q('UPDATE target SET paused = 0 WHERE id = ?', [$def['id']]);
ok(update_target($def, ['name' => '']) !== null && update_target($def, ['name' => 'My email', 'digest' => 'daily']) === null, 'a destination can be renamed and set to a daily digest');
ok(digest_choice('discord', ['digest' => 'daily'])[0] === 'now' && digest_choice('list', ['digest' => 'weekly', 'digest_day' => 9]) === ['weekly', 7], 'only email and lists take a digest');
$happens('Jan 19');
$happens('Jan 26', 'Roads.');
ok($state('Jan 19', 'summary') === 'queued' && !str_contains($mail(), 'Jan 19'), 'with a digest set, news waits');
q("UPDATE digest_item SET created_at = '2026-11-23 06:00:00'");   // late on the 22nd by the site's clock
$tz = new DateTimeZone(cfg('timezone'));
$at = fn(string $local) => new DateTimeImmutable($local, $tz);
ok(send_digests($at('2026-11-23 05:00')->getTimestamp()) === 0, 'a digest waits for the morning');
ok(send_digests($at('2026-11-23 08:00')->getTimestamp()) === 1 && str_contains($mail(), 'Subject: 2 meeting updates from Test Council') && str_contains($mail(), 'Roads.')
    && $state('Jan 19', 'summary') === 'sent' && (int)val('SELECT count(*) FROM digest_item') === 0, 'the digest goes out as one email and the waiting items are settled');
$weekly = ['digest' => 'weekly', 'digest_day' => 1];   // Mondays; 23 November 2026 is one
ok(!digest_due($weekly, $at('2026-11-22 09:00'), '2026-11-21 12:00:00') && !digest_due($weekly, $at('2026-11-23 06:00'), '2026-11-21 12:00:00')
    && digest_due($weekly, $at('2026-11-23 09:00'), '2026-11-21 12:00:00'), 'a weekly digest goes out on its weekday');
ok(!digest_due(['digest' => 'daily'], $at('2026-11-23 20:00'), '2026-11-23 16:00:00') && digest_due(['digest' => 'daily'], $at('2026-11-24 08:00'), '2026-11-23 16:00:00')
    && digest_due($weekly, $at('2026-11-25 08:00'), '2026-11-21 12:00:00'), 'news after the morning waits for the next one, and a missed digest is caught up');
update_target($def, ['name' => 'My email', 'digest' => 'now']);

// Mailing lists: addresses confirm before they get anything, and every email to them carries an unsubscribe link.
ok(create_list(1, ['name' => 'Visit https://spam.example'])[0] === null, 'a list name cannot carry a link');
[$lid] = create_list(1, ['name' => 'Maple Street Neighbours']);
$list = own_list(1, (int)$lid);
ok($list && $list['kind'] === 'list' && own_list(2, (int)$lid) === null, "a list belongs to its account");
[$valid, $invalid] = parse_addresses("Email,Name\nsam@example.com\nSam Rivers <SAM2@example.com>\nPat Lee, pat@example.com\nx@example.com, y@example.com\nnot an address\nsam@example.com");
ok(array_keys($valid) === ['sam@example.com', 'sam2@example.com', 'pat@example.com', 'x@example.com', 'y@example.com'] && $valid['sam2@example.com'] === 'Sam Rivers'
    && $valid['pat@example.com'] === 'Pat Lee' && $invalid === ['not an address'], 'pasted and imported addresses are read, with names');
$r = add_members($list, "sam@example.com\npat@example.com\na@x.ca\nnope");
$status = fn(string $e) => val('SELECT status FROM list_member WHERE target_id = ? AND email = ?', [$lid, $e]);
ok($r['added'] === 3 && $r['asked'] === 2 && count($r['invalid']) === 1 && $status('sam@example.com') === 'pending' && $status('a@x.ca') === 'active',
    "addresses are added waiting to confirm, except the account's own");
ok(add_members($list, 'Sam@Example.com')['already'] === 1, 'an address is on a list once');
ok(add_rule(1, (int)$m['id'], ['target_id' => $lid, 'events' => ['agenda']]) === null, 'a list is a destination like any other');
$happens('Feb 2');
ok(!str_contains($mail(), "To: sam@example.com\nSubject: Test Council") && str_contains($mail(), 'you confirmed your subscription to Maple Street Neighbours'), 'an address that has not confirmed gets nothing');
preg_match('#To: sam@example\.com\nSubject: Confirm your subscription to Maple Street Neighbours.*?/confirm\?t=([a-f0-9]+)#s', $mail(), $mm);
ok(confirm_member('nope') === null && confirm_member($mm[1] ?? '') === 'sam@example.com' && confirm_member($mm[1]) === null && $status('sam@example.com') === 'active', 'a list confirmation link works once');
$custom = ['name' => 'Maple Street Neighbours', 'send_as' => 'custom', 'brand_source' => 'list', 'reply_to_owner' => '1', 'intro' => 'Hello neighbours.'];
ok(save_list($list, ['sender_name' => 'Free money: spam.example'] + $custom) !== null && save_list($list, ['sender_name' => 'Maple Street'] + $custom) === null
    && own_list(1, (int)$lid)['brand'] === 'list', 'a list can send under its own name, which cannot carry a link');
$happens('Feb 9');
$toSam = substr($mail(), (int)strrpos($mail(), 'To: sam@example.com'));
$unsub = (string)val("SELECT unsub_token FROM list_member WHERE email = 'sam@example.com'");
ok(str_contains($toSam, 'Subject: Test Council: New agenda, Feb 9') && str_contains($toSam, "Unsubscribe: http://localhost/unsubscribe?u=$unsub")
    && str_contains($toSam, "List-Unsubscribe: <http://localhost/unsubscribe?u=$unsub>") && str_contains($toSam, 'List-Unsubscribe-Post: List-Unsubscribe=One-Click')
    && str_contains($toSam, 'Reply-To: a@x.ca') && str_contains(mb_decode_mimeheader($toSam), 'Maple Street via agenda.delivery') && str_contains($toSam, 'Hello neighbours.'),
    'a confirmed address gets the list email with its own unsubscribe link, the sender name and the reply address');
ok((int)val("SELECT d.recipients FROM delivery d JOIN event e ON e.id = d.event_id JOIN rule r ON r.id = d.rule_id WHERE e.title = 'Feb 9' AND r.target_id = ?", [$lid]) === 2, 'the history records how many addresses a list send reached');
// HTML mail, branding and the sample a list's test and preview use
$html = fn(string $m) => quoted_printable_decode(substr($m, (int)strpos($m, 'Content-Transfer-Encoding: quoted-printable')));
ok(str_contains($toSam, 'Content-Type: multipart/alternative') && str_contains($toSam, "Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: 8bit\n\nHello neighbours.\n\nParks.")
    && str_contains($html($toSam), '<h1') && str_contains($html($toSam), '>Unsubscribe</a>'), 'notification mail carries the plain text and an HTML version');
$owner = ['email' => 'a@x.ca', 'org_name' => 'Org Co', 'logo' => 'aaaaaaaaaaaaaaaaaaaaaaaa.png'];
$L = fn(string $brand, string $name = '', string $logo = '') => ['kind' => 'list', 'brand' => $brand, 'sender_name' => $name, 'logo' => $logo, 'name' => 'L', 'intro' => '<script>alert(1)</script>', 'footer' => '', 'reply_to_owner' => 0];
$nameLogo = fn(array $b) => [$b['name'], $b['logo']];
ok($nameLogo(branding($L('agenda', 'Own', 'bbbbbbbbbbbbbbbbbbbbbbbb.png'), $owner)) === ['', ''] && $nameLogo(branding($L('account', 'Own'), $owner)) === ['Org Co', $owner['logo']]
    && $nameLogo(branding($L('list', 'Own'), $owner)) === ['Own', $owner['logo']] && branding(['kind' => 'email'] + $L('list', 'Own'), $owner)['name'] === '',
    'only a list set to custom is branded: with the account\'s name and logo, or its own where it has them');
$nm = notification_mail($L('account'), $owner, 'S <b>', "Para one\n\n• item <i>\n• two https://x.ca/a?b=1&c=2.\n\n- - - - -\n\nend", '', 'http://localhost/unsubscribe?u=x');
ok(!str_contains($nm['html'], '<script>') && str_contains($nm['html'], '&lt;script&gt;') && str_contains($nm['html'], 'S &lt;b&gt;') && str_contains($nm['html'], 'item &lt;i&gt;</li>')
    && str_contains($nm['html'], 'href="https://x.ca/a?b=1&amp;c=2"') && str_contains($nm['html'], '<hr') && str_contains($nm['html'], 'src="http://localhost/media/aaaaaaaaaaaaaaaaaaaaaaaa.png"')
    && $nm['opt']['from_name'] === 'Org Co', 'the HTML escapes what people typed, makes bullets and links, and shows the logo');
ok(!str_contains(notification_mail($L('agenda', 'Own'), $owner, 'S', 'T', '', 'http://localhost/u')['html'], '<img') && notification_mail($L('agenda', 'Own'), $owner, 'S', 'T', '', 'http://localhost/u')['opt']['from_name'] === '',
    'a list sending as agenda.delivery has no name or logo on its mail');
$sample = sample_list_mail(own_list(1, (int)$lid), row('SELECT * FROM user WHERE id = 1'));
ok($sample['subject'] === 'City of Example: New agenda, Regular Council Meeting' && str_starts_with($sample['text'], "Hello neighbours.\n\nCouncil meets") && $sample['opt']['from_name'] === 'Maple Street'
    && $sample['opt']['reply_to'] === 'a@x.ca' && str_contains($sample['text'], 'Unsubscribe: http://localhost/unsubscribe?u=' . val("SELECT unsub_token FROM list_member WHERE email = 'a@x.ca'"))
    && str_contains($sample['card'], '<li') && str_contains($sample['html'], $sample['card']), "a list's sample is built like a real list email, with its name, opening text, reply address and unsubscribe link");
q("DELETE FROM list_member WHERE email = 'a@x.ca'");
ok(str_contains(sample_list_mail(own_list(1, (int)$lid), row('SELECT * FROM user WHERE id = 1'))['text'], 'unsubscribe?u=sample') && unsubscribe_subject('sample') === null, 'off the list, the sample carries a link that unsubscribes no one');
ok(save_list(own_list(1, (int)$lid), ['name' => 'Maple Street Neighbours', 'send_as' => 'agenda', 'sender_name' => 'Ignored']) === null && own_list(1, (int)$lid)['brand'] === 'agenda'
    && own_list(1, (int)$lid)['sender_name'] === 'Maple Street' && save_list($list, ['send_as' => 'custom'] + $custom) === null, 'the choice of how a list sends is saved, and its own name is kept for later');

// Logos: only real PNG, JPEG or WebP files of a sensible size, kept under names made here.
$png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
$put = function (string $bytes) use ($tmp) { file_put_contents("$tmp/upload.png", $bytes); return "$tmp/upload.png"; };
[$logo, $err] = save_logo($put($png));
ok($err === null && preg_match('/^[a-f0-9]{24}\.png$/', (string)$logo) && is_file(media_path($logo)) && file_get_contents(media_path($logo)) === $png, 'a PNG is kept under a random name');
ok(save_logo($put('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))[0] === null && save_logo($put('<?php echo 1;'))[0] === null
    && save_logo($put(base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')))[0] === null, 'an SVG, a script or a GIF named .png is refused');
ok(save_logo($put(substr_replace($png, pack('N', 2000), 16, 4)))[0] === null && save_logo($put($png . str_repeat('x', LOGO_MAX_BYTES)))[0] === null, 'an image that is too wide or too heavy is refused');
ok(media_path('../agenda.db') === null && media_path('aaaaaaaaaaaaaaaaaaaaaaaa.svg') === null && media_path("$logo/../x") === null, 'only names of our own making are looked up');
ob_start(); serve_media($logo); $served = ob_get_clean();
ob_start(); serve_media('aaaaaaaaaaaaaaaaaaaaaaaa.png'); $missing = ob_get_clean();
ok($served === $png && $missing === 'Not found', 'a stored logo is served, and nothing else');
q('UPDATE user SET logo = ? WHERE id = 1', [$logo]);
[$stray] = save_logo($put($png));
touch(media_path($stray), time() - 7200);
touch(media_path($logo), time() - 7200);
ok(sweep_media() === 1 && !is_file(media_path($stray)) && is_file(media_path($logo)), 'logo files nothing uses are cleared out, and ones in use stay');
ok(update_logo('user', 1, 1, null, true) === null && !is_file(media_path($logo)) && val('SELECT logo FROM user WHERE id = 1') === '' && update_logo('monitor', 1, 1, null, true) !== null, 'removing a logo deletes its file');

send_mail('sam@example.com', 'x', 'y', ['from_name' => "Evil\r\nBcc: victim@example.com", 'reply_to' => "a@x.ca\r\nBcc: victim@example.com"]);
ok(!preg_match('/^Bcc:/m', $mail()), 'a sender name or reply address cannot add a mail header');
// Unsubscribing sticks: the account can't add the address back, and only the address can undo it.
$s = unsubscribe_subject($unsub);
ok($s && $s['type'] === 'member' && !$s['blocked'] && unsubscribe_subject('zz') === null && unsubscribe_subject(str_repeat('a', 48)) === null, 'an unsubscribe link finds its address');
unsubscribe($s);
$happens('Feb 16');
ok($status('sam@example.com') === 'unsubscribed' && is_blocked('sam@example.com', 1) && !is_blocked('sam@example.com', 2) && !str_contains($mail(), "To: sam@example.com\nSubject: Test Council: New agenda, Feb 16"),
    'an unsubscribed address gets nothing more');
resubscribe($s);
ok($status('sam@example.com') === 'active' && !is_blocked('sam@example.com', 1), 'the address itself can subscribe again');
unsubscribe($s, true);
q("DELETE FROM list_member WHERE email = 'sam@example.com'");
ok(is_blocked('sam@example.com', 2) && add_members($list, 'sam@example.com')['unsubscribed'] === 1 && $status('sam@example.com') === null
    && add_target(1, ['kind' => 'email', 'address' => 'sam@example.com']) !== null && add_target(2, ['kind' => 'email', 'address' => 'sam@example.com']) !== null,
    'an address that unsubscribed from everything cannot be added back by any account');
for ($i = 0; $i < 3; $i++) too_many('invite:busy@example.com', 3, 604800);
ok(add_members($list, 'busy@example.com')['held'] === 1 && $status('busy@example.com') === null, 'an address is asked to confirm only a few times a week, whoever asks');
q('DELETE FROM target WHERE id = ?', [$lid]);
ok((int)val('SELECT count(*) FROM list_member') === 0 && (int)val('SELECT count(*) FROM rule WHERE target_id = ?', [$lid]) === 0, 'removing a list removes its addresses and rules');

// Joining: a code lets a new account in until its uses run out; a request waits for approval.
q("INSERT INTO user (email) VALUES ('new1@example.com'), ('new2@example.com'), ('new3@example.com')");
$new = fn($e) => row('SELECT * FROM user WHERE email = ?', [$e]);
ok(!is_member($new('new1@example.com')), 'a new account is not a member yet');
$code = create_signup_code(['uses' => 1, 'note' => 'test']);
ok($code !== null && create_signup_code(['code' => $code]) === null, 'a code is made, and the same code cannot be added twice');
ok(join_with_code($new('new1@example.com'), strtolower($code)) === null && is_member($new('new1@example.com')), 'a code lets an account in, whatever its case');
ok(join_with_code($new('new2@example.com'), $code) !== null && !is_member($new('new2@example.com')), 'a used-up code does not');
ok(submit_join_request($new('new2@example.com'), ['name' => 'Pat', 'community' => 'Langley', 'about' => 'Resident', 'use_for' => 'short']) !== null, 'a request needs a real answer for what it is for');
ok(submit_join_request($new('new2@example.com'), ['name' => 'Pat', 'community' => 'Langley', 'about' => 'Resident', 'use_for' => 'Following Langley City council for our walking group.']) === null
    && $new('new2@example.com')['status'] === 'pending', 'a request waits for approval');
decide_join((int)$new('new2@example.com')['id'], true);
decide_join((int)$new('new3@example.com')['id'], false);
ok(is_member($new('new2@example.com')) && !is_member($new('new3@example.com')), 'approving lets them in, declining does not');
$_SESSION['verified'] = false;
ok(!member_session($new('new2@example.com')), 'an approved account whose address is unproved stays at the join step');
$_SESSION['verified'] = true;
ok(member_session($new('new2@example.com')), 'a proved address gets in');
q('DELETE FROM login_link');
send_sign_in_link('new2@example.com', 'test', 'test');
$tok = 'abc'; q("INSERT INTO login_link (token_hash, email, expires_at) VALUES (?, 'new2@example.com', datetime('now', '+1 day'))", [hash('sha256', $tok)]);
ok((int)val('SELECT count(*) FROM login_link') === 2 && use_sign_in_link($tok) === 'new2@example.com' && use_sign_in_link($tok) === null, 'a sign-in link works once');
q("INSERT INTO login_link (token_hash, email, expires_at) VALUES (?, 'new2@example.com', datetime('now', '-1 minute'))", [hash('sha256', 'old')]);
ok(use_sign_in_link('old') === null, 'an expired link does not');

// Problem reports: anyone can send one, a bot filling the hidden field is dropped, and a burst is held back.
ok(submit_report(null, ['email' => 'nope', 'details' => 'Blocked for no reason.']) !== null, 'a signed-out report needs an email');
ok(submit_report(null, ['email' => 'x@example.com', 'kind' => 'signup', 'details' => 'Blocked for no reason.']) === null, 'a signed-out report goes in');
ok(submit_report(null, ['email' => 'x@example.com', 'details' => 'Buy cheap stuff now!', 'website' => 'spam']) === null
    && (int)val('SELECT count(*) FROM problem_report') === 1, 'a bot report is dropped quietly');
submit_report($new('new3@example.com'), ['kind' => 'bogus', 'details' => 'My prompt was refused.']);
ok(val('SELECT kind FROM problem_report ORDER BY id DESC LIMIT 1') === 'other', 'an unknown kind is filed as other');
submit_report(null, ['email' => 'x@example.com', 'details' => 'A third report here.']);
ok(submit_report(null, ['email' => 'x@example.com', 'details' => 'A fourth report here.']) !== null, 'a fourth report in an hour waits');

// Security: redirects after sign-in stay on the site, and private addresses are never fetched.
foreach (['//evil.example', '/\\evil.example', '/\\/evil.example', 'https://evil.example', "/\t/evil.example", 'evil.example'] as $bad) ok(safe_next($bad) === '/', "next $bad stays on the site");
ok(safe_next('/m/x?y=1#t-summary') === '/m/x?y=1#t-summary', 'a real path is kept');
foreach (['http://127.0.0.1/', 'http://169.254.169.254/', 'http://10.0.0.3/', 'http://[::1]/', 'http://2130706433/', 'http://user@example.com/', 'ftp://example.com/'] as $bad) ok(!safe_url($bad), "$bad is refused");
ok(href('javascript:alert(1)') === '#' && href(' javascript:x') === '#' && href('https://a.ca/?a=1&b=2') === 'https://a.ca/?a=1&amp;b=2', 'only http(s) links are rendered');
for ($i = 0; $i < 3; $i++) too_many('t:x', 3, 60);
ok(too_many('t:x', 3, 60) && !too_many('t:y', 3, 60), 'rate limits count per key');
// Sites are shared only when both pages match, so no account's agent reads a page another account chose.
$s1 = find_site('https://council.example.ca/agendas', '', 'A');
ok(find_site('https://council.example.ca/agendas', '', 'B')['id'] === $s1['id'], 'the same pages share a site');
ok(find_site('https://council.example.ca/agendas', 'https://evil.example/videos', 'C')['id'] !== $s1['id'], 'another video page is another site');
// An email destination other than the account's own waits for its owner to confirm.
q("INSERT INTO user (email, status) VALUES ('owner@example.com', 'approved')");
$ownerId = (int)val("SELECT id FROM user WHERE email = 'owner@example.com'");
add_target($ownerId, ['kind' => 'email', 'address' => 'stranger@example.com']);
ok((int)default_target($ownerId)['confirmed'] === 1 && (int)val("SELECT confirmed FROM target WHERE address = 'stranger@example.com'") === 0, "only the account's own address skips confirming");
$stranger = fn() => row("SELECT * FROM target WHERE address = 'stranger@example.com'");
require_once __DIR__ . '/../src/notify.php';
ok(deliver($stranger(), 'Hi', 'News', '')[0] !== null && !str_contains($mail(), "To: stranger@example.com\nSubject: Hi"), 'an unconfirmed address is never sent a notification');
q("UPDATE target SET confirm_hash = ? WHERE address = 'stranger@example.com'", [hash('sha256', 'tok')]);
ok(confirm_target('nope') === null && confirm_target('tok') === 'stranger@example.com' && confirm_target('tok') === null, 'a confirmation link works once');
ok(deliver($stranger(), 'Hi', 'News', '')[0] === null && str_contains($mail(), 'Unsubscribe: http://localhost/unsubscribe?u=' . $stranger()['unsub_token']), "mail to someone else's address carries an unsubscribe link");
unsubscribe(unsubscribe_subject($stranger()['unsub_token']));
ok((int)$stranger()['confirmed'] === 0 && !send_target_confirmation((int)$stranger()['id']) && deliver($stranger(), 'Hi', 'News', '')[0] !== null, 'once it unsubscribes it gets nothing, not even another request');
ok(unsubscribe_subject((string)default_target($ownerId)['unsub_token']) === null, "the account's own address has no unsubscribe link to guess");
q('DELETE FROM user WHERE id = ?', [$ownerId]);
ok((int)val("SELECT count(*) FROM mail_block WHERE email = 'stranger@example.com'") === 0 && (int)val('SELECT count(*) FROM target WHERE user_id = ?', [$ownerId]) === 0, 'removing an account removes its destinations and unsubscribe records');
// Removing a monitor removes what hangs off it, so a later monitor that gets its id starts empty.
$gone = (int)val('SELECT id FROM monitor ORDER BY id DESC LIMIT 1');
q("INSERT INTO agenda (monitor_id, url, title) VALUES (?, 'https://x.ca/a.pdf', 'A')", [$gone]);
remove_monitor((int)val('SELECT user_id FROM monitor WHERE id = ?', [$gone]), $gone);
ok((int)val('SELECT count(*) FROM agent WHERE monitor_id = ?', [$gone]) === 0 && (int)val('SELECT count(*) FROM agenda WHERE monitor_id = ?', [$gone]) === 0
    && (int)val('SELECT count(*) FROM rule WHERE monitor_id = ?', [$gone]) === 0, "removing a monitor removes its agent, agendas and rules");
// Summaries get the monitor's pending items as background, each as it stood before the agenda.
$pm = (int)val('SELECT id FROM monitor ORDER BY id LIMIT 1');
q("INSERT INTO pending_history (monitor_id, item_key, title, status, detail, open, at) VALUES
   (?, 'b7104', 'Bylaw 7104', 'First and second reading', 'Rezoning 9040 8 Avenue', 1, '2026-11-08 20:00:00'),
   (?, 'b7104', 'Bylaw 7104', 'Third reading', 'Rezoning 9040 8 Avenue', 1, '2026-11-22 20:00:00'),
   (?, 'b7000', 'Bylaw 7000', 'Third reading', '', 1, '2026-11-01 20:00:00'),
   (?, 'b7000', 'Bylaw 7000', 'Adopted', '', 0, '2026-11-02 20:00:00')", [$pm, $pm, $pm, $pm]);
$bg = pending_background($pm, '2026-11-20 00:00:00');
ok(str_contains($bg, 'Bylaw 7104: First and second reading (Rezoning 9040 8 Avenue)') && !str_contains($bg, 'Third reading') && !str_contains($bg, 'Bylaw 7000'),
    'background shows each item as it stood before the agenda, and leaves out settled ones');
ok(str_contains(pending_background($pm), 'Bylaw 7104: Third reading'), 'without a time it shows where items stand now');

// The scan: a model's pick is only ever one of the page's own public links.
require_once __DIR__ . '/../src/scan.php';
$found = ['https://8.8.8.8/council' => 'Council', 'http://127.0.0.1/x' => 'Inside', 'https://www.youtube.com/@ExampleCity/streams' => 'Videos'];
ok(scan_link($found, 'L1') === 'https://8.8.8.8/council' && scan_link($found, 1) === 'https://8.8.8.8/council', 'a pick resolves to that link');
ok(scan_link($found, 2) === null && scan_link($found, 9) === null && scan_link($found, null) === null, 'private, missing and empty picks resolve to nothing');
ok(scan_youtube($found) === 'https://www.youtube.com/@ExampleCity', 'a YouTube channel link is found');

// The email layout: an event's subject becomes the label, heading and subtitle, with a button to the agenda.
$card = mail_card(['name' => '', 'logo' => ''], 'City of Example: New agenda, Regular Council Meeting', '', 'Hello <b>', 'https://example.com/a.pdf', '', 'Why', '');
ok(str_contains($card, '>New agenda<') && str_contains($card, '>City of Example</h1>') && str_contains($card, '>Regular Council Meeting<')
    && str_contains($card, 'Read the agenda') && str_contains($card, '>agenda</span>') && str_contains($card, 'Hello &lt;b&gt;'), 'the email uses the agenda.delivery layout, escaped');
// Pushover: a user key is 30 letters and numbers, and without a site app token the account has to give one.
ok(str_contains((string)check_pushover(1, 'short', ''), 'user key') && str_contains((string)check_pushover(1, str_repeat('a', 30), 'bad token!'), 'app token')
    && str_contains((string)check_pushover(1, str_repeat('a', 30), ''), 'app token'), 'a Pushover key and token are checked before Pushover is asked');

// Email colours: presets pass, a pale foreground or dark background is turned away, the default stores as nothing,
// and only a custom-branded list uses them; mail to the account's own address keeps the default.
[$harbour] = check_colours(['colour_fg' => '#1f4e79', 'colour_bg1' => '#eef3f8', 'colour_bg2' => '#d6e4f0']);
ok($harbour === '#1f4e79,#eef3f8,#d6e4f0' && check_colours(['colour_fg' => '#3d5e2b', 'colour_bg1' => '#f4f1e8', 'colour_bg2' => '#e9edc9'])[0] === '', 'colours are stored, the default as nothing');
ok(check_colours(['colour_fg' => '#ffee99', 'colour_bg1' => '#ffffff', 'colour_bg2' => '#ffffff'])[1] !== null
    && check_colours(['colour_fg' => '#000000', 'colour_bg1' => '#222222', 'colour_bg2' => '#ffffff'])[1] !== null
    && check_colours(['colour_fg' => 'red', 'colour_bg1' => '#ffffff', 'colour_bg2' => '#ffffff'])[1] !== null, 'unreadable or malformed colours are refused');
foreach (colour_presets() as [$pname, $pf, $pb1, $pb2]) ok(check_colours(['colour_fg' => $pf, 'colour_bg1' => $pb1, 'colour_bg2' => $pb2])[1] === null, "the $pname preset is readable");
$brander = ['org_name' => 'Org', 'logo' => '', 'mail_colours' => $harbour];
ok(branding(['kind' => 'email', 'brand' => 'agenda'], $brander)['colours'] === MAIL_COLOURS
    && branding(['kind' => 'list', 'brand' => 'account', 'sender_name' => '', 'logo' => '', 'mail_colours' => ''], $brander)['colours']['fg'] === '#1f4e79'
    && branding(['kind' => 'list', 'brand' => 'list', 'sender_name' => '', 'logo' => '', 'mail_colours' => '#5b3a6b,#f4eff6,#e5d8ec'], $brander)['colours']['fg'] === '#5b3a6b',
    'only custom-branded lists take colours, a list\'s own first');
$tinted = mail_card(['name' => 'Org', 'logo' => '', 'colours' => mail_colours($harbour)], 'S', '', 'See https://x.ca/a', '', '', 'Why', 'https://x.ca/u');
ok(str_contains($tinted, 'background:#eef3f8') && str_contains($tinted, 'background:#d6e4f0') && str_contains($tinted, 'color:#1f4e79'), 'the email takes the chosen colours');

// WhatsApp: a number is digits with its country code or nothing (your own chat), one link per account, and a link
// that's been off for ten minutes emails its owner once, until it's back.
if (whatsapp_available()) {
    q("INSERT INTO user (email, status) VALUES ('wa@example.com', 'approved')");
    $waUser = (int)val("SELECT id FROM user WHERE email = 'wa@example.com'");
    ok(add_target($waUser, ['kind' => 'whatsapp', 'address' => '+1 604 555 0123']) === null
        && val("SELECT address FROM target WHERE user_id = ? AND kind = 'whatsapp'", [$waUser]) === '', 'a WhatsApp destination starts with no one to send to');
    $wa = row("SELECT * FROM target WHERE user_id = ? AND kind = 'whatsapp'", [$waUser]);
    ok(wa_send($wa, 'S', 'T', '')[0] !== null && wa_send(['address' => '16045550123'] + $wa, 'S', 'T', '')[0] !== null, 'WhatsApp only sends to a chosen group, never a number');
    ok(update_target($wa, ['name' => 'WhatsApp', 'group' => '120363000000000000@g.us']) !== null
        && val('SELECT address FROM target WHERE id = ?', [$wa['id']]) === '', "a group has to be one of the linked account's own");
    ok(add_target($waUser, ['kind' => 'whatsapp', 'address' => '']) !== null, 'one WhatsApp per account');
    q("UPDATE target SET wa_linked = 1, wa_state = 'closed', wa_since = datetime('now', '-11 minutes') WHERE user_id = ? AND kind = 'whatsapp'", [$waUser]);
    ok(whatsapp_alerts() === 1 && whatsapp_alerts() === 0, 'a dropped link emails its owner once');
    q("UPDATE target SET wa_state = 'open' WHERE user_id = ? AND kind = 'whatsapp'", [$waUser]);
    whatsapp_alerts();
    ok((int)val("SELECT wa_alerted FROM target WHERE user_id = ? AND kind = 'whatsapp'", [$waUser]) === 0, 'once it is back, the next drop is told again');
}

// Summary history: each summary is kept with its instructions, newest first, and templates set no word count.
require_once __DIR__ . '/../src/summary.php';
record_summary((int)$m['id'], 'agenda', 9001, 'First way', 'One');
record_summary((int)$m['id'], 'agenda', 9001, '', 'Two');
$hist = summary_history((int)$m['id'])['agenda:9001'] ?? [];
ok(count($hist) === 2 && $hist[0]['text'] === 'Two' && $hist[1]['prompt'] === 'First way', 'summaries are kept newest first with their instructions');
ok($hist[0]['prompt'] === default_summary_prompt(), 'a blank prompt is kept as the default it was written with');
ok(!preg_grep('/\bwords\b/i', array_column(summary_templates(), 'prompt')), 'no template sets a word count');

echo "ok, $n checks\n";
@array_map("unlink", array_merge(glob("$tmp/media/*"), glob("$tmp/*")));
@rmdir("$tmp/media");
@rmdir($tmp);
