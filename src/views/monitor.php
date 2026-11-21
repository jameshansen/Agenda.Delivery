<?php
$title = $m['name'];
$panel = 'monitors';
$state = $agent['actual_state'] ?? 'pending';
$typeName = fn($k) => $types[$k]['name'] ?? $k;
$draft = $draft ?? $m['summary_prompt'];
$preview = $preview ?? null;
$runActive = $run && in_array($run['state'], ['queued', 'running'], true);
// The monitor's address without its leading /m/, e.g. 3/township-of-langley, which the forms below post under.
$slug = h(substr(monitor_url($m), 3));

// The summary designer: templates to start from, the prompt, and a preview on a real agenda.
$designer = function (bool $starting) use ($draft, $preview, $slug) {
    ob_start(); ?>
    <div class="vstack g-3">
      <div><span class="label"><?= icon('wand-magic-sparkles') ?> Start from a template</span>
        <div class="hstack" style="flex-wrap:wrap">
          <?php foreach (summary_templates() as $key => $t): ?>
            <button type="button" class="btn btn-sm" data-template="<?= h($t['prompt']) ?>"><?= h($t['name']) ?></button>
          <?php endforeach ?>
        </div></div>
      <div><label class="label" for="summary_prompt"><?= icon('pen-nib') ?> How summaries are written</label>
        <textarea class="input" id="summary_prompt" name="summary_prompt" rows="6" maxlength="4000" required><?= h($draft) ?></textarea>
        <p class="form-text mb-0">Write it like instructions to a helper: who's writing, the voice, how long, what to focus on and how to sign off. Summaries only ever use facts from the meeting material.</p></div>
      <?php if ($preview && !empty($preview['refused'])): ?>
        <div class="node is-error" style="display:block">
          <div class="node-title"><?= icon('ban') ?>Not saved</div>
          <p class="mb-0 mt-1"><?= h($preview['error']) ?></p>
          <p class="small mb-0 mt-2">Think these instructions should be allowed? <a href="/report?about=prompt">Report a problem</a>.</p>
        </div>
      <?php elseif ($preview): ?>
        <div class="node" style="--c:var(--o-blue);display:block">
          <div class="node-title"><?= icon('eye') ?>Preview<?= $preview['title'] ? ': ' . h($preview['title']) : '' ?></div>
          <?php if (!empty($preview['error'])): ?>
            <p class="text-muted mb-0"><?= h($preview['error']) ?></p>
          <?php else: ?>
            <div class="summary mt-2"><?= h($preview['text']) ?></div>
          <?php endif ?>
        </div>
      <?php endif ?>
      <div class="hstack" style="flex-wrap:wrap">
        <button class="btn" formaction="/m/<?= $slug ?>/preview" formnovalidate data-busy="Writing a preview, this takes a few seconds"><?= icon('eye') ?> Preview on the latest agenda</button>
        <?php if ($starting): ?>
          <button class="btn btn-primary" formaction="/m/<?= $slug ?>/start" data-busy="Checking the instructions and starting"><?= icon('play') ?> Start monitoring</button>
        <?php else: ?>
          <button class="btn btn-primary" formaction="/m/<?= $slug ?>/summary" data-busy="Checking the instructions"><?= icon('check') ?> Save</button>
        <?php endif ?>
      </div>
    </div>
    <?php return ob_get_clean();
};

// An agenda or video's summaries, newest first. Every version is on the page; the bar's buttons swap which one shows.
$history = $history ?? [];
$versionsOf = fn(string $kind, array $item) => $history["$kind:{$item['id']}"]
    ?? ($item['summary'] !== '' ? [['text' => $item['summary'], 'prompt' => null, 'created_at' => '']] : []);
