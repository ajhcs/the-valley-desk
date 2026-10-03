import { registerRegionalBrowserTools } from "./regional-browser";
// Imported only by the explicit local preview entry. Production entry remains unchanged.
const registration = registerRegionalBrowserTools();
if (import.meta.hot) import.meta.hot.dispose(() => { void registration.then(state => state.dispose()); });
window.addEventListener("pagehide", () => { void registration.then(state => state.dispose()); }, { once: true });
