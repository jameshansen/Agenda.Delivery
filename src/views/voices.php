<?php
$title = 'Voices';
$panel = 'voices';
$preview = $preview ?? null;
// The editor's fields as last sent, so a preview or a refused save keeps what was typed.
$f = $_SERVER['REQUEST_METHOD'] === 'POST' ? $_POST : ($voice ?? ['name' => '', 'prompt' => summary_templates()['plain']['prompt'], 'markdown' => 1]);
$uses = $voice ? count($users) : 0;
$previewOn = (int)($_POST['preview_on'] ?? ($users ? (int)val('SELECT id FROM monitor WHERE voice_id = ? ORDER BY id LIMIT 1', [$voice['id']]) : ($monitors[0]['id'] ?? 0)));
$plural = fn(int $n) => $n === 1 ? '1 monitor' : "$n monitors";
?>
<?php if (!$editing): ?>
<h2 class="section-title"><span class="chip"><?= icon('head-side-cough') ?></span>Your voices</h2>
<p class="small text-muted prose">A voice is how summaries are written: who's writing, the tone, what to cover and how long. Give a voice to as many monitors as you like, and editing it changes them all. Each monitor can also add a note of its own under its Summary tab.</p>
<div class="nodes">
  <?php foreach ($voices as $v): ?>
    <div class="node" style="--c:var(--o-blue)">
      <div class="node-main">
        <div class="node-title"><?= icon('head-side-cough') ?><a href="/voices/<?= (int)$v['id'] ?>"><?= h($v['name']) ?></a>
          <?php if ($v['is_default']): ?><span class="badge ms-2">Default</span><?php endif ?></div>
        <div class="node-meta"><?= h(mb_strimwidth(preg_replace('/\s+/', ' ', $v['prompt']), 0, 110, '…')) ?> · <?= $v['markdown'] ? 'Markdown' : 'plain text' ?> · used by <?= $plural((int)$v['uses']) ?></div>
      </div>
      <div class="node-actions">
        <a class="btn btn-sm" href="/voices/<?= (int)$v['id'] ?>"><?= icon('pen') ?> Edit</a>
        <?php if (!$v['is_default']): ?>
          <form method="post" action="/voices/<?= (int)$v['id'] ?>/default"><?= csrf_field() ?><button class="btn btn-sm btn-ghost"><?= icon('star') ?> Make default</button></form>
          <form method="post" action="/voices/<?= (int)$v['id'] ?>/delete" onsubmit="return confirm('Remove <?= h(addslashes($v['name'])) ?>? Its monitors move to the default voice.')"><?= csrf_field() ?><button class="btn btn-sm btn-ghost"><?= icon('trash-can') ?> Remove</button></form>
        <?php endif ?>
      </div>
    </div>
  <?php endforeach ?>
</div>
<a class="btn btn-primary mt-3" href="/voices/new"><?= icon('plus') ?> New voice</a>

<?php else: ?>
<ol class="breadcrumb"><li><a href="/voices">Your voices</a></li><li><?= $voice ? h($voice['name']) : 'New voice' ?></li></ol>
<form method="post" class="node-add mt-0">
  <?= csrf_field() ?>
  <h3><span class="chip" style="--c:var(--o-blue)"><?= icon('head-side-cough') ?></span><?= $voice ? 'Editing the voice' : 'A new voice' ?></h3>
  <?php if ($uses > 1): ?>
    <div class="alert alert-warning"><?= icon('circle-info') ?> <?= $uses ?> monitors use this voice. Saving changes their summaries from the next one.</div>
  <?php endif ?>
  <?php if ($users): ?>
    <p class="small text-muted">Used by <?= implode(', ', array_map(fn($u) => '<a href="' . h(monitor_url($u)) . '">' . h($u['name']) . '</a>', $users)) ?>.</p>
  <?php endif ?>
  <div class="vstack g-3">
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
      <p class="form-text mb-0">Write it like instructions to a helper: who's writing, the tone, how long, what to focus on and how to sign off. Summaries only ever use facts from the meeting material.</p></div>
    <div><label class="option"><input type="checkbox" name="markdown" value="1" <?= !empty($f['markdown']) ? 'checked' : '' ?>> <?= icon('heading') ?> Format with Markdown</label>
      <p class="form-text mb-0">Bold, lists and headings, shown formatted on the site and in email. Discord and webhooks get the Markdown itself, WhatsApp its own bold and italics, and Pushover plain text.</p></div>
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
      <?php $base = $voice ? '/voices/' . (int)$voice['id'] : '/voices/new' ?>
      <button class="btn" formaction="<?= $base ?>/preview" formnovalidate data-busy="Writing a preview, this takes a few seconds"><?= icon('eye') ?> Preview</button>
      <button class="btn btn-primary" formaction="<?= $base ?>/save" data-busy="Saving"><?= icon('check') ?> Save</button>
      <?php if ($uses): ?>
        <button class="btn" formaction="<?= $base ?>/rebuild" data-busy="Saving"><?= icon('rotate') ?> Save and rebuild the newest for <?= $uses === 1 ? 'its monitor' : "all $uses" ?></button>
      <?php endif ?>
    </div>
  </div>
</form>
<?php endif ?>
