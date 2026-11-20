<?php
$title = $list['name'];
$panel = 'notifications';
$tab = 'lists';
$id = (int)$list['id'];
$count = fn(string $status) => count(array_filter($members, fn($m) => $m['status'] === $status));
$statusLabels = ['active' => 'Confirmed', 'pending' => 'Waiting to confirm', 'unsubscribed' => 'Unsubscribed'];
$statusColours = ['active' => 'var(--o-mint)', 'pending' => 'var(--o-yellow)', 'unsubscribed' => 'var(--o-secondary)'];
$custom = $list['brand'] !== 'agenda';
$fromName = $preview['from_name'] !== '' ? $preview['from_name'] . ' via agenda.delivery' : 'agenda.delivery';
require __DIR__ . '/_notify_tabs.php';
?>
<div class="lists-layout">
<?php $current = $id; require __DIR__ . '/_list_rail.php'; ?>
<div class="list-detail">

<div class="d-flex justify-between align-center" style="flex-wrap:wrap;gap:1rem">
  <div>
    <h2 class="h3 mb-1"><?= h($list['name']) ?> <span class="badge ms-2">Mailing list</span>
      <?php if ($list['paused']): ?><span class="badge badge-warning">Paused</span><?php endif ?></h2>
    <p class="text-muted small mb-0">
      <?= $count('active') ?> confirmed · <?= $count('pending') ?> waiting to confirm · <?= $count('unsubscribed') ?> unsubscribed
      · <?= h(digest_label($list)) ?>
      <?php if ($waiting): ?>· <?= $waiting ?> <?= $waiting === 1 ? 'update' : 'updates' ?> waiting for the next digest<?php endif ?>
    </p>
  </div>
  <div class="hstack" style="flex-wrap:wrap">
    <form method="post" action="/notifications/<?= $id ?>/test"><?= csrf_field() ?><input type="hidden" name="from" value="list">
      <button class="btn" data-busy="Sending"><?= icon('paper-plane') ?> Send me a test</button></form>
    <form method="post" action="/notifications/<?= $id ?>/<?= $list['paused'] ? 'resume' : 'pause' ?>"><?= csrf_field() ?><input type="hidden" name="from" value="list">
      <button class="btn"><?= $list['paused'] ? icon('play') . ' Resume' : icon('pause') . ' Pause' ?></button></form>
    <form method="post" action="/notifications/<?= $id ?>/delete" onsubmit="return confirm('Remove this list, its addresses and every notification that uses it?')"><?= csrf_field() ?>
      <button class="btn btn-ghost"><?= icon('trash-can') ?> Remove</button></form>
  </div>
</div>

<div class="nav nav-tabs mt-4" role="tablist">
  <button class="nav-link active" data-tab="#l-members" role="tab"><?= icon('at') ?> Addresses</button>
  <button class="nav-link" data-tab="#l-settings" role="tab"><?= icon('sliders') ?> Settings</button>
  <button class="nav-link" data-tab="#l-preview" role="tab"><?= icon('eye') ?> Preview</button>
</div>

