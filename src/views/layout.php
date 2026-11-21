<!doctype html>
<html lang="en" data-theme="<?= ($me['theme'] ?? 'light') === 'dark' ? 'dark' : 'light' ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title><?= h(($title ?? '') ? "$title · agenda.delivery" : 'agenda.delivery') ?></title>
<link rel="icon" href="/icon-64.png">
<link rel="apple-touch-icon" href="/icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400..700&display=swap">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/fontawesome.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/solid.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/brands.min.css">
<!-- Each file's modified time in its address, so a deploy never leaves a browser on an old copy. -->
<link rel="stylesheet" href="/opalite.css?v=<?= @filemtime(__DIR__ . '/../../public/opalite.css') ?>">
<link rel="stylesheet" href="/app.css?v=<?= @filemtime(__DIR__ . '/../../public/app.css') ?>">
<?= $head ?? '' ?>
<script>
// The theme comes from the account's Settings; Opalite would otherwise restore a choice saved in this browser.
try { localStorage.removeItem('opaliteTheme'); } catch (e) {}
</script>
<script defer src="/opalite.js?v=<?= @filemtime(__DIR__ . '/../../public/opalite.js') ?>"></script>
<!-- Without scripts nothing can reveal the parts of a form that depend on a choice, so they all show. -->
<noscript><style>[data-when][hidden]{display:block!important}</style></noscript>
</head>
<body>
<div class="container page">
  <nav class="navbar">
    <a class="navbar-brand" href="/"><img src="/icon-64.png" alt="" width="28" height="28">agenda.delivery</a>
    <ul class="navbar-nav navbar-nav-open">
      <li><a class="nav-link" href="/about"><?= icon('circle-info') ?> About</a></li>
      <?php if (!$me): ?><li><a class="btn btn-sm btn-dark" href="/login"><?= icon('right-to-bracket') ?> Sign in</a></li><?php endif ?>
    </ul>
  </nav>

  <?php if ($f = flash()): ?>
    <div class="alert alert-<?= h($f[1]) ?> mt-3"><?= h($f[0]) ?><button class="btn-close" data-dismiss aria-label="Close"></button></div>
  <?php endif ?>

  <main class="py-4">
    <?php if (!empty($panel) && $me): ?>
      <section class="card panel" data-section="<?= h($panel) ?>">
        <div class="panel-head">
          <nav class="nav nav-tabs" aria-label="Sections">
            <?php foreach (['monitors' => ['Monitors', '/', 'magnifying-glass'], 'notifications' => ['Notifications', '/notifications', 'bell'], 'voices' => ['Voices', '/voices', 'head-side-cough'], 'settings' => ['Settings', '/settings', 'gear']] as $key => [$label, $href, $ico]): ?>
              <a class="nav-link <?= $panel === $key ? 'active' : '' ?>" href="<?= $href ?>" <?= $panel === $key ? 'aria-current="page"' : '' ?>><?= icon($ico) ?> <?= $label ?></a>
            <?php endforeach ?>
          </nav>
        </div>
        <div class="panel-body"><?= $content ?></div>
      </section>
    <?php else: ?>
      <?= $content ?>
    <?php endif ?>
  </main>

  <footer class="site-footer">
    <a class="navbar-brand" href="/"><img src="/icon-64.png" alt="" width="28" height="28">agenda.delivery</a>
    <nav class="footer-links" aria-label="Footer">
      <?php if (member_session($me)): ?>
        <a href="/"><?= icon('magnifying-glass') ?> Monitors</a>
        <a href="/notifications"><?= icon('bell') ?> Notifications</a>
        <a href="/voices"><?= icon('head-side-cough') ?> Voices</a>
        <a href="/settings"><?= icon('gear') ?> Settings</a>
      <?php elseif (!$me): ?>
        <a href="/login"><?= icon('right-to-bracket') ?> Sign in</a>
      <?php endif ?>
      <a href="/about"><?= icon('circle-info') ?> About</a>
      <a href="/report"><?= icon('flag') ?> Report a problem</a>
      <a href="https://github.com/jameshansen/Agenda.Delivery"><?= icon('github', 'brands') ?> Source</a>
    </nav>
  </footer>
</div>
<script>
// Reopen the tab a form came from, such as /m/slug#t-notify.
addEventListener('DOMContentLoaded', () => document.querySelector(`[data-tab="${location.hash}"]`)?.click());

