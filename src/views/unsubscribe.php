<?php
$title = 'Unsubscribe';
$from = $s ? ($s['type'] === 'member' ? $s['list'] . ', a mailing list run by ' . $s['owner'] : 'notifications from ' . $s['owner']) : '';
?>
<div class="container-narrow" style="max-width:30rem">
  <h1>Unsubscribe</h1>
<?php if ($token === 'sample'): ?>
  <p>This is the sample link from a test email, so there's nothing to unsubscribe. In a real email, each address on the list gets a link of its own here.</p>
<?php elseif (!$s): ?>
  <p>That link isn't one we know. It may have been removed already, in which case nothing more is being sent.</p>
<?php elseif ($s['blocked']): ?>
  <p><?= $did ? 'Done. ' : '' ?><strong><?= h($s['email']) ?></strong> is unsubscribed from <?= h($from) ?>, and nobody can add it back but you.</p>
  <form method="post" action="/unsubscribe">
    <?= csrf_field() ?>
    <input type="hidden" name="u" value="<?= h($token) ?>">
    <input type="hidden" name="do" value="resubscribe">
    <p class="text-muted small">Unsubscribed by mistake?</p>
    <button class="btn"><?= icon('rotate-left') ?> Subscribe again</button>
  </form>
<?php else: ?>
  <?php if ($did === 'resubscribed'): ?><p>Done. <strong><?= h($s['email']) ?></strong> is subscribed again.</p><?php endif ?>
  <p class="text-muted"><strong><?= h($s['email']) ?></strong> is signed up for <?= h($from) ?> on agenda.delivery.</p>
  <form method="post" action="/unsubscribe" class="vstack g-3">
    <?= csrf_field() ?>
    <input type="hidden" name="u" value="<?= h($token) ?>">
    <label class="check"><input type="checkbox" name="everything" value="1"> Also stop mail from every other agenda.delivery account</label>
    <button class="btn btn-primary btn-block"><?= icon('bell-slash') ?> Unsubscribe</button>
  </form>
<?php endif ?>
</div>
