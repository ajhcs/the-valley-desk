// These styles render with the Worker directory independently of the React entry.
export const directoryPageStyle = `
:root {
  color-scheme: light;
  --paper: #fff; --surface: #f2f4f7; --text: #101828; --mute: #475467;
  --rule: #e6e8ee; --field-border: #667085; --ink: #21145f; --admiral: #1e22aa;
  --serif: "IBM Plex Serif", Georgia, "Times New Roman", serif;
  --sans: "IBM Plex Sans", Helvetica, Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --paper: #111322; --surface: #20243a; --text: #f2f4f7; --mute: #b8c1d1;
    --rule: #4b526a; --field-border: #8994af; --ink: #c7bcff; --admiral: #adb4ff;
  }
}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--text); font: 1rem/1.55 var(--sans); overflow-wrap: anywhere; }
h1, h2, h3, p { margin: 0; }
h1, h2, h3 { color: var(--ink); font-family: var(--serif); line-height: 1.18; font-weight: 600; }
h1 { font-size: clamp(2rem, 5vw, 3.4rem); letter-spacing: -.025em; }
h2 { font-size: 1.35rem; }
h3 { font-size: clamp(1.24rem, 2.6vw, 1.6rem); }
a { color: var(--ink); text-underline-offset: .18em; }
time { white-space: nowrap; }
:focus-visible { outline: 3px solid var(--admiral); outline-offset: 4px; }
.shell { width: min(100% - 2rem, 69rem); margin: auto; }
.masthead { border-bottom: 1px solid var(--rule); }
.masthead .shell { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0 1rem; padding-block: .25rem; }
.masthead a, .actions a, .detail-back a, .pagination a { display: inline-flex; align-items: center; min-height: 44px; }
.wordmark { font: 600 1.3rem var(--serif); text-decoration: none; }
.section-link { font-size: .9rem; font-weight: 600; }
.skip { position: absolute; z-index: 2; top: .5rem; left: 1rem; padding: .7rem; background: var(--paper); }
.skip:not(:focus) { transform: translateY(-200%); }
main { padding-block: clamp(1.5rem, 5vw, 3.5rem); }
.intro { margin: .65rem 0 1.5rem; color: var(--mute); max-width: 43rem; }
.search-panel { padding: clamp(.85rem, 2.6vw, 1.4rem); border: 1px solid var(--rule); background: var(--surface); }
label { display: block; color: var(--text); font-size: .88rem; font-weight: 600; margin-bottom: .35rem; }
.search-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .55rem; }
input, select, button { min-width: 0; min-height: 44px; font: inherit; border: 1px solid var(--field-border); border-radius: .2rem; padding: .5rem .65rem; }
input, select { width: 100%; color: var(--text); background: var(--paper); }
button { background: var(--ink); color: var(--paper); border-color: var(--ink); font-weight: 600; cursor: pointer; }
.help, .muted { color: var(--mute); font-size: .875rem; }
.help { margin-top: .5rem; }
.filter-disclosure { margin-top: .4rem; }
summary { cursor: pointer; min-height: 44px; width: fit-content; padding-block: .6rem; color: var(--ink); font-weight: 600; }
.filter-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: .75rem; }
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: 0 1rem; }
.filter-actions { margin-top: .55rem; }
.results { margin-top: 2rem; }
.result-summary { display: flex; align-items: baseline; flex-wrap: wrap; gap: .2rem .9rem; margin-bottom: .8rem; }
.cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem 1.5rem; }
.card { min-width: 0; border-top: 2px solid var(--ink); border-bottom: 1px solid var(--rule); padding: .9rem 0 .65rem; display: flex; flex-direction: column; }
.card > h3, .card > .purpose { margin-top: .3rem; }
.card > .actions { margin-top: auto; padding-top: .2rem; }
.kind, .qualifier, .dates { color: var(--mute); font-size: .85rem; }
.kind { font-weight: 600; }
.kind, .dates { display: flex; flex-wrap: wrap; column-gap: .85rem; }
.region { margin-top: .65rem; font-size: .9rem; }
.qualifier { margin-top: .18rem; }
.card .dates { margin-top: .65rem; }
.match { margin: .75rem 0 .25rem; padding-left: .65rem; border-left: 2px solid var(--rule); font-size: .85rem; }
.empty, .related { border: 1px solid var(--rule); background: var(--surface); padding: 1rem; }
.empty p + p { margin-top: .4rem; }
.related, .pagination { margin-top: 1.25rem; }
.detail { max-width: 47rem; }
.detail .purpose { margin: .55rem 0 .8rem; font-size: 1.15rem; }
.detail .kind { margin-top: .85rem; }
.detail section { margin-top: 1.45rem; }
.detail .dates, .detail .owner { margin-top: .45rem; }
.detail .source-disclosure { border-top: 1px solid var(--rule); margin-top: 1.4rem; }
.detail .source-disclosure ul, .related ul { padding-left: 1.15rem; }
.detail .source-disclosure li, .related li { margin-bottom: .6rem; }
.detail .source-disclosure code { font-size: .82rem; }
.detail-back { margin-bottom: .65rem; }
@media (max-width: 790px) {
  .filter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 625px) {
  .cards { grid-template-columns: minmax(0, 1fr); }
  .results { margin-top: 1.5rem; }
}
@media (max-width: 335px) {
  .search-row { grid-template-columns: minmax(0, 1fr); }
}
`;