// Tabs never reload the page. A tab with data-url (Sign in, About) shows its pane and puts its address in the bar;
// a link to that address anywhere on the page opens the tab instead. The section tabs (Monitors, Notifications,
// Settings) and links marked data-swap (into a mailing list and back out) fetch the page and swap it in.
// Anything unexpected falls back to loading the page normally.
const tabFor = path => document.querySelector(`[data-tab][data-url="${path}"]`);
document.addEventListener('click', async e => {
  if (e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const urlTab = e.target.closest('[data-tab][data-url]');
  if (urlTab) { if (urlTab.tagName === 'A') e.preventDefault(); if (location.pathname !== urlTab.dataset.url) history.pushState({}, '', urlTab.dataset.url); if (urlTab.dataset.title) document.title = urlTab.dataset.title; return; }
  const a = e.target.closest('a[href]');
  if (!a || a.origin !== location.origin || a.target) return;
  const tab = tabFor(a.pathname);
  if (tab) { e.preventDefault(); tab.click(); scrollTo({ top: 0 }); return; }
  if (!a.closest('.panel-head') && !a.hasAttribute('data-swap')) return;
  e.preventDefault();
  if (await swapTo(a.href)) history.pushState({}, '', a.href); else location.href = a.href;
}, true);
addEventListener('popstate', async () => {
  const tab = tabFor(location.pathname);
  if (tab) return tab.click();
  if (!(await swapTo(location.href))) location.reload();
});
// "Fill from the organization's website": runs the scan, shows each step it reports, then fills the add-monitor form.
// Listening on the document, since the form can arrive by a tab swap, where its own scripts wouldn't run.
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'scan_url') { e.preventDefault(); document.getElementById('scan_go').click(); }
});
document.addEventListener('click', async e => {
  const go = e.target.closest('#scan_go');
  if (!go || go.disabled) return;
  const form = go.closest('form'), input = document.getElementById('scan_url'), status = document.getElementById('scan_status');
  const show = (text, kind = '') => { status.textContent = text; status.dataset.kind = kind; };
  if (!input.value.trim()) return input.focus();
  go.disabled = true;
  show('Starting the scan', 'busy');
  const body = new FormData();
  body.append('csrf', form.querySelector('[name=csrf]').value);
  body.append('url', input.value.trim());
  try {
    const r = await fetch('/monitors/scan', { method: 'POST', body, credentials: 'same-origin' });
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '', finished = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).replace(/^data: /, ''); buf = buf.slice(i + 2);
        const m = JSON.parse(line);
        if (m.say) show(m.say, 'busy');
        if (m.error) { show(m.error, 'error'); finished = true; }
        if (m.done) {
          for (const [k, v] of Object.entries(m.done)) { const f = form.elements[k]; if (f && v) f.value = v; }
          show(m.done.agenda_url ? 'Done. Check the details below, then press Add and set up.' : "Couldn't find the meetings page. Paste it into Agenda page below.", m.done.agenda_url ? 'ok' : 'error');
          finished = true;
        }
      }
    }
    if (!finished) show("The scan didn't finish. Try again, or fill in the form yourself.", 'error');
  } catch { show("The scan didn't finish. Try again, or fill in the form yourself.", 'error'); }
  go.disabled = false;
});

// A template button fills in the box of instructions in its own form, marked data-template-box.
document.addEventListener('click', e => {
  const t = e.target.closest('[data-template]');
  const box = t?.form?.querySelector('[data-template-box]');
  if (box) { box.value = t.dataset.template; box.focus(); }
});

// A select marked data-switch="name" shows the parts of its form marked data-when="name=value" (or several values,
// spaced) for the value chosen and hides the others: the keywords box for keyword notifications, the weekday for a
// weekly digest, a list's own name and logo when it sends under them.
document.addEventListener('change', e => {
  const s = e.target.closest('select[data-switch]');
  if (s && s.form) s.form.querySelectorAll('[data-when]').forEach(el => {
    const [key, values] = el.dataset.when.split('=');
    if (key === s.dataset.switch) el.hidden = !values.split(' ').includes(s.value);
  });
  // A monitor's voice choice points its Edit voice link at the voice picked, and hides it for a voice of its own.
  const v = e.target.closest('select[data-voice-select]');
  const link = v?.form?.querySelector('[data-voice-link]');
  if (link) { link.hidden = v.value === 'own'; link.href = '/voices/' + v.value; }
  // A file field marked data-max-kb turns away a file that's too big before it's sent.
  const f = e.target.closest('input[type=file][data-max-kb]');
  if (f && f.files[0] && f.files[0].size > f.dataset.maxKb * 1024) {
    f.value = '';
    window.opalite?.toast(`That file is too big. It can be up to ${f.dataset.maxKb} KB.`, { type: 'danger' });
  }
});

