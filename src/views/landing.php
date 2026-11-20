<?php
// The front page: sign-in first, in the same panel as the rest of the site, with what it does beside it.
// /about is this panel with its About tab open; signed in, the tab beside it goes back to your monitors.
$member = member_session($me);
$tab = ($tab ?? '') === 'about' || $member ? 'about' : 'signin';
$title = $tab === 'about' ? 'About' : '';
$next = '/';
?>
<section class="card panel">
  <div class="panel-head">
    <nav class="nav nav-tabs" aria-label="Sections">
      <?php if ($member): ?>
      <a class="nav-link" href="/"><?= icon('magnifying-glass') ?> Monitors</a>
      <?php else: ?>
      <button class="nav-link <?= $tab === 'signin' ? 'active' : '' ?>" data-tab="#l-signin" data-url="/" data-title="agenda.delivery" role="tab"><?= icon('right-to-bracket') ?> Sign in</button>
      <?php endif ?>
      <button class="nav-link <?= $tab === 'about' ? 'active' : '' ?>" data-tab="#l-about" data-url="/about" data-title="About · agenda.delivery" role="tab"><?= icon('circle-info') ?> About</button>
    </nav>
  </div>
  <div class="panel-body">
    <div class="tab-pane <?= $tab === 'about' ? 'active' : '' ?>" id="l-about"><?php require __DIR__ . '/about_body.php'; ?></div>
    <?php if (!$member): ?>
    <div class="tab-pane <?= $tab === 'signin' ? 'active' : '' ?>" id="l-signin">
    <div class="row g-4">
      <div class="col-lg-5">
        <form method="post" action="/login" class="node-add mt-0">
          <?= csrf_field() ?>
          <input type="hidden" name="next" value="<?= h($next) ?>">
          <h3><span class="chip"><?= icon('key') ?></span>Sign in to agenda.delivery</h3>
          <p class="small mb-3"><?= icon('robot') ?> Your own AI agent reads each organization's agendas and meeting videos, and sends you a plain language summary of what's coming up.</p>
          <?php if (!empty($error)): ?><div class="alert alert-danger"><?= h($error) ?></div><?php endif ?>
          <div class="vstack g-3">
            <div><label class="label" for="email">Email</label>
              <input class="input" type="email" id="email" name="email" required autocomplete="email" autofocus value="<?= h($_POST['email'] ?? '') ?>"></div>
            <button class="btn btn-primary btn-block"><?= icon('arrow-right') ?> Continue</button>
            <?php if (cfg('google_id')): ?>
              <a class="btn btn-block" href="/auth/google?next=<?= h(urlencode($next)) ?>"><?= icon('google', 'brands') ?> Continue with Google</a>
            <?php endif ?>
            <p class="form-text mb-0">No password. If you have an account, we email you a six-digit code. If you're new, you'll join with a sign-up code or a short registration we approve, and it's free.</p>
          </div>
        </form>
      </div>

      <div class="col-lg-7 prose">
        <h2 class="section-title"><span class="chip" style="--c:var(--o-mint)"><?= icon('eye') ?></span>What it does</h2>
        <p>agenda.delivery watches the public meetings of councils, school boards and other organizations. For each one you add, an AI agent reads new agendas and meeting video transcripts, writes a plain language summary of each, and keeps a list of the items still in progress, like a bylaw between readings or a motion waiting on a staff report.</p>

        <h2 class="section-title"><span class="chip" style="--c:var(--o-blue)"><?= icon('gears') ?></span>How it works</h2>
        <ol class="steps-plain">
          <li>Sign in with your email or Google.</li>
          <li>Paste in the organization's website, and an AI agent finds the page where it posts its agendas and its videos or YouTube channel, or give it those pages yourself. If someone else already follows it, your AI agent starts with what theirs has learned about the site.</li>
          <li>Add where updates should go, an email address, a Discord channel or a webhook, and choose for each organization whether you get the summary, just the link, the parts that match your keywords, or the answer to your own question.</li>
        </ol>

        <h2 class="section-title"><span class="chip" style="--c:var(--o-yellow)"><?= icon('people-group') ?></span>Who it's for</h2>
        <p>Residents keeping an eye on their own council, community groups that need to know when there's a chance to speak, and organizations that want their members to hear about decisions before they're made.</p>
        <p class="small"><a href="/about"><?= icon('arrow-right') ?> More about the project</a></p>
      </div>
    </div>
    </div>
    <?php endif ?>
  </div>
</section>
