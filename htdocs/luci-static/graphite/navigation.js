(() => {
  'use strict';

  const menu = document.getElementById('topmenu');
  const menuButton = document.getElementById('graphite-menu');
  const simpleButton = document.getElementById('graphite-simple-mode');
  const narrow = matchMedia('(max-width: 900px)');
  const preference = 'luci.graphite.simple-mode';
  const allowed = new Set(['admin/status/overview', 'admin/status/realtime', 'admin/logout']);
  const page = document.body.dataset.page;
  let simple = false;

  try {
    simple = localStorage.getItem(preference) === 'on';
  } catch {
    // The switch still works for this page when storage is unavailable.
  }

  function route(link) {
    if (!link || link.getAttribute('href') === '#' || link.origin !== location.origin) return '';
    return link.pathname.replace(/\/+$/, '').match(/(?:^|\/)(admin\/.+)$/)?.[1] || '';
  }

  function setGroup(group) {
    for (const item of menu.querySelectorAll(':scope > li:has(> .dropdown-menu)')) {
      const open = item === group;
      item.classList.toggle('graphite-expanded', open);
      if (narrow.matches) item.firstElementChild.setAttribute('aria-expanded', String(open));
      else item.firstElementChild.removeAttribute('aria-expanded');
    }
  }

  function updateMenu() {
    let current;
    let firstAllowed;
    for (const item of menu.children) {
      const submenu = item.querySelector(':scope > .dropdown-menu');
      const links = submenu ? [...submenu.querySelectorAll(':scope > li > a')] : [item.firstElementChild];
      let hasAllowed = false;
      for (const link of links) {
        const path = route(link);
        const key = path.replaceAll('/', '-');
        const active = !!key && (page === key || page?.startsWith(key + '-'));
        if (submenu) {
          link.parentElement.classList.toggle('graphite-advanced', !allowed.has(path));
          if (active) link.setAttribute('aria-current', 'page');
        }
        if (active && (!simple || allowed.has(path))) current = item;
        hasAllowed ||= allowed.has(path);
      }
      if (hasAllowed && submenu) firstAllowed ??= item;
      item.classList.toggle('graphite-advanced', !hasAllowed);
    }
    document.body.classList.toggle('graphite-simple', simple);
    simpleButton.setAttribute('aria-pressed', String(simple));
    setGroup(current || (simple ? firstAllowed : undefined));
  }

  function setMenu(open) {
    menuButton.setAttribute('aria-expanded', String(open));
    if (open) updateMenu();
  }

  menuButton.addEventListener('click', () => {
    setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
  });

  menu.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!narrow.matches || !link?.matches('#topmenu > li:has(> .dropdown-menu) > a')) return;
    event.preventDefault();
    const item = link.parentElement;
    setGroup(item.classList.contains('graphite-expanded') ? undefined : item);
  });

  simpleButton.addEventListener('click', () => {
    simple = !simple;
    try {
      localStorage.setItem(preference, simple ? 'on' : 'off');
    } catch {
      // Keep the in-memory setting.
    }
    updateMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || menuButton.getAttribute('aria-expanded') !== 'true' ||
        !menu.closest('header').contains(document.activeElement)) return;
    setMenu(false);
    menuButton.focus();
  });

  narrow.addEventListener('change', () => {
    setMenu(false);
    updateMenu();
  });

  // LuCI populates #topmenu after loading the menu tree.
  new MutationObserver(updateMenu).observe(menu, { childList: true, subtree: true });
  updateMenu();
  document.body.classList.add('graphite-nav-ready');
})();
