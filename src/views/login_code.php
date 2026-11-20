<?php $title = 'Enter your code'; ?>
<div class="container-narrow" style="max-width:28rem">
  <h1>Check your email</h1>
  <p class="text-muted">We sent a six-digit code to <?= h($email) ?>. It works for 15 minutes.</p>
  <?php if (!empty($error)): ?><div class="alert alert-danger"><?= h($error) ?></div><?php endif ?>
  <form method="post" action="/login/code" class="vstack g-3">
    <?= csrf_field() ?>
    <input type="hidden" name="email" value="<?= h($email) ?>">
    <input type="hidden" name="next" value="<?= h($next) ?>">
    <div><label class="label" for="code">Code</label><input class="input input-lg" id="code" name="code" inputmode="numeric" pattern="\d{6}" maxlength="6" required autocomplete="one-time-code" autofocus></div>
    <button class="btn btn-primary btn-block">Sign in</button>
  </form>
  <p class="mt-3 small"><a href="/login">Use a different email or send a new code</a></p>
</div>
