<?php
// The Notifications tabs, each with its own address. On the Notifications page ($panes true) a tab opens its pane
// without loading anything; on a mailing list's page the tabs are links back, with Mailing lists marked.
// Takes $tab, the one that's open.
$panes = $panes ?? false;
$notifyTabs = [
    'destinations' => ['/notifications', 'paper-plane', 'Destinations'],
    'lists'        => ['/notifications/lists', 'users', 'Mailing lists'],
    'rules'        => ['/notifications/sent', 'bell', "What's sent"],
    'history'      => ['/notifications/history', 'clock-rotate-left', 'History'],
];
?>
<nav class="nav nav-tabs" aria-label="Notifications">
  <?php foreach ($notifyTabs as $key => [$url, $ico, $label]): ?>
    <a class="nav-link <?= $tab === $key ? 'active' : '' ?>" href="<?= $url ?>" <?= $panes ? 'data-tab="#n-' . $key . '" data-url="' . $url . '"' : 'data-swap' ?> <?= $tab === $key ? 'aria-current="page"' : '' ?>><?= icon($ico) ?> <?= $label ?></a>
  <?php endforeach ?>
</nav>