$summaryBlock = function (string $kind, array $item) use ($versionsOf) {
    $versions = $versionsOf($kind, $item);
    ob_start(); ?>
    <?php if (!$versions): ?><div class="summary">No summary yet.</div><?php endif ?>
    <?php foreach ($versions as $i => $s): ?>
      <div data-version="<?= $i ?>" <?= $i ? 'hidden' : '' ?>>
        <?php if ($i): ?><p class="summary-older"><?= icon('clock-rotate-left') ?> An earlier version, from <?= h(ago($s['created_at'])) ?>. The latest is the one that's sent.</p><?php endif ?>
        <div class="summary"><?= h($s['text']) ?></div>
        <div class="summary-prompt">
          <div class="label"><?= icon('pen-nib') ?> Instructions used</div>
          <div class="summary"><?= $s['prompt'] !== null ? h($s['prompt']) : 'Written before instructions were kept.' ?></div>
        </div>
      </div>
    <?php endforeach ?>
    <?php return ob_get_clean();
};
// Under the summary: its versions, the instructions behind the one showing, Rebuild and a way to the instructions.
$summaryBar = function (string $kind, array $item) use ($versionsOf, $slug) {
    $versions = $versionsOf($kind, $item);
    ob_start(); ?>
    <div class="summary-bar">
      <?php if (count($versions) > 1): ?>
        <div class="summary-versions" role="group" aria-label="Versions of this summary">
          <?php foreach ($versions as $i => $s): ?>
            <button type="button" class="btn btn-sm" data-show-version="<?= $i ?>" aria-pressed="<?= $i ? 'false' : 'true' ?>" title="<?= h(substr($s['created_at'], 0, 16)) ?> UTC">v<?= count($versions) - $i ?> · <?= $i ? h(ago($s['created_at'])) : 'latest' ?></button>
          <?php endforeach ?>
        </div>
      <?php endif ?>
      <div class="summary-actions">
        <?php if ($versions): ?>
          <button type="button" class="btn btn-sm btn-ghost" data-toggle-prompt aria-pressed="false"><?= icon('eye') ?> Instructions used</button>
        <?php endif ?>
        <form method="post" action="/m/<?= $slug ?>/rebuild/<?= (int)$item['id'] ?>/<?= $kind ?>">
          <?= csrf_field() ?>
          <button class="btn btn-sm" title="Write a new version with the current instructions" data-busy="Rebuilding"><?= icon('rotate') ?> Rebuild</button>
        </form>
        <button type="button" class="btn btn-sm" data-goto-tab="#t-summary"><?= icon('pen-nib') ?> Edit instructions</button>
      </div>
    </div>
    <?php return ob_get_clean();
};
$opened = (string)($_GET['open'] ?? '');

// Checkboxes for the site's meeting types; $checked is what's ticked.
$typeBoxes = function (array $checked) use ($types) {
    ob_start(); ?>
    <div class="options">
      <?php foreach ($types as $key => $t): ?>
        <label class="option"><input type="checkbox" name="types[]" value="<?= h($key) ?>" <?= in_array($key, $checked, true) ? 'checked' : '' ?>> <?= h($t['name']) ?></label>
      <?php endforeach ?>
    </div>
    <?php return ob_get_clean();
};
?>
<ol class="breadcrumb"><li><a href="/">Your monitors</a></li><li><?= h($m['name']) ?></li></ol>

<div class="d-flex justify-between align-center" style="flex-wrap:wrap;gap:1rem">
  <div>
    <h2 class="mb-1"><?= h($m['name']) ?> <span class="badge ms-2"><?= h(monitor_kinds()[$m['kind']] ?? $m['kind']) ?></span></h2>
    <p class="text-muted small mb-0">
      <?php if ($m['state'] === 'ready'): ?>
        <span class="state state-<?= h($state) ?>"></span><?= h(ucfirst($state)) ?>
        <?php if (!empty($agent['last_run_start']) && $agent['last_run_start'] > (string)$agent['last_run_end']): ?>
          · <strong>checking now</strong>
        <?php else: ?>
          · last checked <?= h(ago($agent['last_run_end'] ?? null)) ?>
        <?php endif ?>
        <?php if (!empty($agent['next_run'])): ?>· next check <?= h(ago($agent['next_run'])) ?><?php endif ?>
      <?php else: ?>
        <?php if ($m['state'] === 'setup' && $m['setup_state'] !== 'failed'): ?><?= icon('spinner') ?> Setting up
        <?php else: ?><span class="state state-pending"></span><?= $m['state'] === 'setup' ? 'Setup needs another try' : 'Choosing meetings' ?><?php endif ?>
      <?php endif ?>
      <?php if ($peers): ?>· <?= icon('users') ?><?= $peers ?> other <?= $peers === 1 ? 'account watches' : 'accounts watch' ?> this site<?php endif ?>
      · <a href="<?= href($m['agenda_url']) ?>" rel="noopener" target="_blank">agenda page</a>
    </p>
  </div>
  <div class="hstack">
    <?php if ($m['state'] === 'ready'): ?>
      <form method="post" action="/m/<?= $slug ?>/run"><?= csrf_field() ?><button class="btn" <?= !empty($agent['run_requested']) || $runActive ? 'disabled' : '' ?>><?= icon('rotate', 'solid', !empty($agent['run_requested']) || $runActive) ?> <?= !empty($agent['run_requested']) || $runActive ? 'Check queued' : 'Check now' ?></button></form>
    <?php endif ?>
    <form method="post" action="/m/<?= $slug ?>/remove" onsubmit="return confirm('Remove <?= h(addslashes($m['name'])) ?>? Its agent, agendas, summaries and notifications are deleted.')"><?= csrf_field() ?><button class="btn btn-ghost"><?= icon('trash-can') ?> Remove</button></form>
  </div>
