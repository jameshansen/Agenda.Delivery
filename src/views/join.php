<?php
$title = 'Join';
$val = fn($k) => h((string)($old[$k] ?? ''));
$signOut = '<form method="post" action="/logout" class="mt-3">' . csrf_field() . '<button class="btn btn-sm">' . icon('right-from-bracket') . ' Sign out</button></form>';
?>
<div class="container-narrow" style="max-width:36rem">
<?php if ($me['status'] === 'declined'): ?>
  <h1>Not approved</h1>
  <p>Your request to join agenda.delivery wasn't approved. If someone gave you a sign-up code since, sign out and back in with the address they invited.</p>
  <p>If you think this is unfair, <a href="/report?about=signup">report a problem</a> and a person will look at it.</p>
  <?= $signOut ?>
<?php elseif (is_member($me)): ?>
  <h1>Check your email</h1>
  <p>You're in. We sent a sign-in link to <?= h($me['email']) ?>. Open it to confirm the address is yours and start using agenda.delivery.</p>
  <p class="text-muted small">No email? Check your spam folder, or <a href="/login">sign in with your email</a> for a code.</p>
<?php else: ?>
  <h1>Join agenda.delivery</h1>
  <p class="text-muted">You're joining as <?= h($me['email']) ?>. Accounts are by invitation for now: enter a sign-up code, or tell us a bit about yourself and we'll approve you.</p>
  <?php if (!empty($error)): ?><div class="alert alert-danger"><?= h($error) ?></div><?php endif ?>

  <?php if ($me['status'] === 'pending' && $request): ?>
    <div class="node mb-4" style="--c:var(--o-yellow);display:block">
      <div class="node-title"><?= icon('hourglass-half') ?>Your request is in</div>
      <p class="node-meta mb-0">Sent <?= h(ago($request['created_at'])) ?>. Once it's approved, we'll email a sign-in link to <?= h($me['email']) ?>.</p>
    </div>
  <?php endif ?>

  <h2 class="section-title"><span class="chip" style="--c:var(--o-mint)"><?= icon('key') ?></span> Have a sign-up code?</h2>
  <form method="post" action="/join" class="node-add" style="--accent:var(--o-mint)">
    <?= csrf_field() ?>
    <input type="hidden" name="via" value="code">
    <label class="label" for="code">Sign-up code</label>
    <div style="display:flex;gap:.75rem;align-items:center">
      <input class="input" id="code" name="code" required autocomplete="off" value="<?= $via === 'code' ? $val('code') : '' ?>">
      <button class="btn btn-primary" style="flex-shrink:0"><?= icon('right-to-bracket') ?> Join</button>
    </div>
  </form>

  <?php if ($me['status'] !== 'pending'): ?>
  <h2 class="section-title"><span class="chip" style="--c:var(--o-blue)"><?= icon('id-card') ?></span> No code? Tell us about yourself</h2>
  <form method="post" action="/join" class="node-add vstack g-3" style="--accent:var(--o-blue)">
    <?= csrf_field() ?>
    <input type="hidden" name="via" value="request">
    <div><label class="label" for="name">Your name</label><input class="input" id="name" name="name" required maxlength="150" autocomplete="name" value="<?= $val('name') ?: h($me['name']) ?>"></div>
    <div><label class="label" for="organization">Organization or group <span class="text-muted">(if any)</span></label><input class="input" id="organization" name="organization" maxlength="150" value="<?= $val('organization') ?>"></div>
    <div><label class="label" for="community">Your community</label><input class="input" id="community" name="community" required maxlength="150" placeholder="Your town or city" value="<?= $val('community') ?>"></div>
    <div><label class="label" for="about">Who you are</label><textarea class="input" id="about" name="about" rows="3" required maxlength="1500" placeholder="A resident, a reporter, a councillor's assistant, a neighbourhood group..."><?= $val('about') ?></textarea></div>
    <div><label class="label" for="use_for">What you'll use it for</label><textarea class="input" id="use_for" name="use_for" rows="3" required maxlength="1500" placeholder="Which councils or boards you want to follow, and who the summaries are for."><?= $val('use_for') ?></textarea></div>
    <button class="btn btn-primary"><?= icon('paper-plane') ?> Send my request</button>
  </form>
  <?php endif ?>
  <?= $signOut ?>
<?php endif ?>
</div>
