<?php
declare(strict_types=1);

function admin_data(): array
{
    return [
        'service' => service('GET', '/health', null, 3),
        'users' => rows('SELECT u.id, u.email, u.name, u.status, u.signup_code, u.created_at, u.last_seen,
            (SELECT count(*) FROM monitor mo WHERE mo.user_id = u.id) AS follows,
            (SELECT count(*) FROM rule r WHERE r.user_id = u.id) AS rules
            FROM user u ORDER BY u.created_at DESC LIMIT 200'),
        'monitors' => rows("SELECT m.name, m.slug, m.kind, m.state, m.site_id, u.email AS owner, a.unit, a.home, a.desired_state, a.actual_state, a.last_run_start, a.last_run_end,
            a.last_exit, a.next_run, a.last_error, a.checked_at, a.port, a.pid, a.rss_kb, a.restarts, a.started_at,
            (SELECT count(*) FROM monitor p WHERE p.site_id = m.site_id) AS followers,
            (SELECT count(*) FROM agenda g WHERE g.monitor_id = m.id) AS agendas,
            (SELECT count(*) FROM video v WHERE v.monitor_id = m.id) AS videos,
            (SELECT count(*) FROM pending_item p WHERE p.monitor_id = m.id AND p.open = 1) AS pending,
            (SELECT coalesce(sum(prompt_tokens + completion_tokens), 0) FROM ai_usage u WHERE u.monitor_id = m.id AND u.at > datetime('now', '-30 days')) AS tokens30
            FROM monitor m JOIN user u ON u.id = m.user_id LEFT JOIN agent a ON a.monitor_id = m.id ORDER BY m.site_id, m.name"),
        'sites' => rows("SELECT s.*, (SELECT count(*) FROM monitor m WHERE m.site_id = s.id) AS watchers,
            (SELECT slug FROM monitor m WHERE m.id = s.setup_monitor) AS setup_by,
            (SELECT slug FROM monitor m WHERE m.id = s.repair_monitor) AS repair_by
            FROM site s ORDER BY s.name"),
        'runs' => rows("SELECT r.*, m.name, m.slug FROM agent_run r JOIN monitor m ON m.id = r.monitor_id ORDER BY r.id DESC LIMIT 50"),
        'usage_days' => rows("SELECT date(at) AS day, source, count(*) AS calls, sum(prompt_tokens) AS prompt, sum(completion_tokens) AS completion
            FROM ai_usage WHERE at > datetime('now', '-30 days') GROUP BY day, source ORDER BY day DESC, source"),
        'usage_total' => row("SELECT count(*) AS calls, coalesce(sum(prompt_tokens), 0) AS prompt, coalesce(sum(completion_tokens), 0) AS completion
            FROM ai_usage WHERE at > datetime('now', '-30 days')"),
        'jobs' => rows("SELECT j.*, m.name FROM job j LEFT JOIN monitor m ON m.id = j.monitor_id
            WHERE j.state IN ('queued', 'running') OR j.queued_at > datetime('now', '-1 day') ORDER BY j.id DESC LIMIT 100"),
        'failures' => rows("SELECT d.sent_at, d.error, e.title, m.name AS monitor, t.kind, t.name AS target
            FROM delivery d JOIN event e ON e.id = d.event_id JOIN monitor m ON m.id = e.monitor_id
            JOIN rule r ON r.id = d.rule_id JOIN target t ON t.id = r.target_id
            WHERE d.ok = 0 ORDER BY d.sent_at DESC LIMIT 30"),
        'requests' => rows("SELECT j.*, u.email, u.status FROM join_request j JOIN user u ON u.id = j.user_id
            ORDER BY j.decided_at IS NOT NULL, j.created_at DESC LIMIT 100"),
        'reports' => rows('SELECT * FROM problem_report ORDER BY resolved_at IS NOT NULL, id DESC LIMIT 100'),
        'codes' => rows('SELECT * FROM signup_code ORDER BY created_at DESC'),
        'counts' => row("SELECT (SELECT count(*) FROM user) AS users, (SELECT count(*) FROM monitor) AS monitors,
            (SELECT count(*) FROM agent WHERE actual_state = 'enabled') AS running, (SELECT count(*) FROM rule) AS rules,
            (SELECT count(*) FROM event WHERE sent_at IS NULL) AS unsent"),
    ];
}

function kb(?int $kb): string
{
    if (!$kb) return '';
    return $kb >= 1024 ? round($kb / 1024, 1) . ' MB' : $kb . ' kB';
}