</div>

<?php if ($m['health'] === 'repairing'): ?>
  <div class="alert alert-info mt-3"><?= icon('screwdriver-wrench') ?> The site has changed and an agent is updating its notes for everyone watching it. Checks pause until it's done.</div>
<?php elseif ($m['state'] === 'ready' && $state === 'error' && !empty($agent['last_error'])): ?>
  <div class="alert alert-warning mt-3">The agent's last run had trouble: <?= h($agent['last_error']) ?></div>
<?php endif ?>

<?php if ($m['state'] === 'setup'): ?>
  <div class="node-add mt-4">
    <?php if ($m['setup_state'] === 'failed'): ?>
      <h3><span class="chip" style="--c:var(--o-red)"><?= icon('triangle-exclamation') ?></span>Setup didn't finish</h3>
      <p>The agent couldn't work out how this site lists its meetings. Check the agenda page address, then try again.</p>
      <?php if ($run && $run['error']): ?><p class="small text-muted"><?= h($run['error']) ?></p><?php endif ?>
      <form method="post" action="/m/<?= $slug ?>/retry"><?= csrf_field() ?><button class="btn btn-primary"><?= icon('rotate') ?> Try setup again</button></form>
    <?php else: ?>
      <h3><span class="chip"><?= icon('spinner') ?></span>Setting up</h3>
      <p class="mb-2">An agent is reading <?= h($m['site_name']) ?>'s site to learn how it lists meetings and which kinds of meetings it holds. When it's done you choose which meetings to follow and how summaries are written. This takes a few minutes; refresh to check.</p>
      <p class="small text-muted mb-0"><?= $run ? 'Setup run ' . h($run['state']) . ', started ' . h(ago($run['started_at'] ?? $run['queued_at'])) : 'Waiting for the agent to start.' ?></p>
    <?php endif ?>
  </div>

<?php elseif ($m['state'] === 'choose'): ?>
  <form method="post" class="node-add mt-4">
    <?= csrf_field() ?>
    <h3><span class="chip"><?= icon('list-check') ?></span>Choose what to follow</h3>
    <p class="small text-muted">The agent found these kinds of meetings on <?= h($m['site_name']) ?>'s site. It only reads and summarizes the ones you tick. The usual council meetings are ticked to start.</p>
    <?= $typeBoxes(isset($_POST['types']) ? (array)$_POST['types'] : array_keys(array_filter($types, fn($t) => $t['default']))) ?>
    <h3 class="mt-4"><span class="chip" style="--c:var(--o-blue)"><?= icon('pen-nib') ?></span>Design your summaries</h3>
    <?= $designer(true) ?>
  </form>

<?php else: ?>
<div class="nav nav-tabs mt-4" role="tablist">
  <button class="nav-link active" data-tab="#t-agendas" role="tab"><?= icon('file-lines') ?> Agendas</button>
  <button class="nav-link" data-tab="#t-pending" role="tab"><?= icon('hourglass-half') ?> Pending items <?php if ($pending): ?><span class="badge badge-warning"><?= count($pending) ?></span><?php endif ?></button>
  <button class="nav-link" data-tab="#t-videos" role="tab"><?= icon('video') ?> Videos</button>
  <button class="nav-link" data-tab="#t-notify" role="tab"><?= icon('bell') ?> Notifications</button>
  <button class="nav-link" data-tab="#t-types" role="tab"><?= icon('list-check') ?> Meetings</button>
  <button class="nav-link" data-tab="#t-summary" role="tab"><?= icon('pen-nib') ?> Summary</button>
  <button class="nav-link" data-tab="#t-settings" role="tab"><?= icon('link') ?> Sources</button>
