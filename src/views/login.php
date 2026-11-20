<?php $title = 'Sign in'; ?>
<div class="container-narrow" style="max-width:28rem">
  <h1>Sign in</h1>
  <p><?= icon('robot') ?> Your own AI agent reads each organization's agendas and meeting videos, and sends you a plain language summary of what's coming up.</p>
  <p class="text-muted">No password needed. If you have an account, we email you a code. If you're new, you'll go straight to joining with a sign-up code or a short registration we approve.</p>
  <?php if (!empty($error)): ?><div class="alert alert-danger"><?= h($error) ?></div><?php endif ?>
  <?php if (cfg('google_id')): ?>
    <a class="btn btn-block mb-3" href="/auth/google?next=<?= h(urlencode($next)) ?>"><?= icon('google', 'brands') ?> Continue with Google</a>
    <p class="text-center text-muted small">or</p>
  <?php endif ?>
  <form method="post" action="/login" class="vstack g-3">
    <?= csrf_field() ?>
    <input type="hidden" name="next" value="<?= h($next) ?>">
    <div><label class="label" for="email">Email</label><input class="input" type="email" id="email" name="email" required autocomplete="email" autofocus value="<?= h($_POST['email'] ?? '') ?>"></div>
    <button class="btn btn-primary btn-block"><?= icon('arrow-right') ?> Continue</button>
  </form>
</div>
