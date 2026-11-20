<?php $title = 'Report a problem'; ?>
<div class="container-narrow" style="max-width:36rem">
  <h1>Report a problem</h1>
<?php if (!empty($sent)): ?>
  <div class="node" style="--c:var(--o-mint);display:block">
    <div class="node-title"><?= icon('check') ?>Thanks, your report is in</div>
    <p class="node-meta mb-0">A person reads every one, and we'll reply by email.</p>
  </div>
  <p class="mt-3"><a href="/"><?= icon('arrow-left') ?> Back to agenda.delivery</a></p>
<?php else: ?>
  <p class="text-muted">If you think you've been blocked unfairly, or something isn't working right, tell us here. A person reads every report.</p>
  <?php if (!empty($error)): ?><div class="alert alert-danger"><?= h($error) ?></div><?php endif ?>
  <form method="post" action="/report" class="node-add vstack g-3" style="--accent:var(--o-accent-main)">
    <?= csrf_field() ?>
    <?php if ($me): ?>
      <p class="small mb-0">We'll reply to <?= h($me['email']) ?>.</p>
    <?php else: ?>
      <div><label class="label" for="email">Your email</label><input class="input" type="email" id="email" name="email" required autocomplete="email" value="<?= h((string)($old['email'] ?? '')) ?>"></div>
    <?php endif ?>
    <div><label class="label" for="kind">What happened</label>
      <select class="input" id="kind" name="kind">
        <?php foreach (report_kinds() as $k => $label): ?>
          <option value="<?= h($k) ?>" <?= $kind === $k ? 'selected' : '' ?>><?= h($label) ?></option>
        <?php endforeach ?>
      </select></div>
    <div><label class="label" for="details">Details</label><textarea class="input" id="details" name="details" rows="6" required maxlength="4000" placeholder="What you were doing, what you expected, and what happened instead."><?= h((string)($old['details'] ?? '')) ?></textarea></div>
    <div hidden><label for="website">Leave this empty</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
    <button class="btn btn-primary"><?= icon('paper-plane') ?> Send report</button>
  </form>
<?php endif ?>
</div>
