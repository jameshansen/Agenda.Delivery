<?php
// Housekeeping the agenda delivery service runs every minute and after each agent run:
// import each agent's token log into ai_usage, send waiting notifications and any digests that are due, and
// clear out logo files nothing uses any more.
declare(strict_types=1);
require __DIR__ . '/../src/app.php';
require __DIR__ . '/../src/notify.php';

foreach (rows('SELECT a.home, m.id AS mid FROM agent a JOIN monitor m ON m.id = a.monitor_id') as $a) {
    import_ledger((int)$a['mid'], $a['home']);
}
$sent = drain_events() + send_digests();
require_once __DIR__ . '/../src/summary.php';
run_summary_jobs();
if ($sent) echo "sent $sent notifications\n";
sweep_media();
whatsapp_alerts();

// With cost tracking on, NullClaw appends one line per model call to workspace/state/costs.jsonl:
// {"model", "input_tokens", "output_tokens", "cost_usd", "timestamp", "session"}. Each line is imported once.
// ponytail: rereads the whole file every minute; keep a byte offset per agent if these files grow large
function import_ledger(int $mid, string $home): void
{
    $file = "$home/.nullclaw/workspace/state/costs.jsonl";
    if (!is_file($file)) return;
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $j = json_decode($line, true);
        if (!is_array($j) || (empty($j['input_tokens']) && empty($j['output_tokens']))) continue;
        $at = is_numeric($j['timestamp'] ?? null) ? gmdate('Y-m-d H:i:s', (int)$j['timestamp']) : null;
        q("INSERT OR IGNORE INTO ai_usage (monitor_id, source, model, prompt_tokens, completion_tokens, at, ledger_key)
           VALUES (?, 'agent', ?, ?, ?, coalesce(?, datetime('now')), ?)",
            [$mid, (string)($j['model'] ?? cfg('model')), (int)($j['input_tokens'] ?? 0), (int)($j['output_tokens'] ?? 0), $at, sha1($mid . $line)]);
    }
}
