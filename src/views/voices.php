<?php
$title = $voice ? $voice['name'] : 'New voice';
$panel = 'voices';
$preview = $preview ?? null;
// The editor's fields as last sent, so a preview or a refused save keeps what was typed.
$f = $_SERVER['REQUEST_METHOD'] === 'POST' ? $_POST : ($voice ?? ['name' => '', 'prompt' => summary_templates()['plain']['prompt'], 'markdown' => 1]);
$uses = count($users);
$previewOn = (int)($_POST['preview_on'] ?? ($users ? (int)val('SELECT id FROM monitor WHERE voice_id = ? ORDER BY id LIMIT 1', [$voice['id']]) : ($monitors[0]['id'] ?? 0)));
$plural = fn(int $n) => $n === 1 ? '1 monitor' : "$n monitors";
$base = $voice ? '/voices/' . (int)$voice['id'] : '/voices/new';
?>
<p class="small text-muted prose">A voice is the set of instructions your summaries are written with, like who's writing, the tone, what to cover and how long they should be. You can give one voice to as many monitors as you like and any change to it applies to all of them, while each monitor can still add a note of its own under its Summary tab.</p>

<div class="lists-layout">
<aside class="list-rail" aria-label="Voices">
  <nav class="list-rail-items">
    <?php foreach ($voices as $v): ?>
      <a class="list-rail-item <?= $voice && (int)$v['id'] === (int)$voice['id'] ? 'active' : '' ?>" href="/voices/<?= (int)$v['id'] ?>" data-swap
         <?= $voice && (int)$v['id'] === (int)$voice['id'] ? 'aria-current="page"' : '' ?>>
        <span class="list-rail-name"><?= icon('head-side-talk') ?><?= h($v['name']) ?></span>
        <span class="list-rail-meta"><?= $v['is_default'] ? 'Default · ' : '' ?><?= $plural((int)$v['uses']) ?></span>
      </a>
    <?php endforeach ?>
  </nav>
  <form method="post" action="/voices/new/save" class="list-rail-new">
    <?= csrf_field() ?>
    <label class="label small" for="voice_name"><?= icon('plus') ?> New voice</label>
    <input class="input" id="voice_name" name="name" maxlength="60" required placeholder="Riley for the Strong Towns group">
    <input type="hidden" name="prompt" value="<?= h(default_summary_prompt()) ?>">
    <input type="hidden" name="markdown" value="1">
    <button class="btn btn-sm btn-primary btn-block" data-busy="Creating"><?= icon('plus') ?> Create voice</button>
  </form>
</aside>

<div class="list-detail">
<div class="d-flex justify-between align-center" style="flex-wrap:wrap;gap:1rem">
  <div>
    <h2 class="h3 mb-1"><?= $voice ? h($voice['name']) : 'New voice' ?> <span class="badge ms-2">Voice</span>
      <?php if ($voice && $voice['is_default']): ?><span class="badge badge-info">Default</span><?php endif ?></h2>
    <?php if ($voice): ?><p class="text-muted small mb-0"><?= $voice['markdown'] ? 'Markdown' : 'Plain text' ?> · used by <?= $plural($uses) ?></p><?php endif ?>
  </div>
  <?php if ($voice && !$voice['is_default']): ?>
    <div class="hstack" style="flex-wrap:wrap">
      <form method="post" action="<?= $base ?>/default"><?= csrf_field() ?><button class="btn"><?= icon('star') ?> Make default</button></form>
      <form method="post" action="<?= $base ?>/delete" onsubmit="return confirm('Remove <?= h(addslashes($voice['name'])) ?>? Its monitors move to the default voice.')"><?= csrf_field() ?>
        <button class="btn btn-ghost"><?= icon('trash-can') ?> Remove</button></form>
    </div>
  <?php endif ?>
</div>