</div>

<div class="mt-3">
  <div class="tab-pane active" id="t-agendas">
    <?php if (!$agendas): ?>
      <p class="text-muted">No agendas yet. The agent fills this in on its first check.</p>
    <?php endif ?>
    <div class="accordion">
      <?php foreach ($agendas as $i => $a): ?>
        <details <?= ($opened === '' && $i === 0) || $opened === 'agenda-' . $a['id'] ? 'open' : '' ?>>
          <summary><?= h($a['title']) ?> <span class="when"><?= h($typeName($a['meeting_type'])) ?> · <?= h($a['meeting_date'] ?? '') ?></span></summary>
          <div class="accordion-body summary-tool">
            <?= $summaryBlock('agenda', $a) ?>
            <p class="mt-2 mb-0"><a href="<?= href($a['url']) ?>" rel="noopener" target="_blank"><?= icon('arrow-up-right-from-square') ?> Open the agenda</a></p>
            <?= $summaryBar('agenda', $a) ?>
          </div>
        </details>
      <?php endforeach ?>
    </div>
  </div>

  <div class="tab-pane" id="t-pending">
    <p class="text-muted small prose">Items still working through the process, such as bylaws between readings or motions waiting on a staff report. They drop off once settled.</p>
    <div class="nodes">
      <?php if (!$pending): ?><div class="node-empty">Nothing pending right now.</div><?php endif ?>
      <?php foreach ($pending as $p): ?>
        <div class="node" style="--c:var(--o-yellow)">
          <div class="node-main">
            <div class="node-title"><?= icon('hourglass-half') ?><?php if ($p['source_url']): ?><a href="<?= href($p['source_url']) ?>" rel="noopener" target="_blank"><?= h($p['title']) ?></a><?php else: ?><?= h($p['title']) ?><?php endif ?></div>
            <div class="node-meta"><?= $p['detail'] ? h($p['detail']) . ' · ' : '' ?>updated <?= h(ago($p['updated_at'])) ?></div>
          </div>
          <div class="node-actions"><span class="badge badge-warning status"><?= h($p['status']) ?></span></div>
        </div>
      <?php endforeach ?>
    </div>
  </div>

  <div class="tab-pane" id="t-videos">
    <?php if (!$m['video_url']): ?>
      <p class="text-muted">No video page set. Add one under Sources.</p>
    <?php elseif (!$videos): ?>
      <p class="text-muted">No videos yet. The agent reads the next one it finds.</p>
    <?php endif ?>
    <div class="accordion">
      <?php foreach ($videos as $v): ?>
        <details <?= $opened === 'video-' . $v['id'] ? 'open' : '' ?>>
          <summary><?= h($v['title']) ?> <span class="when"><?= h($typeName($v['meeting_type'])) ?> · <?= h($v['meeting_date'] ?? '') ?></span></summary>
          <div class="accordion-body summary-tool">
            <?= $summaryBlock('video', $v) ?>
            <p class="mt-2 mb-0"><a href="<?= href($v['url']) ?>" rel="noopener" target="_blank"><?= icon('play') ?> Watch</a>
              <?php if ($v['tlen']): ?>· <a href="/m/<?= $slug ?>/transcript/<?= (int)$v['id'] ?>"><?= icon('download') ?> Download the transcript</a><?php endif ?></p>
            <?= $summaryBar('video', $v) ?>
          </div>
        </details>
      <?php endforeach ?>
    </div>
  </div>

  <div class="tab-pane" id="t-notify">
    <p class="text-muted small prose">Where this monitor's news goes and what's sent to each place. Destinations and mailing lists are kept under <a href="/notifications">Notifications</a>.</p>
    <div class="nodes">
      <?php if (!$rules): ?><div class="node-empty">This monitor doesn't send you anything yet. Add a notification below.</div><?php endif ?>
      <?php foreach ($rules as $r): [$kindLabel, $kindIcon, $kindColour] = destination_kinds()[$r['target_kind']] ?? [$r['target_kind'], '', 'var(--o-secondary)']; ?>
        <div class="node <?= $r['paused'] || !$r['confirmed'] ? 'is-quiet' : '' ?>" style="--c:<?= $kindColour ?>">
          <div class="node-main">
            <div class="node-title"><?= $kindIcon ?><?= h($r['target_name']) ?> <span class="badge ms-2"><?= h($kindLabel) ?></span>
              <?php if ($r['paused']): ?><span class="badge badge-warning">Paused</span><?php endif ?>
              <?php if (!$r['confirmed']): ?><span class="badge badge-warning">Not confirmed yet</span><?php endif ?></div>
            <div class="node-meta"><?= h(rule_label($r)) ?></div>
          </div>
          <div class="node-actions">
            <form method="post" action="<?= h(monitor_url($m, 'rule/' . (int)$r['id'] . '/delete')) ?>"><?= csrf_field() ?><button class="btn btn-sm btn-ghost"><?= icon('trash-can') ?> Remove</button></form>
          </div>
        </div>
      <?php endforeach ?>
    </div>
    <?php $ruleAction = monitor_url($m, 'rule'); $ruleMonitors = null; require __DIR__ . '/_rule_form.php'; ?>
  </div>

  <div class="tab-pane" id="t-types">
    <form method="post" action="/m/<?= $slug ?>/types" class="node-add mt-0">
      <?= csrf_field() ?>
      <h3><span class="chip"><?= icon('list-check') ?></span>Meetings to follow</h3>
      <p class="small text-muted">The kinds of meetings <?= h($m['site_name']) ?> holds. The agent only reads and summarizes the ones ticked here.</p>
      <?= $typeBoxes($tracked) ?>
      <button class="btn btn-primary mt-3"><?= icon('check') ?> Save</button>
    </form>
  </div>

  <div class="tab-pane" id="t-summary">
    <form method="post" class="node-add mt-0">
      <?= csrf_field() ?>
      <h3><span class="chip" style="--c:var(--o-blue)"><?= icon('pen-nib') ?></span>Summary designer</h3>
      <p class="small text-muted">Each agenda and video this monitor saves is summarized with these instructions. New ones are written this way, and any agenda or video can be rebuilt with them under Agendas or Videos, which keeps its earlier summaries.</p>
      <?= $designer(false) ?>
    </form>
  </div>

  <div class="tab-pane" id="t-settings">
    <form method="post" action="/m/<?= $slug ?>/edit" class="node-add mt-0">
      <?= csrf_field() ?>
      <h3><span class="chip"><?= icon('link') ?></span>Sources</h3>
      <div class="row g-3">
        <div class="col-12"><label class="label"><?= icon('file-lines') ?> Agenda page</label><input class="input" value="<?= h($m['agenda_url']) ?>" disabled></div>
        <div class="col-md-8"><label class="label" for="video_url"><?= icon('video') ?> Video page</label><input class="input" id="video_url" name="video_url" type="url" value="<?= h($m['video_url']) ?>"></div>
        <div class="col-md-4"><label class="label" for="video_source">Videos are on</label>
          <select class="input" id="video_source" name="video_source">
            <option value="youtube" <?= $m['video_source'] === 'youtube' ? 'selected' : '' ?>>YouTube</option>
            <option value="page" <?= $m['video_source'] === 'page' ? 'selected' : '' ?>>Their own site</option>
          </select></div>
        <div class="col-12"><button class="btn btn-primary"><?= icon('check') ?> Save</button></div>
      </div>
    </form>
    <?php if ($m['layout_notes']): ?>
      <h2 class="section-title"><span class="chip" style="--c:var(--o-blue)"><?= icon('robot') ?></span>What the agents have learned about this site</h2>
      <div class="node summary small"><?= h($m['layout_notes']) ?></div>
    <?php endif ?>
  </div>
</div>
<?php endif ?>

<script>
// Template buttons fill in the summary instructions; the preview and save buttons send them.
document.querySelectorAll('[data-template]').forEach(b => b.addEventListener('click', () => {
  const box = document.getElementById('summary_prompt');
  if (box) { box.value = b.dataset.template; box.focus(); }
}));
<?php if ($preview && $m['state'] === 'ready'): ?>
addEventListener('DOMContentLoaded', () => document.querySelector('[data-tab="#t-summary"]')?.click());
<?php endif ?>
</script>