// Every form shows it's working once sent: its button gets a spinner and its busy wording (data-busy, or "Working"),
// and can't be pressed twice. Cleared again if the browser brings the page back from its cache.
document.addEventListener('submit', e => {
  const b = e.submitter || e.target.querySelector('button:not([type=button])');
  if (!b || e.defaultPrevented) return;
  b.dataset.idle = b.innerHTML;
  b.innerHTML = '<i class="fa-solid fa-spinner fa-spin fa-fw" aria-hidden="true"></i> ' + (b.dataset.busy || 'Working');
  b.setAttribute('aria-busy', 'true');
  setTimeout(() => { b.disabled = true; });  // after the form has read the button's own name and value
});
addEventListener('pageshow', () => document.querySelectorAll('[aria-busy=true][data-idle]').forEach(b => {
  b.innerHTML = b.dataset.idle; b.disabled = false; b.removeAttribute('aria-busy');
}));

// An agenda or video's summary bar: a version button shows that version in place, Instructions used shows what the
// showing version was written from, and Edit instructions opens the Summary tab with its box ready to type in.
document.addEventListener('click', e => {
  const version = e.target.closest('[data-show-version]'), prompt = e.target.closest('[data-toggle-prompt]'), go = e.target.closest('[data-goto-tab]');
  if (version) {
    const tool = version.closest('.summary-tool');
    tool.querySelectorAll('[data-version]').forEach(el => { el.hidden = el.dataset.version !== version.dataset.showVersion; });
    tool.querySelectorAll('[data-show-version]').forEach(b => b.setAttribute('aria-pressed', b === version));
  }
  if (prompt) prompt.setAttribute('aria-pressed', prompt.closest('.summary-tool').classList.toggle('show-prompt'));
  if (go) {
    const tab = document.querySelector(`.nav [data-tab="${go.dataset.gotoTab}"]`);
    if (!tab) return;
    tab.click();
    tab.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelector(`${go.dataset.gotoTab} textarea`)?.focus({ preventScroll: true });
  }
});

// Email colours: a preset fills the three colour boxes, "Use the colours from my Settings" puts the account's back,
// and any change redraws the preview email from the server, so it shows the real layout.
const colourBoxes = box => ['fg', 'bg1', 'bg2'].map(k => box.querySelector(`[name=colour_${k}]`));
const setColours = (box, list) => colourBoxes(box).forEach((input, i) => { input.value = list[i]; });
let colourTimer;
function colourPreview(box) {
  clearTimeout(colourTimer);
  colourTimer = setTimeout(async () => {
    const [fg, bg1, bg2] = colourBoxes(box).map(i => i.value);
    try {
      const r = await fetch('/settings/colour-preview?' + new URLSearchParams({ fg, bg1, bg2, list: box.dataset.list }), { credentials: 'same-origin' });
      if (r.ok) box.querySelector('[data-colour-preview]').innerHTML = await r.text();
    } catch {}
  }, 150);
}
document.addEventListener('click', e => {
  const preset = e.target.closest('[data-preset]');
  if (!preset) return;
  const box = preset.closest('[data-colour-picker]');
  setColours(box, preset.dataset.preset.split(','));
  const inherit = box.querySelector('[name=colours_inherit]');
  if (inherit) inherit.checked = false;
  colourPreview(box);
});
document.addEventListener('input', e => {
  const box = e.target.closest('[data-colour-picker]');
  if (!box) return;
  const inherit = box.querySelector('[name=colours_inherit]');
  if (e.target.type === 'color') { if (inherit) inherit.checked = false; colourPreview(box); }
  if (e.target === inherit && inherit.checked) { setColours(box, box.dataset.account.split(',')); colourPreview(box); }
});

// WhatsApp destinations: refresh each linking panel, often while it waits to be scanned and now and then once it's
// linked, so a new code or a dropped link shows without reloading.
let waTicks = 0;
setInterval(async () => {
  waTicks++;
  for (const panel of document.querySelectorAll('[data-wa]')) {
    if (panel.dataset.waState === 'open' && waTicks % 5) continue;
    try {
      const r = await fetch(panel.dataset.wa, { credentials: 'same-origin' });
      if (!r.ok || !panel.isConnected) continue;
      const html = await r.text();
      const state = (html.match(/data-wa-state="([a-z_]+)"/) || [])[1];
      // Linked or unlinked: the whole section redraws, so the group choice appears or goes. Otherwise just the panel.
      if (state && (state === 'open') !== (panel.dataset.waState === 'open')) await swapTo(location.href);
      else panel.outerHTML = html;
    } catch {}
  }
}, 4000);

async function swapTo(url) {
  document.querySelector('main')?.classList.add('is-loading');
  try {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok || new URL(r.url).pathname !== new URL(url, location.href).pathname) return false;
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    const next = doc.querySelector('main'), now = document.querySelector('main');
    if (!next || !now) return false;
    now.replaceWith(next);
    document.querySelector('.page > .alert')?.remove();
    document.title = doc.title;
    return true;
  } catch { return false; } finally { document.querySelector('main')?.classList.remove('is-loading'); }
}
</script>
</body>
</html>
