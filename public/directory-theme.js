(function () {
  const store = window.__VALLEY_DESK_THEME__;
  const control = document.getElementById('directory-theme');
  if (!store || !control) return;
  const choices = [...control.querySelectorAll('[data-theme-choice]')];
  const sync = () => {
    const preference = store.getSnapshot().preference;
    for (const choice of choices) choice.setAttribute('aria-pressed', String(choice.dataset.themeChoice === preference));
  };
  sync();
  store.subscribe(sync);
  control.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-theme-choice]');
    if (choice) store.setPreference(choice.dataset.themeChoice);
  });
  control.hidden = false;
})();