<div class="mt-3">
  <div class="tab-pane active" id="l-members">
    <div class="nodes">
      <?php if (!$members): ?><div class="node-empty">No addresses yet. Add some below. Each one is sent a link, and gets the list's email once its owner confirms.</div><?php endif ?>
      <?php foreach ($members as $m): ?>
        <div class="node node-compact <?= $m['status'] === 'unsubscribed' ? 'is-quiet' : '' ?>" style="--c:<?= $statusColours[$m['status']] ?? 'var(--o-secondary)' ?>">
          <div class="node-main">
            <div class="node-title"><?= icon('envelope') ?><?= h($m['email']) ?><?php if ($m['name'] !== ''): ?> <span class="text-muted fw-normal"><?= h($m['name']) ?></span><?php endif ?></div>
            <div class="node-meta"><?= h($statusLabels[$m['status']] ?? $m['status']) ?>
              <?php if ($m['status'] === 'active'): ?>· since <?= h(ago($m['confirmed_at'])) ?>
              <?php elseif ($m['status'] === 'pending'): ?>· link sent <?= h(ago($m['invited_at'])) ?>
              <?php else: ?>· only its owner can subscribe it again<?php endif ?></div>
          </div>
          <div class="node-actions">
            <?php if ($m['status'] === 'pending'): ?>
              <form method="post" action="/notifications/list/<?= $id ?>/member/<?= (int)$m['id'] ?>/resend"><?= csrf_field() ?><button class="btn btn-sm" data-busy="Sending"><?= icon('rotate') ?> Send the link again</button></form>
            <?php endif ?>
            <form method="post" action="/notifications/list/<?= $id ?>/member/<?= (int)$m['id'] ?>/remove"><?= csrf_field() ?><button class="btn btn-sm btn-ghost"><?= icon('trash-can') ?> Remove</button></form>
          </div>
        </div>
      <?php endforeach ?>
    </div>

    <form method="post" action="/notifications/list/<?= $id ?>/members" enctype="multipart/form-data" class="node-add">
      <?= csrf_field() ?>
      <h3><span class="chip"><?= icon('plus') ?></span>Add addresses</h3>
      <div class="row g-3">
        <div class="col-md-7"><label class="label" for="addresses">Paste addresses, one per line</label>
          <textarea class="input" id="addresses" name="addresses" rows="5" placeholder="sam@example.com&#10;Sam Rivers &lt;sam@example.com&gt;&#10;Sam Rivers, sam@example.com"></textarea></div>
        <div class="col-md-5"><label class="label" for="file">Or import a CSV or text file</label>
          <input class="input" id="file" name="file" type="file" accept=".csv,.txt,text/csv,text/plain">
          <p class="form-text mb-0">A column of addresses, with names beside them if you have them. A list holds up to <?= MEMBERS_PER_LIST ?> addresses.</p></div>
        <div class="col-12">
          <p class="form-text">Each address is emailed a link and gets nothing more until its owner confirms. Only add people who asked to be on the list.</p>
          <button class="btn btn-primary" data-busy="Sending confirmation emails"><?= icon('plus') ?> Add and ask to confirm</button>
        </div>
      </div>
    </form>
  </div>

  <div class="tab-pane" id="l-settings">
    <form method="post" action="/notifications/list/<?= $id ?>/settings" enctype="multipart/form-data" class="node-add mt-0">
      <?= csrf_field() ?>
      <h3><span class="chip"><?= icon('sliders') ?></span>List settings</h3>
      <div class="row g-3">
        <div class="col-md-6"><label class="label" for="l_name">Name</label>
          <input class="input" id="l_name" name="name" maxlength="60" required value="<?= h($list['name']) ?>">
          <p class="form-text mb-0">The people on the list see this name.</p></div>
        <div class="col-md-6"><label class="label" for="l_digest">Send</label>
          <select class="input" id="l_digest" name="digest" data-switch="digest">
            <option value="now" <?= $list['digest'] === 'now' ? 'selected' : '' ?>>Each update as it happens</option>
            <option value="daily" <?= $list['digest'] === 'daily' ? 'selected' : '' ?>>One email a day</option>
            <option value="weekly" <?= $list['digest'] === 'weekly' ? 'selected' : '' ?>>One email a week</option>
          </select></div>
        <div class="col-md-6" data-when="digest=weekly" <?= $list['digest'] === 'weekly' ? '' : 'hidden' ?>><label class="label" for="l_day">On</label>
          <select class="input" id="l_day" name="digest_day">
            <?php foreach (WEEKDAYS as $d => $label): ?><option value="<?= $d ?>" <?= (int)$list['digest_day'] === $d ? 'selected' : '' ?>><?= $label ?></option><?php endforeach ?>
          </select></div>

        <div class="col-md-6"><label class="label" for="l_send_as">Send as</label>
          <select class="input" id="l_send_as" name="send_as" data-switch="send_as">
            <option value="agenda" <?= $custom ? '' : 'selected' ?>>agenda.delivery</option>
            <option value="custom" <?= $custom ? 'selected' : '' ?>>Custom</option>
          </select>
          <p class="form-text mb-0">Custom puts an organization's name and logo on the list's email.</p></div>
        <div class="col-md-6" data-when="send_as=custom" <?= $custom ? '' : 'hidden' ?>><label class="label" for="l_source">With</label>
          <select class="input" id="l_source" name="brand_source" data-switch="brand_source">
            <option value="account" <?= $list['brand'] === 'list' ? '' : 'selected' ?>>My organization settings</option>
            <option value="list" <?= $list['brand'] === 'list' ? 'selected' : '' ?>>A name and logo for this list</option>
          </select></div>
        <div class="col-12" data-when="send_as=custom" <?= $custom ? '' : 'hidden' ?>>
          <div data-when="brand_source=account" <?= $list['brand'] === 'list' ? 'hidden' : '' ?>>
            <div class="node brand-summary">
              <?php if ($me['logo'] !== ''): ?><img class="logo-thumb" src="/media/<?= h($me['logo']) ?>" alt=""><?php endif ?>
              <div class="node-main">
                <?php if ($me['org_name'] === '' && $me['logo'] === ''): ?>
                  <div class="node-meta">You haven't set an organization name or logo yet. <a href="/settings" data-swap>Add them in Settings</a>, and until then this list sends as agenda.delivery.</div>
                <?php else: ?>
                  <div class="node-title"><?= h($me['org_name'] !== '' ? $me['org_name'] . ' via agenda.delivery' : 'agenda.delivery') ?></div>
                  <div class="node-meta"><?= $me['org_name'] === '' ? 'No organization name set. ' : '' ?><?= $me['logo'] === '' ? 'No logo set. ' : '' ?><a href="/settings" data-swap>Change these in Settings</a></div>
                <?php endif ?>
              </div>
            </div>
          </div>
          <div class="row g-3" data-when="brand_source=list" <?= $list['brand'] === 'list' ? '' : 'hidden' ?>>
            <div class="col-md-6"><label class="label" for="l_sender">Organization name</label>
              <input class="input" id="l_sender" name="sender_name" maxlength="40" placeholder="<?= h($me['org_name'] !== '' ? $me['org_name'] : 'Maple Street Neighbours') ?>" value="<?= h($list['sender_name']) ?>">
              <p class="form-text mb-0">Shown as "Name via agenda.delivery". Left empty, the name in your Settings is used.</p></div>
            <div class="col-md-6"><label class="label" for="l_logo">Logo</label>
              <?php if ($list['logo'] !== ''): ?>
                <div class="logo-current"><img class="logo-thumb" src="/media/<?= h($list['logo']) ?>" alt="">
                  <label class="check"><input type="checkbox" name="remove_logo" value="1"> Remove this logo</label></div>
              <?php endif ?>
              <input class="input" id="l_logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" data-max-kb="500">
              <p class="form-text mb-0">PNG, JPEG or WebP, up to 500 KB and <?= LOGO_MAX_SIDE ?> pixels across. With none, the logo in your Settings is used.</p></div>
            <div class="col-12">
              <?php $accountColours = mail_colours($me['mail_colours']); $inherit = $list['mail_colours'] === '';
                $colours = $inherit ? $accountColours : mail_colours($list['mail_colours']); $listId = $id;
                $previewName = $list['sender_name'] !== '' ? $list['sender_name'] : $me['org_name']; $previewLogo = $list['logo'] !== '' ? $list['logo'] : $me['logo'];
                require __DIR__ . '/_colour_picker.php'; ?>
            </div>
          </div>
        </div>

        <div class="col-12"><label class="check"><input type="checkbox" name="reply_to_owner" value="1" <?= $list['reply_to_owner'] ? 'checked' : '' ?>> Replies come to me at <?= h($me['email']) ?></label>
          <p class="form-text mb-0">Without this, the list's emails have no reply address.</p></div>
        <div class="col-md-6"><label class="label" for="l_intro">Opening text</label>
          <textarea class="input" id="l_intro" name="intro" rows="3" maxlength="1000" placeholder="Here's what's coming up at council."><?= h($list['intro']) ?></textarea></div>
        <div class="col-md-6"><label class="label" for="l_footer">Closing text</label>
          <textarea class="input" id="l_footer" name="footer" rows="3" maxlength="1000" placeholder="Questions? Reply to this email."><?= h($list['footer']) ?></textarea></div>
        <div class="col-12">
          <p class="form-text">Every email ends with who sent it and a link to unsubscribe. The Preview tab shows how one looks.</p>
          <button class="btn btn-primary" data-busy="Saving"><?= icon('check') ?> Save</button>
        </div>
      </div>
    </form>
  </div>

  <div class="tab-pane" id="l-preview">
    <p class="text-muted small prose">How an email from this list looks to someone on it, using a made-up agenda from a made-up city. Send me a test sends you this same email.</p>
    <div class="mail-preview">
      <dl class="mail-head">
        <dt>From</dt><dd><strong><?= h($fromName) ?></strong> &lt;<?= h((string)cfg('mail_from')) ?>&gt;</dd>
        <dt>Reply-To</dt><dd><?= $preview['opt']['reply_to'] !== '' ? h($preview['opt']['reply_to']) : 'None. Replies go nowhere.' ?></dd>
        <dt>Subject</dt><dd><strong><?= h($preview['subject']) ?></strong></dd>
      </dl>
      <?php /* Built by mail_card(), which escapes everything that was typed in. */ ?>
      <div class="mail-body"><?= $preview['card'] ?></div>
    </div>
    <details class="mail-plain">
      <summary>Plain text version</summary>
      <pre><?= h($preview['text']) ?></pre>
    </details>
  </div>
</div>
</div>
</div>
