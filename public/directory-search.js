(() => {
  const searchId = 'directory-search';
  const filterId = 'directory-filters';
  const jumpId = 'directory-jump';
  const regionId = 'directory-results';
  const panelId = 'directory-filter-panel';
  const viewKey = 'valley-desk:directory-view:v1';
  const narrow = matchMedia('(max-width: 53rem)');
  const region = () => document.getElementById(regionId);

  document.addEventListener('keydown', event => {
    if (event.key !== '/' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
        !(event.target instanceof Element) || event.target.closest('input, select, textarea, [contenteditable]')) return;
    const search = document.getElementById(searchId);
    if (!search) return;
    event.preventDefault();
    search.focus();
  });

  if (!region()) return;
  document.documentElement.classList.add('directory-enhanced');

  function setupPanel(hash) {
    const panel = document.getElementById(panelId);
    const facet = hash && [...panel.querySelectorAll('.facet')].find(item => '#' + item.id === hash);
    panel.open = !narrow.matches || !!facet;
    if (facet) {
      facet.open = true;
      facet.scrollIntoView({ block: 'nearest' });
    }
  }

  function readView() {
    try { return localStorage.getItem(viewKey); }
    catch { return null; }
  }

  function saveView(view) {
    if (!view) return;
    try { localStorage.setItem(viewKey, view); }
    catch { /* Explicit layout state is still encoded in the URL. */ }
  }

  function setMeta(selector, value) {
    document.querySelector(selector)?.setAttribute('content', value);
  }

  function updateMetadata(next) {
    const { directoryTitle, directoryDescription, directoryCanonical } = next.dataset;
    const title = directoryTitle + ' · The Valley Desk';
    document.title = title;
    setMeta('meta[name="description"]', directoryDescription);
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:description"]', directoryDescription);
    const canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) return;
    canonical.href = new URL(directoryCanonical, canonical.href).href;
    setMeta('meta[property="og:url"]', canonical.href);
    const schema = document.getElementById('directory-schema');
    if (schema) {
      const data = JSON.parse(schema.textContent);
      schema.textContent = JSON.stringify({ ...data, url: canonical.href, name: directoryTitle, description: directoryDescription });
    }
  }

  function formUrl(form) {
    const url = new URL(form.action);
    for (const [key, raw] of new FormData(form)) {
      const value = String(raw).trim();
      if (value && !(key === 'sort' && value === 'updated') && !(key === 'page' && value === '1')) url.searchParams.append(key, value);
    }
    return url;
  }

  let pending;
  let timer;
  let displayedUrl = location.href;

  function cancelPending() {
    clearTimeout(timer);
    pending?.abort();
    pending = undefined;
  }

  function replaceResults(next, mode, focus) {
    const previous = region();
    const active = previous.contains(document.activeElement) ? document.activeElement : null;
    const focusedFacet = active?.closest('.facet');
    const open = new Map([...previous.querySelectorAll('details[id]')].map(item => [item.id, item.open]));
    const scrolling = new Map([...previous.querySelectorAll('.facet ul, .filter-body')].map(item =>
      [item.closest('details').id, item.scrollTop]));
    const searchActive = active?.id === searchId && active instanceof HTMLInputElement;
    const inputState = searchActive ? [active.value, active.selectionStart, active.selectionEnd, active.selectionDirection] : null;

    previous.replaceWith(next);
    for (const details of next.querySelectorAll('details[id]')) {
      if (open.has(details.id)) details.open = open.get(details.id);
    }
    for (const item of next.querySelectorAll('.facet ul, .filter-body')) {
      item.scrollTop = scrolling.get(item.closest('details').id) ?? 0;
    }
    updateMetadata(next);

    const heading = document.getElementById('results-heading');
    const status = document.getElementById('directory-live');
    if (status) status.textContent = next.querySelector('.results-count').textContent;
    if (focus === 'page') {
      heading.focus();
      return;
    }
    if (focus === 'results') {
      heading.focus({ preventScroll: true });
      return;
    }
    let target = focus === 'view' ? next.querySelector('[data-view-link][aria-current]') : active?.id && document.getElementById(active.id);
    if (!target && focusedFacet) {
      const current = document.getElementById(focusedFacet.id);
      target = [...(current?.querySelectorAll('input') ?? [])].find(input => input.value === active.value) ?? current?.querySelector('summary');
    }
    if (!target && active instanceof HTMLInputElement) {
      target = [...next.querySelectorAll('input')].find(input => input.name === active.name && input.value === active.value);
    }
    if (target) {
      target.focus({ preventScroll: true });
      const list = target.closest('.facet ul');
      if (list) {
        const item = target.closest('li').getBoundingClientRect();
        const bounds = list.getBoundingClientRect();
        if (item.top < bounds.top) list.scrollTop -= bounds.top - item.top;
        if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
      }
      if (inputState && mode !== 'pop') {
        target.value = inputState[0];
        target.setSelectionRange(...inputState.slice(1));
      }
    }
  }

  async function refresh(url, { mode = 'push', focus } = {}) {
    cancelPending();
    if (url.href === displayedUrl && mode !== 'pop') return;
    const controller = new AbortController();
    pending = controller;
    region()?.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'X-Valley-Desk-Fragment': 'results' },
      });
      if (!response.ok) throw new Error('Directory results unavailable');
      const fragment = document.createElement('template');
      fragment.innerHTML = await response.text();
      if (controller.signal.aborted) return;
      const next = fragment.content.querySelector('#' + regionId);
      if (!next) throw new Error('Directory results fragment unavailable');
      if (mode === 'push' && url.href !== location.href) history.pushState(null, '', url);
      if (mode === 'replace') history.replaceState(null, '', url);
      displayedUrl = url.href;
      saveView(url.searchParams.get('view'));
      replaceResults(next, mode, focus);
    } catch {
      if (!controller.signal.aborted) {
        if (mode === 'replace') location.replace(url);
        else if (mode === 'pop') location.reload();
        else location.assign(url);
      }
    } finally {
      if (pending === controller) {
        pending = undefined;
        region()?.removeAttribute('aria-busy');
      }
    }
  }

  setupPanel(location.hash);
  narrow.addEventListener('change', () => setupPanel(location.hash));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !narrow.matches) return;
    const panel = document.getElementById(panelId);
    if (panel?.open && panel.contains(document.activeElement)) closeFilters(panel);
  });
  function closeFilters(panel) {
    panel.open = false;
    panel.querySelector('summary').focus();
  }
  document.addEventListener('pointerdown', event => {
    if (!narrow.matches) return;
    const panel = document.getElementById(panelId);
    if (panel?.open && !panel.contains(event.target)) panel.open = false;
  });
  document.addEventListener('focusin', event => {
    if (!narrow.matches) return;
    const panel = document.getElementById(panelId);
    if (panel?.open && !panel.contains(event.target)) panel.open = false;
  });

  function queueSearch(event) {
    if (event.target.id !== searchId || event.isComposing) return;
    cancelPending();
    region()?.removeAttribute('aria-busy');
    const input = event.target;
    timer = setTimeout(() => refresh(formUrl(input.form)), 220);
  }
  document.addEventListener('input', queueSearch);
  document.addEventListener('compositionend', queueSearch);
  document.addEventListener('change', event => {
    const target = event.target;
    if (target.form?.id === filterId && target.id !== searchId) refresh(formUrl(target.form));
  });
  document.addEventListener('submit', event => {
    if (event.target.id !== filterId && event.target.id !== jumpId) return;
    event.preventDefault();
    refresh(formUrl(event.target), { focus: event.target.id === jumpId ? 'page' : 'results' });
  });
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.target.closest('[data-close-filters]')) {
      closeFilters(document.getElementById(panelId));
      return;
    }
    const link = event.target.closest('a[data-directory-link]');
    if (!link || !region()?.contains(link)) return;
    event.preventDefault();
    refresh(new URL(link.href), {
      focus: link.hasAttribute('data-page-link') ? 'page' : link.hasAttribute('data-view-link') ? 'view' : 'results',
    });
  });
  addEventListener('popstate', () => refresh(new URL(location.href), { mode: 'pop' }));

  const url = new URL(location.href);
  if (url.searchParams.has('view')) saveView(url.searchParams.get('view'));
  else if (readView() === 'compact') {
    url.searchParams.set('view', 'compact');
    refresh(url, { mode: 'replace' });
  }
})();