<?php if ($voice): ?>
  <div class="voice-uses mt-3">
    <p class="mb-2"><?= icon('circle-info') ?>
      <?php if ($uses > 1): ?><?= $uses ?> monitors share this voice, so saving it changes all of their summaries from the next one onward.
      <?php elseif ($uses === 1): ?>One monitor uses this voice, and saving it changes that monitor's summaries from the next one onward.
      <?php else: ?>No monitors use this voice yet. Choose it under a monitor's Summary tab.<?php endif ?></p>
    <?php if ($users): ?>
      <div class="pills">
        <?php foreach ($users as $u): ?><a class="pill" href="<?= h(monitor_url($u)) ?>"><?= icon('magnifying-glass') ?> <?= h($u['name']) ?></a><?php endforeach ?>
      </div>
    <?php endif ?>
  </div>
<?php endif ?>

<form method="post" class="vstack g-3 mt-3">
  <?= csrf_field() ?>
  <div><label class="label" for="v_name">Name</label>
    <input class="input" id="v_name" name="name" maxlength="60" required value="<?= h((string)($f['name'] ?? '')) ?>" placeholder="Riley for the Strong Towns group"></div>
  <div><span class="label"><?= icon('wand-magic-sparkles') ?> Start from</span>
    <div class="hstack" style="flex-wrap:wrap">
      <?php foreach (summary_templates() as $t): ?>
        <button type="button" class="btn btn-sm" data-template="<?= h($t['prompt']) ?>"><?= h($t['name']) ?></button>
      <?php endforeach ?>
    </div></div>
  <div><label class="label" for="v_prompt"><?= icon('pen-nib') ?> How this voice writes</label>
    <textarea class="input" id="v_prompt" name="prompt" rows="7" maxlength="4000" required data-template-box><?= h((string)($f['prompt'] ?? '')) ?></textarea>
    <p class="form-text mb-0">Write it the way you'd brief a helper, covering who's writing, the tone, how long it should be, what to focus on and how to sign off. Summaries only ever use facts from the meeting material.</p></div>
  <div><label class="option option-solo option-stack"><input type="checkbox" name="markdown" value="1" <?= !empty($f['markdown']) ? 'checked' : '' ?>>
    <span class="option-text"><span><?= icon('pen-clip') ?> Output Formatted Text</span><span class="option-hint">Adds bold, lists and headings.</span></span></label></div>
  <?php if ($monitors): ?>
    <div><label class="label" for="v_on"><?= icon('eye') ?> Preview on</label>
      <select class="input" id="v_on" name="preview_on" style="max-width:24rem">
        <?php foreach ($monitors as $pm): ?><option value="<?= (int)$pm['id'] ?>" <?= (int)$pm['id'] === $previewOn ? 'selected' : '' ?>><?= h($pm['name']) ?>'s newest agenda</option><?php endforeach ?>
      </select></div>
  <?php endif ?>
  <?php if ($preview && !empty($preview['refused'])): ?>
    <div class="node is-error" style="display:block">
      <div class="node-title"><?= icon('ban') ?>Not saved</div>
      <p class="mb-0 mt-1"><?= h($preview['error']) ?></p>
      <p class="small mb-0 mt-2">Think this should be allowed? <a href="/report?about=prompt">Report a problem</a>.</p>
    </div>
  <?php elseif ($preview): ?>
    <div class="node" style="--c:var(--o-blue);display:block">
      <div class="node-title"><?= icon('eye') ?>Preview<?= $preview['title'] ? ': ' . h($preview['title']) : '' ?></div>
      <?php if (!empty($preview['error'])): ?>
        <p class="text-muted mb-0"><?= h($preview['error']) ?></p>
      <?php else: ?>
        <div class="summary md mt-2"><?= text_to_html($preview['text'], null) ?></div>
      <?php endif ?>
    </div>
  <?php endif ?>
  <div class="hstack" style="flex-wrap:wrap">
    <button class="btn" formaction="<?= $base ?>/preview" formnovalidate data-busy="Writing a preview, this takes a few seconds"><?= icon('eye') ?> Preview</button>
    <button class="btn btn-primary" formaction="<?= $base ?>/save" data-busy="Saving"><?= icon('check') ?> Save</button>
    <?php if ($uses): ?>
      <button class="btn" formaction="<?= $base ?>/rebuild" data-busy="Saving"><?= icon('rotate') ?> Save and rebuild the newest for <?= $uses === 1 ? 'its monitor' : "all $uses" ?></button>
    <?php endif ?>
  </div>
</form>
</div>
</div>
