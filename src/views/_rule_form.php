<?php
// The "Add a notification" form, on the Notifications page (with a monitor to pick) and on each monitor's own tab.
// Takes $ruleAction, $targets and $ruleMonitors (null on a monitor's page).
?>
<form method="post" action="<?= h($ruleAction) ?>" class="node-add">
  <?= csrf_field() ?>
  <h3><span class="chip" style="--c:var(--o-blue)"><?= icon('bell') ?></span>Add a notification</h3>
  <div class="row g-3">
    <?php if ($ruleMonitors !== null): ?>
      <div class="col-md-6"><label class="label" for="rule_monitor">When this monitor has news</label>
        <select class="input" id="rule_monitor" name="monitor">
          <?php foreach ($ruleMonitors as $mon): ?><option value="<?= (int)$mon['num'] ?>"><?= h($mon['name']) ?></option><?php endforeach ?>
          <?php if (count($ruleMonitors) > 1): ?><option value="all">All my monitors</option><?php endif ?>
        </select></div>
    <?php endif ?>
    <div class="col-md-6"><label class="label" for="rule_target">Send it to</label>
      <select class="input" id="rule_target" name="target_id">
        <?php foreach ($targets as $t): ?>
          <option value="<?= (int)$t['id'] ?>"><?= h($t['name']) ?> (<?= h(destination_kinds()[$t['kind']][0] ?? $t['kind']) ?><?= $t['paused'] ? ', paused' : '' ?><?= !$t['confirmed'] ? ', not confirmed yet' : '' ?>)</option>
        <?php endforeach ?>
      </select></div>
    <div class="col-md-6"><label class="label" for="rule_content">What to send</label>
      <select class="input" id="rule_content" name="content" data-switch="content">
        <option value="summary">The summary</option>
        <option value="link">Just the link</option>
        <option value="keywords">Only the lines that match my keywords</option>
        <option value="prompt">The answer to my own prompt</option>
      </select></div>
    <div class="col-md-6"><span class="label">About</span>
      <div class="hstack" style="flex-wrap:wrap;min-height:2.6rem">
        <?php foreach (['agenda' => 'Agendas', 'video' => 'Videos', 'pending' => 'Pending items'] as $k => $label): ?>
          <label class="check"><input type="checkbox" name="events[]" value="<?= $k ?>" checked> <?= $label ?></label>
        <?php endforeach ?>
      </div></div>
    <div class="col-12" data-when="content=keywords" hidden><label class="label" for="rule_keywords">Keywords</label>
      <input class="input" id="rule_keywords" name="keywords" maxlength="500" placeholder="bike lane, rezoning, Main Street">
      <p class="form-text mb-0">Separate them with commas. A notification goes out only when an agenda or transcript mentions one, with the sentences that do.</p></div>
    <div class="col-12" data-when="content=prompt" hidden><label class="label" for="rule_prompt">Prompt</label>
      <textarea class="input" id="rule_prompt" name="prompt" rows="2" maxlength="1000" placeholder="Tell me about anything affecting housing near the town centre."></textarea>
      <p class="form-text mb-0">Asked of every new agenda and transcript. A notification goes out only when there's something to say.</p></div>
    <div class="col-12"><button class="btn btn-primary" data-busy="Adding"><?= icon('plus') ?> Add notification</button></div>
  </div>
</form>
