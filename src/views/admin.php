<?php $title = 'Admin'; $fmt = fn($n) => number_format((int)$n);
$waiting = count(array_filter($requests, fn($r) => $r['status'] === 'pending'));
$open = count(array_filter($reports, fn($r) => !$r['resolved_at'])); ?>
<h1><?= icon('screwdriver-wrench') ?> Admin</h1>
<p class="text-muted mb-1">
  <?= $fmt($counts['users']) ?> users · <?= $fmt($counts['monitors']) ?> monitors (<?= $fmt($counts['running']) ?> agents enabled)
  · <?= $fmt($counts['rules']) ?> notifications · <?= $fmt($counts['unsent']) ?> events waiting to send
</p>
<p class="small mb-0">
  <?php if ($service): ?>
    <span class="state state-enabled"></span>agenda delivery service up <?= h(ago(gmdate('Y-m-d H:i:s', time() - (int)$service['uptime']))) ?>
    · <?= (int)$service['gateways'] ?> gateways running, <?= (int)$service['healthy'] ?> healthy
    · <?= (int)$service['runs_running'] ?> runs running, <?= (int)$service['runs_queued'] ?> queued
    · <?= (int)$service['jobs_running'] ?> jobs running, <?= (int)$service['browser_slots_free'] ?> browsers free
  <?php else: ?>
    <span class="state state-error"></span><strong>The agenda delivery service isn't answering.</strong> Agents won't run until it's back: <code>systemctl status agenda-delivery</code>
  <?php endif ?>
</p>

<div class="nav nav-tabs mt-3" role="tablist">
  <button class="nav-link active" data-tab="#a-agents" role="tab"><?= icon('robot') ?> Agents</button>
  <button class="nav-link" data-tab="#a-sites" role="tab"><?= icon('sitemap') ?> Sites</button>
  <button class="nav-link" data-tab="#a-runs" role="tab"><?= icon('play') ?> Runs</button>
  <button class="nav-link" data-tab="#a-jobs" role="tab"><?= icon('list-check') ?> Jobs</button>
  <button class="nav-link" data-tab="#a-usage" role="tab"><?= icon('chart-column') ?> AI usage</button>
  <button class="nav-link" data-tab="#a-signups" role="tab"><?= icon('user-plus') ?> Sign-ups<?= $waiting ? ' <span class="badge">' . $waiting . '</span>' : '' ?></button>
  <button class="nav-link" data-tab="#a-reports" role="tab"><?= icon('flag') ?> Reports<?= $open ? ' <span class="badge">' . $open . '</span>' : '' ?></button>
  <button class="nav-link" data-tab="#a-users" role="tab"><?= icon('users') ?> Users</button>
  <button class="nav-link" data-tab="#a-fail" role="tab"><?= icon('triangle-exclamation') ?> Failed deliveries</button>
</div>

