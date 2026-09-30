/* Synchronous head bootstrap: resolve the palette before CSS or React paints. */
(function () {
  var key = "valley-desk:theme:v1";
  var storage, media, sessionOnly = false;
  var listeners = new Set();
  var valid = function (value) { return value === "light" || value === "dark" ? value : "system"; };
  var preference = "system";
  try { storage = window.localStorage; preference = valid(storage.getItem(key)); }
  catch (_) { sessionOnly = true; }
  try { if (typeof window.matchMedia === "function") media = window.matchMedia("(prefers-color-scheme: dark)"); }
  catch (_) { /* Light is the fallback when OS preference is unavailable. */ }
  var snapshot;
  function apply() {
    var theme = preference === "system" ? (media && media.matches ? "dark" : "light") : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    if (!snapshot || snapshot.preference !== preference || snapshot.theme !== theme || snapshot.sessionOnly !== sessionOnly) {
      snapshot = { preference: preference, theme: theme, sessionOnly: sessionOnly };
      listeners.forEach(function (listener) { listener(); });
    }
  }
  apply();
  try {
    if (media && typeof media.addEventListener === "function") media.addEventListener("change", apply);
    else if (media && typeof media.addListener === "function") media.addListener(apply);
  } catch (_) { /* Preference remains usable without OS change events. */ }
  try {
    if (typeof window.addEventListener === "function") window.addEventListener("storage", function (event) {
      if (!storage || (event.storageArea && event.storageArea !== storage) || (event.key !== key && event.key !== null)) return;
      preference = valid(event.key === null ? null : event.newValue);
      apply();
    });
  } catch (_) { /* Preference remains usable without cross-tab events. */ }
  window.__VALLEY_DESK_THEME__ = {
    getSnapshot: function () { return snapshot; },
    subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
    setPreference: function (value) {
      preference = valid(value);
      try { if (!storage) throw new Error("storage unavailable"); storage.setItem(key, preference); }
      catch (_) { sessionOnly = true; }
      apply();
    }
  };
})();
