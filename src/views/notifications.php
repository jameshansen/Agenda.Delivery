<?php
$title = 'Notifications';
$tab = $tab ?? 'destinations';
$panel = 'notifications';
$kinds = destination_kinds();
$lists = array_values(array_filter($targets, fn($t) => $t['kind'] === 'list'));
$others = array_values(array_filter($targets, fn($t) => $t['kind'] !== 'list'));
$plural = fn(int $n, string $one, string $many) => "$n " . ($n === 1 ? $one : $many);
$stateLabels = ['sent' => 'Sent', 'quiet' => 'Nothing matched', 'queued' => 'In the next roundup', 'skipped' => 'Not sent', 'failed' => 'Failed'];
$stateColours = ['sent' => 'var(--o-mint)', 'quiet' => 'var(--o-secondary)', 'queued' => 'var(--o-blue)', 'skipped' => 'var(--o-yellow)', 'failed' => 'var(--o-red)'];
$quiet = array_filter($monitors, fn($m) => !in_array($m['name'], array_column($rules, 'monitor'), true));

// Pause or resume, the same button on every destination.
$pauseButton = function (array $t) {
    ob_start(); ?>
    <form method="post" action="/notifications/<?= (int)$t['id'] ?>/<?= $t['paused'] ? 'resume' : 'pause' ?>"><?= csrf_field() ?>
      <button class="btn btn-sm"><?= $t['paused'] ? icon('play') . ' Resume' : icon('pause') . ' Pause' ?></button></form>
    <?php return ob_get_clean();
};
?>
<?php $panes = true; require __DIR__ . '/_notify_tabs.php'; ?>

