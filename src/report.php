<?php
// Problem reports from /report: anyone can send one, signed in or not, and admins see them in the admin panel.
declare(strict_types=1);

function report_kinds(): array
{
    return [
        'signup'  => "My account wasn't approved, and I think that's unfair",
        'prompt'  => 'My summary instructions were refused, and I think they should be allowed',
        'summary' => 'A summary got something wrong',
        'bug'     => "Something isn't working",
        'other'   => 'Something else',
    ];
}

// Returns null when the report is in, or what's wrong with it.
function submit_report(?array $u, array $in): ?string
{
    $email = $u ? $u['email'] : strtolower(trim((string)($in['email'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return 'Add an email address, so we can reply.';
    $kind = array_key_exists($in['kind'] ?? '', report_kinds()) ? $in['kind'] : 'other';
    $details = trim(mb_substr((string)($in['details'] ?? ''), 0, 4000));
    if (mb_strlen($details) < 10) return 'Tell us what happened.';
    // A field people never see; anything in it came from a bot.
    if (!empty($in['website'])) return null;
    if (too_many('report:' . client_ip(), 3, 3600)) return "You've sent a few reports already. Wait an hour and try again.";
    q('INSERT INTO problem_report (user_id, email, kind, details) VALUES (?, ?, ?, ?)', [$u['id'] ?? null, $email, $kind, $details]);
    foreach ((array)cfg('admin_emails') as $admin) {
        send_mail($admin, 'agenda.delivery problem report: ' . report_kinds()[$kind],
            "From $email" . ($u ? '' : ' (not signed in)') . "\n\n$details\n\nSee it at " . cfg('base_url') . '/admin#a-reports');
    }
    return null;
}
