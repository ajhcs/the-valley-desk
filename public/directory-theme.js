(function () {
  const store = window.__VALLEY_DESK_THEME__;
  const control = document.getElementById('directory-theme');
  if (!store || !control) return;
  const sync = () => { control.value = store.getSnapshot().preference; };
  sync();
  store.subscribe(sync);
  control.addEventListener('change', () => { store.setPreference(control.value); });
  control.parentElement.hidden = false;
})();
