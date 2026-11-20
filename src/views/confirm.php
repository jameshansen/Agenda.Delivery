<?php $title = 'Confirm notifications'; ?>
<div class="container-narrow" style="max-width:28rem">
  <h1>Confirm notifications</h1>
<?php if ($done): ?>
  <p>Done. <?= h($done) ?> will get the meeting notifications it was set up for.</p>
<?php elseif ($post): ?>
  <p>That link has been used already, or the address was taken off.</p>
<?php else: ?>
  <p class="text-muted">Someone added this address to their agenda.delivery account to get meeting notifications. Confirm if you want them; otherwise close this page and nothing more is sent.</p>
  <form method="post" action="/confirm">
    <?= csrf_field() ?>
    <input type="hidden" name="t" value="<?= h($t) ?>">
    <button class="btn btn-primary btn-block"><?= icon('check') ?> Yes, send me notifications</button>
  </form>
<?php endif ?>
</div>