<div>
  <div class="tab-pane <?= $tab === 'destinations' ? 'active' : '' ?>" id="n-destinations">
    <p class="text-muted small"><?= icon('circle-info') ?> A destination is a place agenda.delivery delivers updates from your monitors, like summaries of new agendas and meeting videos and changes to pending items. It can be an email address, a mailing list, a Discord channel, a WhatsApp group, your phone through Pushover or a webhook. Your own email address is always one of them, and once you've added others you can choose under What's sent which monitors send to each one and what they send.</p>
    <div class="nodes">
      <?php foreach ($others as $t): [$kindLabel, $kindIcon, $kindColour] = $kinds[$t['kind']] ?? [$t['kind'], '', 'var(--o-secondary)']; ?>
        <div class="node has-edit <?= $t['paused'] || !$t['confirmed'] ? 'is-quiet' : '' ?>" style="--c:<?= $kindColour ?>">
          <div class="node-main">
            <div class="node-title"><?= $kindIcon ?><?= h($t['name']) ?> <span class="badge ms-2"><?= h($kindLabel) ?></span>
              <?php if ($t['is_default']): ?><span class="badge badge-info">Default</span><?php endif ?>
              <?php if ($t['paused']): ?><span class="badge badge-warning">Paused</span><?php endif ?>
              <?php if (!$t['confirmed']): ?><span class="badge badge-warning"><?= $t['blocked'] ? 'Unsubscribed' : 'Waiting to confirm' ?></span><?php endif ?></div>
            <div class="node-meta">
              <?= h($t['kind'] === 'whatsapp' ? ($t['address'] !== '' ? 'Sends to ' . ($t['wa_group'] !== '' ? $t['wa_group'] : 'a group') : 'No group chosen yet') : ($t['kind'] === 'email' ? $t['address'] : ($t['kind'] === 'pushover' ? 'User key ' . substr($t['address'], 0, 4) . '…' . substr($t['address'], -3) . ($t['token'] !== '' ? ', own app token' : '') : preg_replace('#(/api/webhooks/\d+/).+#', '$1…', $t['address'])))) ?>
              <?php if (in_array($t['kind'], ['email', 'list'], true)): ?>· <?= h(digest_label($t)) ?><?php endif ?>
              · used by <?= $plural((int)$t['uses'], 'notification', 'notifications') ?>
              <?php if ($t['waiting']): ?>· <?= $plural((int)$t['waiting'], 'update', 'updates') ?> waiting for the next roundup<?php endif ?>
              <?php if ($t['last_sent']): ?>· last sent <?= h(ago($t['last_sent'])) ?><?php endif ?>
            </div>
          </div>
          <div class="node-actions">
            <form method="post" action="/notifications/<?= (int)$t['id'] ?>/test"><?= csrf_field() ?>
              <?php if ($t['confirmed']): ?><button class="btn btn-sm" data-busy="Sending"><?= icon('paper-plane') ?> Send a test</button>
              <?php elseif (!$t['blocked']): ?><button class="btn btn-sm" data-busy="Sending"><?= icon('rotate') ?> Send the link again</button><?php endif ?></form>
            <?= $pauseButton($t) ?>
            <?php if (!$t['is_default']): ?>
              <form method="post" action="/notifications/<?= (int)$t['id'] ?>/delete" onsubmit="return confirm('Remove this destination and every notification that uses it?')"><?= csrf_field() ?><button class="btn btn-sm btn-ghost"><?= icon('trash-can') ?> Remove</button></form>
            <?php endif ?>
          </div>
          <?php if ($t['kind'] === 'whatsapp'): ?><div class="node-edit wa-holder"><?= wa_panel($t) ?></div><?php endif ?>
          <form method="post" action="/notifications/<?= (int)$t['id'] ?>/edit" class="node-edit node-settings">
            <?= csrf_field() ?>
            <div class="row g-3">
              <div class="col-md-4"><label class="label" for="name-<?= (int)$t['id'] ?>">Name</label>
                <input class="input" id="name-<?= (int)$t['id'] ?>" name="name" maxlength="80" required value="<?= h($t['name']) ?>"></div>
              <?php if ($t['kind'] === 'email'): ?>
                <div class="col-md-4"><label class="label" for="digest-<?= (int)$t['id'] ?>">Send</label>
                  <select class="input" id="digest-<?= (int)$t['id'] ?>" name="digest" data-switch="digest">
                    <option value="now" <?= $t['digest'] === 'now' ? 'selected' : '' ?>>Each update as it happens</option>
                    <option value="daily" <?= $t['digest'] === 'daily' ? 'selected' : '' ?>>Daily roundup, only when there's news</option>
                    <option value="weekly" <?= $t['digest'] === 'weekly' ? 'selected' : '' ?>>Weekly roundup, only when there's news</option>
                  </select></div>
                <div class="col-md-4" data-when="digest=weekly" <?= $t['digest'] === 'weekly' ? '' : 'hidden' ?>><label class="label" for="day-<?= (int)$t['id'] ?>">On</label>
                  <select class="input" id="day-<?= (int)$t['id'] ?>" name="digest_day">
                    <?php foreach (WEEKDAYS as $d => $label): ?><option value="<?= $d ?>" <?= (int)$t['digest_day'] === $d ? 'selected' : '' ?>><?= $label ?></option><?php endforeach ?>
                  </select></div>
              <?php endif ?>
              <?php if ($t['kind'] === 'whatsapp'): $groups = $t['wa_state'] === 'open' ? (wa_call((int)$t['id'], 'GET', '/groups', null, 6)[1] ?? []) : []; ?>
                <div class="col-md-6"><label class="label" for="group-<?= (int)$t['id'] ?>">Send to group</label>
                  <select class="input" id="group-<?= (int)$t['id'] ?>" name="group" <?= $groups ? '' : 'disabled' ?>>
                    <?php if (!$groups): ?><option value=""><?= $t['wa_state'] === 'open' ? 'This account is in no groups yet' : 'Link WhatsApp to choose one of its groups' ?></option>
                    <?php else: ?><option value="" <?= $t['address'] === '' ? 'selected' : '' ?> disabled>Choose a group</option>
                      <?php foreach ($groups as $g): ?><option value="<?= h($g['id']) ?>" <?= $g['id'] === $t['address'] ? 'selected' : '' ?>><?= h($g['name']) ?> (<?= (int)$g['size'] ?>)</option><?php endforeach ?>
                    <?php endif ?>
                  </select>
                  <p class="form-text mb-0">Only groups. Everyone in the group sees the updates.</p></div>
              <?php endif ?>
              <div class="col-auto align-self-end"><button class="btn btn-primary btn-sm" data-busy="Saving"><?= icon('check') ?> Save</button></div>
            </div>
          </form>
        </div>
      <?php endforeach ?>
    </div>

    <form method="post" action="/notifications" class="node-add">
      <?= csrf_field() ?>
      <h3><span class="chip"><?= icon('plus') ?></span>Add a destination</h3>
      <div class="row g-3">
        <div class="col-md-3"><label class="label" for="dest_kind">Type</label>
          <select class="input" id="dest_kind" name="kind" data-switch="kind">
            <option value="email">Email address</option>
            <option value="discord">Discord channel</option>
            <option value="pushover">Pushover (phone)</option>
            <?php if (whatsapp_available()): ?><option value="whatsapp">WhatsApp</option><?php endif ?>
            <option value="webhook">Webhook</option>
          </select></div>
        <div class="col-md-3"><label class="label" for="dest_name">Name</label><input class="input" id="dest_name" name="name" maxlength="80" placeholder="Council channel"></div>
        <div class="col-md-6">
          <label class="label" for="dest_address">
            <span data-when="kind=email">Email address</span><span data-when="kind=discord" hidden>Discord webhook URL</span><span data-when="kind=webhook" hidden>Webhook URL</span><span data-when="kind=pushover" hidden>User key</span><span data-when="kind=whatsapp" hidden>Linking</span>
          </label>
          <input class="input" id="dest_address" name="address" autocomplete="off" data-when="kind=email discord webhook pushover">
          <p class="form-text mb-0" data-when="kind=whatsapp" hidden>Add it, scan the code that appears with the phone, then choose one of its groups.</p>
          <div class="mt-3" data-when="kind=pushover" hidden><label class="label" for="dest_token">App token<?= cfg('pushover_token') ? ' <span class="text-muted">(optional)</span>' : '' ?></label>
            <input class="input" id="dest_token" name="token" maxlength="30" autocomplete="off"></div>
        </div>
        <div class="col-12">
          <p class="form-text" data-when="kind=email">An address that isn't yours is sent a link first, and gets notifications once its owner confirms. For a group of people, make a mailing list.</p>
          <p class="form-text" data-when="kind=discord" hidden>Discord is a chat app for communities. A webhook lets agenda.delivery post into one of your server's channels: make one under the channel's settings, Integrations, Webhooks, and paste its URL here. <a href="https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks" target="_blank" rel="noopener">Discord's guide to webhooks</a></p>
          <p class="form-text" data-when="kind=whatsapp" hidden>Sends each update as a WhatsApp message to a group, from a WhatsApp account you link by scanning a code, as with WhatsApp Web. Once it is linked, choose which of its groups gets the updates. Only groups can be sent to. agenda.delivery links as an unofficial device, which WhatsApp may restrict, so a spare number is safest. If the link drops, we email you. <a href="https://faq.whatsapp.com/1317564962315842" target="_blank" rel="noopener">WhatsApp's guide to linked devices</a></p>
          <p class="form-text" data-when="kind=pushover" hidden>Pushover sends notifications straight to your phone, tablet or desktop through its app. Paste your user key from the top of your Pushover dashboard. <?= cfg('pushover_token') ? "Updates come from agenda.delivery's Pushover app, or paste an app token of your own to use yours." : 'Also paste an app token: make an application at pushover.net and copy its token.' ?> <a href="https://pushover.net/" target="_blank" rel="noopener">What Pushover is</a> · <a href="https://pushover.net/api#registration" target="_blank" rel="noopener">Making an app token</a></p>
          <p class="form-text" data-when="kind=webhook" hidden>A webhook receives a JSON POST with <code>subject</code>, <code>text</code>, <code>url</code>, <code>event</code> and <code>monitor</code>. It needs an https address.</p>
          <button class="btn btn-primary" data-busy="Adding"><?= icon('plus') ?> Add destination</button>
        </div>
      </div>
    </form>
  </div>

  <div class="tab-pane <?= $tab === 'lists' ? 'active' : '' ?>" id="n-lists">
    <div class="lists-layout">
      <?php $current = 0; require __DIR__ . '/_list_rail.php'; ?>
      <div class="list-detail">
        <div class="node-empty">
          <p class="mb-2"><?= icon('users') ?> A mailing list is a group of email addresses that gets a monitor's news as one destination. Each address confirms before anything is sent to it, and every email has a link to unsubscribe.</p>
          <p class="mb-0"><?= $lists ? 'Choose a list on the left to see its addresses, settings and a preview of its email.' : 'Start one on the left, then add its addresses.' ?></p>
        </div>
      </div>
    </div>
  </div>

  <div class="tab-pane <?= $tab === 'rules' ? 'active' : '' ?>" id="n-rules">
    <p class="text-muted small"><?= icon('circle-info') ?> Each line is one notification: a monitor, where its news goes, and what's sent. A new monitor starts by sending its summaries to your email.</p>
    <div class="nodes">
      <?php if (!$monitors): ?>
        <div class="node-empty">Nothing to send yet. <a href="/">Add a monitor</a> and its news comes to your email.</div>
      <?php elseif (!$rules): ?>
        <div class="node-empty">Your monitors aren't sending anything. Add a notification below.</div>
      <?php endif ?>
      <?php foreach ($rules as $r): [, $kindIcon, $kindColour] = $kinds[$r['target_kind']] ?? ['', '', 'var(--o-secondary)']; ?>
        <div class="node <?= $r['paused'] || !$r['confirmed'] ? 'is-quiet' : '' ?>" style="--c:<?= $kindColour ?>">
          <div class="node-main">
            <div class="node-title"><?= icon('building-columns') ?><a href="<?= h(monitor_url(['num' => $r['num'], 'name' => $r['monitor']])) ?>#t-notify"><?= h($r['monitor']) ?></a>
              <span class="to"><?= icon('arrow-right') ?></span><?= $kindIcon ?><?= h($r['target_name']) ?>
              <?php if ($r['paused']): ?><span class="badge badge-warning ms-2">Paused</span><?php endif ?>
              <?php if (!$r['confirmed']): ?><span class="badge badge-warning ms-2">Not confirmed yet</span><?php endif ?></div>
            <div class="node-meta"><?= h(rule_label($r)) ?></div>
          </div>
          <div class="node-actions">
            <form method="post" action="/notifications/rule/<?= (int)$r['id'] ?>/delete"><?= csrf_field() ?><button class="btn btn-sm btn-ghost"><?= icon('trash-can') ?> Remove</button></form>
          </div>
        </div>
      <?php endforeach ?>
      <?php if ($rules && $quiet): ?>
        <div class="node-empty"><?= h(implode(', ', array_column($quiet, 'name'))) ?> <?= count($quiet) === 1 ? "isn't" : "aren't" ?> sending anything.</div>
      <?php endif ?>
    </div>
    <?php if ($monitors): $ruleAction = '/notifications/rule'; $ruleMonitors = $monitors; require __DIR__ . '/_rule_form.php'; endif ?>
  </div>

  <div class="tab-pane <?= $tab === 'history' ? 'active' : '' ?>" id="n-history">
    <p class="text-muted small"><?= icon('circle-info') ?> What your monitors had to say lately, and what became of each.</p>
    <div class="nodes">
      <?php if (!$history): ?><div class="node-empty">Nothing yet. This fills in as your monitors find new agendas, videos and pending items.</div><?php endif ?>
      <?php foreach ($history as $d): ?>
        <div class="node node-compact" style="--c:<?= $stateColours[$d['state']] ?? 'var(--o-secondary)' ?>">
          <div class="node-main">
            <div class="node-title"><?= h($d['title']) ?></div>
            <div class="node-meta"><?= h($d['monitor']) ?> · <?= ['agenda' => 'agenda', 'video' => 'video', 'pending' => 'pending item'][$d['event_kind']] ?? 'update' ?>
              · to <?= h($d['target_name']) ?> · <?= h(ago($d['sent_at'])) ?>
              <?php if ($d['error'] !== ''): ?>· <?= h($d['error']) ?><?php endif ?></div>
          </div>
          <div class="node-actions"><span class="badge <?= $d['state'] === 'failed' ? 'badge-danger' : ($d['state'] === 'sent' ? 'badge-success' : '') ?>">
            <?= h($stateLabels[$d['state']] ?? $d['state']) ?><?= $d['state'] === 'sent' && $d['target_kind'] === 'list' ? ' to ' . (int)$d['recipients'] : '' ?></span></div>
        </div>
      <?php endforeach ?>
    </div>
  </div>
</div>