<div class="mt-3">
  <div class="tab-pane active" id="a-agents">
    <div class="table-responsive"><table class="table table-sm table-hover small">
      <thead><tr><th>Monitor</th><th>Owner / site / state</th><th>Gateway</th><th>State (want / have)</th><th>Last run</th><th>Next</th><th>Agents on site</th><th>Agendas / videos / pending</th><th>Tokens 30d</th><th>Checked</th></tr></thead>
      <tbody>
      <?php foreach ($monitors as $m): ?>
        <tr>
          <td><?= h($m['name']) ?> <span class="text-muted">(<?= h($m['slug']) ?>)</span><br><a class="text-muted" href="/admin/log/<?= h($m['slug']) ?>"><?= icon('scroll') ?> log</a></td>
          <td><?= h($m['owner']) ?><br><span class="text-muted">site <?= (int)$m['site_id'] ?> · <?= h($m['state']) ?></span></td>
          <td><?php if ($m['pid']): ?>
                port <?= (int)$m['port'] ?> · pid <?= (int)$m['pid'] ?> · <?= h(kb($m['rss_kb'] === null ? null : (int)$m['rss_kb'])) ?><br>
                <span class="text-muted">up since <?= h(ago($m['started_at'])) ?><?= (int)$m['restarts'] ? ' · ' . (int)$m['restarts'] . ' restarts' : '' ?></span>
              <?php else: ?><span class="text-muted">not running</span><?php endif ?>
              <br><span class="text-muted"><?= h($m['home']) ?></span></td>
          <td><?= h($m['desired_state']) ?> / <span class="state state-<?= h($m['actual_state']) ?>"></span><?= h($m['actual_state']) ?>
            <?php if ($m['last_error']): ?><br><span class="text-danger"><?= h($m['last_error']) ?></span><?php endif ?></td>
          <td><?= $m['last_run_start'] && $m['last_run_start'] > (string)$m['last_run_end']
                ? icon('spinner') . ' <strong>running</strong>, started ' . h(ago($m['last_run_start'])) : h(ago($m['last_run_end'])) ?></td>
          <td><?= h($m['next_run'] ? ago($m['next_run']) : '') ?></td>
          <td><?= (int)$m['followers'] ?></td>
          <td><?= (int)$m['agendas'] ?> / <?= (int)$m['videos'] ?> / <?= (int)$m['pending'] ?></td>
          <td><?= $fmt($m['tokens30']) ?></td>
          <td><?= h(ago($m['checked_at'])) ?></td>
        </tr>
      <?php endforeach ?>
      </tbody>
    </table></div>
  </div>

  <div class="tab-pane" id="a-sites">
    <p class="small text-muted">A site is one organization's agenda page. Every account watching it has its own agent, and they share the site's notes, meeting types and member names, so they learn and repair it once.</p>
    <div class="table-responsive"><table class="table table-sm small">
      <thead><tr><th>#</th><th>Site</th><th>Agents</th><th>Setup</th><th>Health</th><th>Meeting types</th><th>Last fixed</th></tr></thead>
      <tbody>
      <?php if (!$sites): ?><tr><td colspan="7" class="text-muted">No sites yet.</td></tr><?php endif ?>
      <?php foreach ($sites as $s): ?>
        <tr><td><?= (int)$s['id'] ?></td>
          <td><?= h($s['name']) ?><br><span class="text-muted text-truncate d-block" style="max-width:18rem"><?= h($s['agenda_url']) ?></span></td>
          <td><?= (int)$s['watchers'] ?></td>
          <td><?= h($s['setup_state']) ?><?= $s['setup_by'] ? '<br><span class="text-muted">by ' . h($s['setup_by']) . '</span>' : '' ?></td>
          <td><span class="state state-<?= $s['health'] === 'ok' ? 'enabled' : 'error' ?>"></span><?= h($s['health']) ?>
            <?php if ($s['health'] !== 'ok'): ?><br><span class="text-muted"><?= $s['repair_by'] ? 'by ' . h($s['repair_by']) . ': ' : 'unclaimed: ' ?><?= h($s['repair_note']) ?></span><?php endif ?></td>
          <td><?= h(implode(', ', array_map(fn($t) => $t['name'] . (!empty($t['default']) ? ' *' : ''), json_decode($s['meeting_types'], true) ?: []))) ?></td>
          <td><?= h($s['fixed_at'] ? ago($s['fixed_at']) : '') ?></td></tr>
      <?php endforeach ?>
      </tbody>
    </table></div>
  </div>

  <div class="tab-pane" id="a-runs">
    <div class="table-responsive"><table class="table table-sm small">
      <thead><tr><th>#</th><th>Monitor</th><th>Why</th><th>State</th><th>Queued</th><th>Took</th><th>Agent's last words, or the error</th></tr></thead>
      <tbody>
      <?php if (!$runs): ?><tr><td colspan="7" class="text-muted">No runs yet.</td></tr><?php endif ?>
      <?php foreach ($runs as $r): ?>
        <tr><td><?= (int)$r['id'] ?></td><td><?= h($r['name']) ?></td><td><?= h($r['trigger']) ?></td><td><?= h($r['state']) ?></td>
          <td><?= h(ago($r['queued_at'])) ?></td>
          <td><?= ($r['started_at'] && $r['ended_at']) ? (strtotime($r['ended_at']) - strtotime($r['started_at'])) . 's' : '' ?></td>
          <td class="text-truncate" style="max-width:28rem" title="<?= h($r['error'] ?: $r['reply']) ?>"><?= h(mb_substr($r['error'] ?: trim(preg_replace('/\s+/', ' ', $r['reply'])), -160)) ?></td></tr>
      <?php endforeach ?>
      </tbody>
    </table></div>
  </div>

  <div class="tab-pane" id="a-jobs">
    <p class="small text-muted">Executables the service runs for agents: Chrome (<?= (int)cfg('browser_slots') ?> at once), pdftotext and yt-dlp. Waiting and running jobs plus the last day.</p>
    <div class="table-responsive"><table class="table table-sm small">
      <thead><tr><th>#</th><th>Monitor</th><th>Tool</th><th>Target</th><th>State</th><th>Slot</th><th>Queued</th><th>Took</th><th>Error</th></tr></thead>
      <tbody>
      <?php if (!$jobs): ?><tr><td colspan="9" class="text-muted">No jobs in the last day.</td></tr><?php endif ?>
      <?php foreach ($jobs as $j): ?>
        <tr><td><?= (int)$j['id'] ?></td><td><?= h($j['name']) ?></td><td><?= h($j['tool']) ?></td>
          <td class="text-truncate" style="max-width:20rem"><?= h($j['target']) ?></td><td><?= h($j['state']) ?></td>
          <td><?= h((string)$j['slot']) ?></td><td><?= h(ago($j['queued_at'])) ?></td>
          <td><?= ($j['started_at'] && $j['ended_at']) ? (strtotime($j['ended_at']) - strtotime($j['started_at'])) . 's' : '' ?></td><td><?= h($j['error']) ?></td></tr>
      <?php endforeach ?>
      </tbody>
    </table></div>
  </div>

  <div class="tab-pane" id="a-usage">
    <p>Last 30 days: <?= $fmt($usage_total['calls']) ?> calls, <?= $fmt($usage_total['prompt']) ?> prompt tokens, <?= $fmt($usage_total['completion']) ?> completion tokens.</p>
    <div class="table-responsive"><table class="table table-sm small">
      <thead><tr><th>Day</th><th>Source</th><th>Calls</th><th>Prompt</th><th>Completion</th></tr></thead>
      <tbody>
      <?php foreach ($usage_days as $d): ?>
        <tr><td><?= h($d['day']) ?></td><td><?= h($d['source']) ?></td><td><?= $fmt($d['calls']) ?></td><td><?= $fmt($d['prompt']) ?></td><td><?= $fmt($d['completion']) ?></td></tr>
      <?php endforeach ?>
      </tbody>
    </table></div>
  </div>

  <div class="tab-pane" id="a-signups">
    <p class="small text-muted">New accounts sign in first, then join with a code or send this request. Approving one emails them.</p>
    <div class="nodes">
      <?php if (!$requests): ?><div class="node-empty">No requests yet.</div><?php endif ?>
      <?php foreach ($requests as $r): ?>
        <div class="node <?= $r['status'] === 'pending' ? '' : 'is-quiet' ?>" style="--c:var(--o-yellow)">
          <div class="node-main">
            <div class="node-title"><?= h($r['name']) ?><?= $r['organization'] !== '' ? ', ' . h($r['organization']) : '' ?></div>
            <div class="node-meta"><?= h($r['email']) ?> · <?= h($r['community']) ?> · asked <?= h(ago($r['created_at'])) ?> · <strong><?= h($r['status']) ?></strong></div>
            <p class="small mb-1 mt-2"><strong>Who they are:</strong> <?= nl2br(h($r['about'])) ?></p>
            <p class="small mb-0"><strong>What they'll use it for:</strong> <?= nl2br(h($r['use_for'])) ?></p>
          </div>
          <?php if ($r['status'] === 'pending'): ?>
          <div class="node-actions">
            <form method="post" action="/admin/signups"><?= csrf_field() ?><input type="hidden" name="user_id" value="<?= (int)$r['user_id'] ?>"><button class="btn btn-sm btn-primary" name="do" value="approve"><?= icon('check') ?> Approve</button></form>
            <form method="post" action="/admin/signups"><?= csrf_field() ?><input type="hidden" name="user_id" value="<?= (int)$r['user_id'] ?>"><button class="btn btn-sm" name="do" value="decline"><?= icon('xmark') ?> Decline</button></form>
          </div>
          <?php endif ?>
        </div>
      <?php endforeach ?>
    </div>

    <h2 class="section-title mt-4"><span class="chip" style="--c:var(--o-mint)"><?= icon('key') ?></span> Sign-up codes</h2>
    <div class="nodes">
      <?php if (!$codes): ?><div class="node-empty">No codes yet.</div><?php endif ?>
      <?php foreach ($codes as $c): ?>
        <div class="node" style="--c:var(--o-mint)">
          <div class="node-main">
            <div class="node-title"><code><?= h($c['code']) ?></code></div>
            <div class="node-meta"><?= $c['note'] !== '' ? h($c['note']) . ' · ' : '' ?>used <?= (int)$c['used'] ?> times · <?= $c['uses_left'] === null ? 'no limit' : (int)$c['uses_left'] . ' uses left' ?></div>
          </div>
          <div class="node-actions">
            <form method="post" action="/admin/signups"><?= csrf_field() ?><input type="hidden" name="code" value="<?= h($c['code']) ?>"><button class="btn btn-sm" name="do" value="remove-code"><?= icon('trash') ?> Remove</button></form>
          </div>
        </div>
      <?php endforeach ?>
    </div>
    <form method="post" action="/admin/signups" class="node-add" style="--accent:var(--o-mint)">
      <?= csrf_field() ?>
      <h3><span class="chip"><?= icon('plus') ?></span>Add a code</h3>
      <div class="row align-items-end">
        <div class="col-12 col-md"><label class="label" for="code">Code <span class="text-muted">(blank makes a random one)</span></label><input class="input" id="code" name="code" maxlength="40" pattern="[A-Za-z0-9-]*"></div>
        <div class="col-12 col-md"><label class="label" for="note">Who it's for</label><input class="input" id="note" name="note" maxlength="200" placeholder="Strong Towns Langley members"></div>
        <div class="col-6 col-md-2"><label class="label" for="uses">Uses</label><input class="input" id="uses" name="uses" type="number" min="0" placeholder="no limit"></div>
        <div class="col-6 col-md-auto"><button class="btn btn-primary" name="do" value="add-code"><?= icon('plus') ?> Add</button></div>
      </div>
    </form>
  </div>

  <div class="tab-pane" id="a-reports">
    <p class="small text-muted">Problems people sent from the Report a problem page. Reply by email, then mark them done.</p>
    <div class="nodes">
      <?php if (!$reports): ?><div class="node-empty">No reports yet.</div><?php endif ?>
      <?php foreach ($reports as $r): ?>
        <div class="node <?= $r['resolved_at'] ? 'is-quiet' : '' ?>" style="--c:var(--o-accent-main)">
          <div class="node-main">
            <div class="node-title"><?= h(report_kinds()[$r['kind']] ?? $r['kind']) ?></div>
            <div class="node-meta"><a href="mailto:<?= h($r['email']) ?>"><?= h($r['email']) ?></a><?= $r['user_id'] ? '' : ' · not signed in' ?> · <?= h(ago($r['created_at'])) ?><?= $r['resolved_at'] ? ' · done ' . h(ago($r['resolved_at'])) : '' ?></div>
            <p class="small mb-0 mt-2"><?= nl2br(h($r['details'])) ?></p>
          </div>
          <div class="node-actions">
            <form method="post" action="/admin/reports"><?= csrf_field() ?><input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
              <button class="btn btn-sm"><?= $r['resolved_at'] ? icon('rotate-left') . ' Reopen' : icon('check') . ' Done' ?></button></form>
          </div>
        </div>
      <?php endforeach ?>
    </div>
  </div>

  <div class="tab-pane" id="a-users">
    <div class="table-responsive"><table class="table table-sm small">
      <thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Joined</th><th>Last seen</th><th>Monitors</th><th>Notifications</th></tr></thead>
      <tbody>
      <?php foreach ($users as $u): ?>
        <tr><td><?= h($u['email']) ?></td><td><?= h($u['name']) ?></td><td><?= is_admin($u) ? 'admin' : ($u['status'] === 'new' ? 'sign-in only, uncompleted join' : h($u['status'])) ?><?= $u['signup_code'] ? ' <span class="text-muted">(' . h($u['signup_code']) . ')</span>' : '' ?></td><td><?= h(substr($u['created_at'], 0, 10)) ?></td><td><?= h(ago($u['last_seen'])) ?></td><td><?= (int)$u['follows'] ?></td><td><?= (int)$u['rules'] ?></td></tr>
      <?php endforeach ?>
      </tbody>
    </table></div>
  </div>

  <div class="tab-pane" id="a-fail">
    <div class="table-responsive"><table class="table table-sm small">
      <thead><tr><th>When</th><th>Monitor</th><th>Event</th><th>Destination</th><th>Error</th></tr></thead>
      <tbody>
      <?php if (!$failures): ?><tr><td colspan="5" class="text-muted">No failed deliveries.</td></tr><?php endif ?>
      <?php foreach ($failures as $f): ?>
        <tr><td><?= h(ago($f['sent_at'])) ?></td><td><?= h($f['monitor']) ?></td><td><?= h($f['title']) ?></td><td><?= h($f['target']) ?> (<?= h($f['kind']) ?>)</td><td><?= h($f['error']) ?></td></tr>
      <?php endforeach ?>
      </tbody>
    </table></div>
  </div>
</div>
