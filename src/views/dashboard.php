<?php
$title = 'Monitors';
$panel = 'monitors';
$old = $old ?? [];
?>
<h2 class="section-title"><span class="chip"><?= icon('magnifying-glass') ?></span>Your monitors</h2>
<div class="nodes">
  <?php if (!$monitors): ?>
    <div class="node-empty">You're not monitoring anything yet. Add the council, board or organization you want to keep an eye on below.</div>
  <?php endif ?>
  <?php foreach ($monitors as $m): ?>
    <div class="node <?= ($m['actual_state'] ?? '') === 'error' ? 'is-error' : '' ?>">
      <a class="node-main" href="<?= h(monitor_url($m)) ?>">
        <div class="node-title"><?= icon('building-columns') ?><?= h($m['name']) ?> <span class="badge ms-2"><?= h(monitor_kinds()[$m['kind']] ?? $m['kind']) ?></span></div>
        <div class="node-meta">
          <?php if ($m['state'] === 'setup'): ?>
            <?php if ($m['setup_state'] === 'failed'): ?><span class="state state-pending"></span>Setup needs another try
            <?php else: ?><?= icon('spinner') ?> Setting up: learning the site and its meetings<?php endif ?>
          <?php elseif ($m['state'] === 'choose'): ?>
            <span class="state state-pending"></span><strong>Ready to choose meetings</strong>
          <?php else: ?>
          <span class="state state-<?= h($m['actual_state'] ?? 'pending') ?>"></span><?= h(ucfirst($m['actual_state'] ?? 'pending')) ?>
          · checked <?= h(ago($m['last_run_end'])) ?>
          <?php endif ?>
          · <?= icon('file-lines') ?><?= (int)$m['agendas'] ?> agendas · <?= icon('hourglass-half') ?><?= (int)$m['pending'] ?> pending items
        </div>
      </a>
      <div class="node-actions">
        <a class="btn btn-sm" href="<?= h(monitor_url($m)) ?>"><?= icon('arrow-right') ?> Open</a>
        <form method="post" action="<?= h(monitor_url($m, 'remove')) ?>" onsubmit="return confirm('Remove <?= h(addslashes($m['name'])) ?>? Its agent, agendas, summaries and notifications are deleted.')">
          <?= csrf_field() ?><button class="btn btn-sm btn-ghost"><?= icon('trash-can') ?> Remove</button>
        </form>
      </div>
    </div>
  <?php endforeach ?>
</div>

<form method="post" action="/monitors/new" class="node-add" id="add">
  <?= csrf_field() ?>
  <h3><span class="chip"><?= icon('plus') ?></span>Add a monitor</h3>
  <?php if (!empty($error)): ?><div class="alert alert-danger"><?= h($error) ?></div><?php endif ?>
  <div class="scan-bubble" id="scan">
    <label class="label" for="scan_url"><?= icon('wand-magic-sparkles') ?> Fill from the organization's website</label>
    <div class="scan-row">
      <input class="input" id="scan_url" placeholder="example.com" autocomplete="off" inputmode="url">
      <button class="btn" type="button" id="scan_go"><?= icon('magnifying-glass') ?> Scan</button>
    </div>
    <p class="scan-status small mb-0" id="scan_status" aria-live="polite">An agent reads the site and fills in the form below for you to check.</p>
  </div>
  <div class="row g-3">
    <div class="col-md-6"><label class="label" for="name">Organization name</label>
      <input class="input" id="name" name="name" required maxlength="120" placeholder="City of Example" value="<?= h($old['name'] ?? '') ?>"></div>
    <div class="col-6 col-md-3"><label class="label" for="kind">Type</label>
      <select class="input" id="kind" name="kind">
        <?php foreach (monitor_kinds() as $k => $label): ?>
          <option value="<?= h($k) ?>" <?= ($old['kind'] ?? '') === $k ? 'selected' : '' ?>><?= h($label) ?></option>
        <?php endforeach ?>
      </select></div>
    <div class="col-6 col-md-3"><label class="label" for="visibility">Access</label>
      <select class="input" id="visibility" name="visibility">
        <option value="public">Public pages</option>
        <option value="private" disabled>Behind a login (coming soon)</option>
      </select></div>
    <div class="col-12"><label class="label" for="agenda_url"><?= icon('file-lines') ?> Agenda page</label>
      <input class="input" id="agenda_url" name="agenda_url" type="url" required placeholder="https://www.example.com/council/meetings" value="<?= h($old['agenda_url'] ?? '') ?>">
      <p class="form-text mb-0">The page where the organization lists its meetings and agendas.</p></div>
    <div class="col-md-8"><label class="label" for="video_url"><?= icon('video') ?> Video page (optional)</label>
      <input class="input" id="video_url" name="video_url" type="url" placeholder="https://www.youtube.com/@ExampleCityCouncil" value="<?= h($old['video_url'] ?? '') ?>"></div>
    <div class="col-md-4"><label class="label" for="video_source">Videos are on</label>
      <select class="input" id="video_source" name="video_source">
        <option value="youtube" <?= ($old['video_source'] ?? '') === 'youtube' ? 'selected' : '' ?>>YouTube</option>
        <option value="page" <?= ($old['video_source'] ?? '') === 'page' ? 'selected' : '' ?>>Their own site</option>
      </select></div>
    <div class="col-12"><button class="btn btn-primary"><?= icon('plus') ?> Add and set up</button></div>
  </div>
</form>
