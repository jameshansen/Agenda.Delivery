<?php
// Email colours: presets, the three colour boxes and a small email that redraws as they change (through
// /settings/colour-preview, so it's the real layout). Takes $colours (the current three), $accountColours (what the
// account's Settings have), $inherit (a list using the account's colours; null in Settings, where there's no such box)
// and $listId (0 in Settings).
$inheritBox = $inherit !== null;
?>
<div class="colour-picker" data-colour-picker data-list="<?= (int)$listId ?>" data-account="<?= h(implode(',', $accountColours)) ?>">
  <span class="label"><?= icon('palette') ?> Colours</span>
  <?php if ($inheritBox): ?>
    <label class="check mb-2"><input type="checkbox" name="colours_inherit" value="1" <?= $inherit ? 'checked' : '' ?>> Use the colours from my Settings</label>
  <?php endif ?>
  <div class="colour-presets">
    <?php foreach (colour_presets() as $key => [$name, $fg, $bg1, $bg2]): ?>
      <button type="button" class="colour-preset" data-preset="<?= h("$fg,$bg1,$bg2") ?>">
        <span class="colour-swatch" style="background:<?= h($bg1) ?>"><i style="background:<?= h($fg) ?>"></i><i style="background:<?= h($bg2) ?>"></i></span><?= h($name) ?>
      </button>
    <?php endforeach ?>
  </div>
  <div class="colour-inputs">
    <?php foreach (['fg' => 'Foreground', 'bg1' => 'Background 1', 'bg2' => 'Background 2'] as $k => $label): ?>
      <label class="colour-input"><input type="color" name="colour_<?= $k ?>" value="<?= h($colours[$k]) ?>"> <?= $label ?></label>
    <?php endforeach ?>
  </div>
  <p class="form-text">The foreground colours the name, label, button and links. Background 1 is the page around the email and background 2 the band at the bottom.</p>
  <div class="colour-preview" data-colour-preview><?= colour_preview($colours, $previewName, $previewLogo) ?></div>
</div>
