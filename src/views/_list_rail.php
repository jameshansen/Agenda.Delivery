<?php
// The account's mailing lists down the left of the Mailing lists tab, with a box to start a new one under them.
// Opening a list swaps it in on the right. Takes $lists, and $current, the open list's id (0 for none).
$current = $current ?? 0;
?>
<aside class="list-rail" aria-label="Mailing lists">
  <nav class="list-rail-items">
    <?php if (!$lists): ?><p class="small text-muted mb-0">No lists yet.</p><?php endif ?>
    <?php foreach ($lists as $l): ?>
      <a class="list-rail-item <?= (int)$l['id'] === $current ? 'active' : '' ?>" href="/notifications/list/<?= (int)$l['id'] ?>" data-swap
         <?= (int)$l['id'] === $current ? 'aria-current="page"' : '' ?>>
        <span class="list-rail-name"><?= icon('users') ?><?= h($l['name']) ?></span>
        <span class="list-rail-meta"><?= (int)$l['active'] ?> confirmed<?= $l['pending'] ? ' · ' . (int)$l['pending'] . ' waiting' : '' ?><?= $l['paused'] ? ' · paused' : '' ?></span>
      </a>
    <?php endforeach ?>
  </nav>
  <form method="post" action="/notifications/lists" class="list-rail-new">
    <?= csrf_field() ?>
    <label class="label small" for="list_name"><?= icon('plus') ?> New list</label>
    <input class="input" id="list_name" name="name" maxlength="60" required placeholder="Neighbours">
    <button class="btn btn-sm btn-primary btn-block"><?= icon('plus') ?> Create list</button>
  </form>
</aside>
