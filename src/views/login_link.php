<?php $title = 'Sign in'; ?>
<div class="container-narrow" style="max-width:28rem">
  <h1>Sign in</h1>
  <p class="text-muted">This confirms your email address and signs you in.</p>
  <form method="post" action="/login/link">
    <?= csrf_field() ?>
    <input type="hidden" name="t" value="<?= h($t) ?>">
    <button class="btn btn-primary btn-block"><?= icon('right-to-bracket') ?> Sign in to agenda.delivery</button>
  </form>
</div>
