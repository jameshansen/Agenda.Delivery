/*! Opalite 0.1 */
// Behaviour for the few components HTML can't do alone. Load with <script defer>.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const store = { get: () => { try { return localStorage.opaliteTheme; } catch {} }, set: v => { try { localStorage.opaliteTheme = v; } catch {} } };

  if (store.get()) root.dataset.theme = store.get();

  const toast = (message, { type = '', ms = 4000 } = {}) => {
    let box = $('.toast-container');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toast-container';
      box.setAttribute('aria-live', 'polite');
      document.body.append(box);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' toast-' + type : '');
    el.textContent = message;
    box.append(el);
    if (ms) setTimeout(() => el.remove(), ms);
    return el;
  };

  document.addEventListener('click', e => {
    // an open dropdown closes on any click outside it, or on one of its items
    $$('details.dropdown[open]').forEach(d => {
      if (!d.contains(e.target) || e.target.closest('.dropdown-item')) d.open = false;
    });

    // a click on a dialog's backdrop lands on the dialog itself, outside its box
    if (e.target.matches('dialog[open]')) {
      const r = e.target.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
    }

    const t = e.target.closest('[data-open],[data-close],[data-dismiss],[data-toggle],[data-tab],[data-slide],[data-toast],[data-theme-toggle]');
    if (!t) return;
    const d = t.dataset;

    if ('open' in d) $(d.open)?.showModal();
    if ('close' in d) t.closest('dialog')?.close();
    if ('dismiss' in d) t.closest('.alert,.toast')?.remove();
    if ('toast' in d) toast(d.toast, { type: d.toastType });

    if ('toggle' in d) {
      const el = $(d.toggle);
      if (el) t.setAttribute('aria-expanded', el.classList.toggle('open'));
    }

    if ('tab' in d) {
      const pane = $(d.tab);
      $$('[data-tab]', t.closest('.nav')).forEach(b => {
        b.classList.toggle('active', b === t);
        b.setAttribute('aria-selected', b === t);
      });
      if (pane) [...pane.parentElement.children].forEach(p => p.classList.toggle('active', p === pane));
    }

    if ('slide' in d) {
      const track = $('.carousel-track', t.closest('.carousel'));
      track?.scrollBy({ left: Number(d.slide) * track.clientWidth, behavior: 'smooth' });
    }

    if ('themeToggle' in d) {
      const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
      root.dataset.theme = dark ? 'light' : 'dark';
      store.set(root.dataset.theme);
    }
  });

  // scrollspy: <nav data-spy> marks the link whose section is on screen
  const spy = () => $$('[data-spy]').forEach(nav => {
    const links = $$('a[href^="#"]', nav);
    const io = new IntersectionObserver(entries => entries.forEach(en => {
      if (en.isIntersecting) links.forEach(l => l.classList.toggle('active', l.hash === '#' + en.target.id));
    }), { rootMargin: '-20% 0px -70%' });
    links.forEach(l => {
      const section = l.hash.length > 1 && document.getElementById(l.hash.slice(1));
      if (section) io.observe(section);
    });
  });
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', spy) : spy();

  window.opalite = { toast };
})();
