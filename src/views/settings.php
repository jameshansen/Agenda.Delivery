<?php
$title = 'Settings';
$panel = 'settings';
?>
<h2 class="section-title"><span class="chip"><?= icon('user') ?></span>Account</h2>
<div class="nodes">
  <div class="node">
    <div class="node-main">
      <div class="node-title"><?= icon('envelope') ?><?= h($me['email']) ?></div>
      <div class="node-meta">Signs in with <?= $me['google_sub'] ? 'Google or an emailed code' : 'an emailed code' ?> · member since <?= h(date('F j, Y', strtotime($me['created_at'] . ' UTC'))) ?></div>
    </div>
    <div class="node-actions">
      <form method="post" action="/logout"><?= csrf_field() ?><button class="btn btn-sm"><?= icon('right-from-bracket') ?> Sign out</button></form>
    </div>
  </div>
</div>

<form method="post" action="/settings" class="node-add">
  <?= csrf_field() ?>
  <h3><span class="chip"><?= icon('id-card') ?></span>Your details</h3>
  <div class="row g-3">
    <div class="col-md-6"><label class="label" for="name">Name</label>
      <input class="input" id="name" name="name" maxlength="80" autocomplete="name" value="<?= h($me['name']) ?>"></div>
    <div class="col-md-6"><label class="label" for="email">Email</label>
      <input class="input" id="email" value="<?= h($me['email']) ?>" disabled>
      <p class="form-text mb-0">Your sign-in address. Notifications go wherever you set them under Notifications.</p></div>
    <div class="col-12"><span class="label"><?= icon('palette') ?> Appearance</span>
      <div class="options">
        <label class="option"><input type="radio" name="theme" value="light" <?= $me['theme'] !== 'dark' ? 'checked' : '' ?>> <?= icon('sun') ?> Light</label>
        <label class="option"><input type="radio" name="theme" value="dark" <?= $me['theme'] === 'dark' ? 'checked' : '' ?>> <?= icon('moon') ?> Dark</label>
      </div></div>
    <div class="col-12"><button class="btn btn-primary"><?= icon('check') ?> Save</button></div>
  </div>
</form>

<form method="post" action="/settings/branding" enctype="multipart/form-data" class="node-add">
  <?= csrf_field() ?>
  <h3><span class="chip"><?= icon('building') ?></span>Your organization</h3>
  <p class="small text-muted prose">A name and logo for the email your mailing lists send. A list uses them when its settings say to send as custom with your organization settings, and a list can also have its own. Mail to your other destinations always comes from agenda.delivery.</p>
  <div class="row g-3">
    <div class="col-md-6"><label class="label" for="org_name">Organization name</label>
      <input class="input" id="org_name" name="org_name" maxlength="40" placeholder="Maple Street Neighbours" value="<?= h($me['org_name']) ?>">
      <p class="form-text mb-0">Shown to the people on a list as "<?= h($me['org_name'] !== '' ? $me['org_name'] : 'Name') ?> via agenda.delivery". Letters, numbers and spaces.</p></div>
    <div class="col-md-6"><label class="label" for="org_logo">Logo</label>
      <?php if ($me['logo'] !== ''): ?>
        <div class="logo-current"><img class="logo-thumb" src="/media/<?= h($me['logo']) ?>" alt="">
          <label class="check"><input type="checkbox" name="remove_logo" value="1"> Remove this logo</label></div>
      <?php endif ?>
      <input class="input" id="org_logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" data-max-kb="500">
      <p class="form-text mb-0">PNG, JPEG or WebP, up to 500 KB and <?= LOGO_MAX_SIDE ?> pixels across. It sits at the top of each email.</p></div>
    <div class="col-12">
      <?php $colours = $accountColours = mail_colours($me['mail_colours']); $inherit = null; $listId = 0; $previewName = $me['org_name']; $previewLogo = $me['logo'];
        require __DIR__ . '/_colour_picker.php'; ?>
    </div>
    <div class="col-12"><button class="btn btn-primary" data-busy="Saving"><?= icon('check') ?> Save</button></div>
  </div>
</form>
