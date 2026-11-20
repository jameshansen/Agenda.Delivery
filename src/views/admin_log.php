<?php $title = "Log: $slug"; ?>
<ol class="breadcrumb"><li><a href="/admin">Admin</a></li><li><?= h($slug) ?> gateway log</li></ol>
<?php if ($log === null): ?>
  <div class="alert alert-warning">The agenda delivery service isn't answering, so the log can't be read.</div>
<?php elseif (isset($log['error'])): ?>
  <div class="alert alert-warning">The service has no running gateway for <?= h($slug) ?>.</div>
<?php else: ?>
  <p class="small text-muted">The last <?= count($log['lines']) ?> lines of the gateway's output, newest last. <a href="">Refresh</a></p>
  <pre class="node small" style="white-space:pre-wrap;max-height:70vh;overflow:auto"><?= h(implode("\n", $log['lines'])) ?></pre>
<?php endif ?>
