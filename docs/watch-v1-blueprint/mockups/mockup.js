"use strict";

// Static design fixtures only. This file makes no network requests or model calls.
const policyRows = [
  { id: "pa-01", jurisdiction: "PA", title: "Clinical AI disclosure proposal", topic: "AI", stage: "active", status: "In committee", date: "Sep 10, 2026", body: "Sample House Health Committee", summary: "Proposed notice requirements for hospitals using clinical AI. Definitions in the amended text await review.", hold: true, next: "Sep 18, 2026", nextType: "Sample hearing" },
  { id: "nj-01", jurisdiction: "NJ", title: "Health information exchange reporting proposal", topic: "Interoperability", stage: "withdrawn", status: "Withdrawn", date: "Sep 9, 2026", body: "Sample Assembly committee", summary: "The sample proposal was withdrawn. No current reporting obligation is asserted by this record.", hold: false, next: null },
  { id: "de-01", jurisdiction: "DE", title: "Health data access safeguards", topic: "Privacy", stage: "active", status: "Introduced", date: "Sep 8, 2026", body: "Sample Delaware House", summary: "A sample measure concerning access to shared health data. Applicability is limited to the entities named in its text.", hold: false, next: null },
  { id: "federal-01", jurisdiction: "Federal", title: "Interoperability reporting rule proposal", topic: "Interoperability", stage: "active", status: "Proposed rule", date: "Sep 7, 2026", body: "Sample federal agency", summary: "A proposed reporting change for covered healthcare organizations. The sample comment window remains open.", hold: false, next: "Sep 30, 2026", nextType: "Sample comment deadline" },
  { id: "local-01", jurisdiction: "Local", title: "Public digital services accessibility proposal", topic: "Access", stage: "active", status: "Hearing scheduled", date: "Sep 6, 2026", body: "Sample Philadelphia council committee", summary: "A sample local measure concerning public digital services. Its hearing and legal effect are separate facts.", hold: false, next: "Sep 22, 2026", nextType: "Sample hearing" },
];

const technologyRows = [
  { id: "orca", title: "ORCA", organization: "CHOP", type: "Software", license: "Restricted source", purpose: "Reference access to order sets during downtime.", relation: "CHOP / documented local connection", status: "Research example", baseline: true, date: "Release date not verified" },
  { id: "sample-dataset", title: "Sample regional research dataset", organization: "Example regional lab", type: "Dataset", license: "Unknown", purpose: "A synthetic directory entry for schema, provenance, and permitted-use comparison.", relation: "Research from here / synthetic fixture", status: "Illustrative record", baseline: true, date: "Sample version 1" },
  { id: "sample-engine", title: "Sample clinical analytics query engine", organization: "Example regional lab", type: "Database engine", license: "Open source", purpose: "A synthetic database example with a documented query interface and deployment model.", relation: "Built here / synthetic fixture", status: "Illustrative record", baseline: true, date: "Sample version 2" },
  { id: "sample-paper", title: "Sample evaluation of a regional data workflow", organization: "Example regional lab", type: "Paper", license: "Not applicable", purpose: "A synthetic paper record with regional affiliation, evidence limitations, and linked artifacts.", relation: "Research from here / synthetic fixture", status: "Preprint fixture", baseline: true, date: "Sep 4, 2026 / synthetic" },
];

const nextPolicyDays = { "pa-01": "2026-09-18", "local-01": "2026-09-22", "federal-01": "2026-09-30" };
function byNextPolicyDay(left, right) {
  return nextPolicyDays[left.id].localeCompare(nextPolicyDays[right.id]);
}

const newsRows = [
  { id: "news-01", title: "Regional interoperability pilot expands", topic: "Interoperability", date: "Sep 11, 2026", org: "Example regional health system", summary: "Synthetic News fixture. A material follow-up links the current story to its earlier development and technology profile." },
  { id: "news-02", title: "Downtime planning receives a new research reference", topic: "Resilience", date: "Sep 10, 2026", org: "Example regional research team", summary: "Synthetic News fixture. Concise impact and source context remain part of the existing editorial reading experience." },
];
const eventRows = [
  { id: "event-01", title: "Regional health data forum", format: "In person", county: "Philadelphia", date: "Sep 24, 2026", time: "9:00 AM EDT", summary: "Synthetic event fixture. Public health data exchange, implementation questions, and regional collaboration.", host: "Example chapter", price: "Not stated", status: "Upcoming" },
  { id: "event-02", title: "Clinical informatics research roundtable", format: "Virtual", county: "New Castle", date: "Sep 29, 2026", time: "12:00 PM EDT", summary: "Synthetic event fixture. Research methods, data quality, and practical informatics workflows.", host: "Example research group", price: "Free / fixture", status: "Upcoming" },
  { id: "event-03", title: "Digital health implementation workshop", format: "In person", county: "Camden", date: "Oct 2, 2026", time: "10:00 AM EDT", summary: "Synthetic cancellation fixture. The original event date and permalink remain available.", host: "Example association", price: "Not stated", status: "Cancelled" },
];

const main = document.querySelector("main");
const announcement = document.querySelector("#announcement");
const storageKey = "tvd-watch-blueprint-saved-v1";
let saved;
try {
  const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
  saved = new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : []);
} catch { saved = new Set(); }

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
function route() {
  const [path, query = ""] = (location.hash.slice(1) || "policy").split("?");
  const [section, id] = path.split("/");
  return { section, id, params: new URLSearchParams(query) };
}
function href(section, values = {}) {
  const params = new URLSearchParams(Object.entries(values).filter(([, value]) => value));
  return `#${section}${params.size ? `?${params}` : ""}`;
}
function saveControl(id, name) {
  return `<label class="save"><input type="checkbox" data-save="${escapeHtml(id)}" aria-label="Save ${escapeHtml(name)}" ${saved.has(id) ? "checked" : ""}>Saved</label>`;
}
function options(name, label, values, selected, required = false) {
  return `<label>${label}<select name="${name}">${required ? "" : '<option value="">All</option>'}${values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select></label>`;
}
function filters(section, params, fields) {
  return `<form class="filters" data-filter="${section}">${fields.map(([name, label, values, required]) => options(name, label, values, params.get(name), required)).join("")}<label class="search-label">Search<span class="search-box"><input name="q" type="search" value="${escapeHtml(params.get("q") || "")}" maxlength="120" aria-label="Search ${section}"><button type="submit">Search</button></span></label></form>`;
}
function viewNav(section, selected, views) {
  return `<nav class="view-nav" aria-label="${section} views">${views.map(([key, title]) => `<a href="${href(section, { view: key })}" ${key === selected ? 'aria-current="page"' : ""}>${title}</a>`).join("")}</nav>`;
}
function heading(section, title) {
  return `<div class="heading"><div class="section-name"><h1>${title}</h1></div><span class="subtle" id="saved-count">${saved.size} saved</span></div>`;
}
function stateNotice(params) {
  return params.get("state") === "stale" ? `<div class="notice" role="status"><strong>Last accepted sample: September 10, 2026</strong><p>Source refresh is delayed. Current verification is unavailable.</p></div>` : "";
}
function empty(title = "No matching results", body = "No sample records match the selected filters.") {
  const { section, params } = route();
  return `<div class="empty"><h2>${title}</h2><p>${body}</p><a href="${href(section, { view: params.get("view") })}">Reset filters</a></div>`;
}
function resultState(params, content) {
  if (params.get("state") === "error") return `<div class="empty" role="alert"><h2>Records unavailable</h2><p>No accepted fallback is available for this sample state.</p><button data-retry>Retry</button></div>`;
  if (params.get("state") === "empty") return empty();
  return content;
}
function matches(row, params, fields) {
  const query = (params.get("q") || "").toLowerCase().trim();
  return fields.every((field) => !params.get(field) || row[field] === params.get(field))
    && (!query || JSON.stringify(row).toLowerCase().includes(query));
}
function policyAside() {
  return `<aside aria-label="Policy context"><section class="aside-block"><h2>Next known dates</h2>${policyRows.filter((row) => row.next).sort(byNextPolicyDay).map((row) => `<div class="aside-item"><span class="date">${row.next} / fixture</span><strong>${row.nextType}</strong><p><a href="#policy/${row.id}">${row.title}</a></p></div>`).join("")}</section><section class="aside-block"><h2>Coverage scope</h2>${["Federal", "Pennsylvania", "New Jersey", "Delaware", "11 regional counties"].map((label) => `<div class="coverage-row"><span>${label}</span><span>Launch scope</span></div>`).join("")}<p class="subtle">Source qualification remains pending in this blueprint.</p></section></aside>`;
}
function policyRow(row, agenda = false) {
  return `<article class="result"><div class="eyebrow">${row.jurisdiction} / DEMO ${row.id.toUpperCase()} / synthetic policy</div><div class="result-top"><h2><a href="#policy/${row.id}">${row.title}</a></h2>${saveControl(row.id, row.title)}</div>${agenda ? `<p class="event-date">${row.nextType}: ${row.next}</p>` : ""}<p>${row.summary}</p><div class="result-meta"><span class="status ${row.hold ? "hold" : row.stage === "withdrawn" ? "ended" : ""}">${row.status}</span><span>${row.date} / day only</span><span>${row.body}</span></div></article>`;
}
function representatives(params) {
  params = new URLSearchParams(params);
  const jurisdictions = ["NJ", "PA", "DE", "Federal"];
  const jurisdiction = jurisdictions.includes(params.get("jurisdiction")) ? params.get("jurisdiction") : "NJ";
  const bodies = jurisdiction === "NJ" ? ["Assembly", "Senate"] : ["House", "Senate"];
  const body = bodies.includes(params.get("body")) ? params.get("body") : bodies[0];
  const districts = ["Sample district A", "Sample district B"];
  const district = districts.includes(params.get("district")) ? params.get("district") : districts[0];
  params.set("jurisdiction", jurisdiction);
  params.set("body", body);
  params.set("district", district);
  const query = (params.get("q") || "").trim().toLowerCase();
  const members = (body === "Assembly" && jurisdiction === "NJ" ? ["Sample member A", "Sample member B"] : ["Sample officeholder"])
    .filter((name) => `${name} ${jurisdiction} ${body} ${district}`.toLowerCase().includes(query));
  const cards = members.map((name) => `<article class="person"><div class="eyebrow">Synthetic office record</div><h2>${name}</h2><p>${jurisdiction} ${body} / ${district}</p><p class="subtle">Sample term: January 2026 to January 2028</p><details><summary>Office and source record</summary><p>This is a synthetic membership, not a current elected official. Production records require a verified official roster and contact page.</p></details></article>`).join("");
  const lookup = jurisdiction === "PA" ? "https://www.palegis.us/" : jurisdiction === "DE" ? "https://legis.delaware.gov/" : jurisdiction === "Federal" ? "https://www.congress.gov/members" : "https://njleg.state.nj.us/";
  return `${filters("policy", params, [["jurisdiction", "Jurisdiction", jurisdictions, true], ["body", "Chamber", bodies, true], ["district", "Selected district", districts, true]])}<div class="body-grid"><section aria-label="Representatives"><div class="results-meta"><span>${members.length} synthetic memberships</span></div>${resultState(params, cards || empty())}</section><aside><section class="aside-block"><h2>Selected district</h2><p>${district}</p><p class="subtle">ZIP and county do not establish an exact district.</p><div class="source-links"><a href="${lookup}">Official legislature and lookup</a></div></section><section class="aside-block"><h2>Role at the time</h2><p class="subtle">A historical sponsor remains attached to their original office membership.</p></section></aside></div>`;
}
function policyList(params) {
  const view = params.get("view") || "changes";
  const nav = viewNav("policy", view, [["changes", "Latest Changes"], ["active", "Active Measures"], ["agenda", "Hearings & Deadlines"], ["representatives", "Representatives"]]);
  if (view === "representatives") return heading("policy", "Policy Watch") + nav + stateNotice(params) + representatives(params);
  const rows = policyRows.filter((row) => matches(row, params, ["jurisdiction", "topic", "stage"]))
    .filter((row) => view !== "active" || row.stage === "active").filter((row) => view !== "agenda" || row.next);
  if (view === "agenda") rows.sort(byNextPolicyDay);
  return heading("policy", "Policy Watch") + nav + stateNotice(params)
    + filters("policy", params, [["jurisdiction", "Jurisdiction", ["Federal", "PA", "NJ", "DE", "Local"]], ["topic", "Topic", ["AI", "Interoperability", "Privacy", "Access"]], ["stage", "Lifecycle", ["active", "withdrawn"]]])
    + `<div class="body-grid"><section aria-label="Policy results"><div class="results-meta"><span>${rows.length} sample ${view === "agenda" ? "dates" : "records"}</span><a href="${href("policy", { view })}">Reset filters</a></div>${resultState(params, rows.length ? rows.map((row) => policyRow(row, view === "agenda")).join("") : empty())}</section>${policyAside()}</div>`;
}
function policyDetail(id, params) {
  const row = policyRows.find((item) => item.id === id);
  if (!row) return empty("Record not found", "This policy does not exist in the design fixtures.");
  return `<a class="crumb" href="#policy">Policy Watch / Latest Changes</a><div class="heading"><div><p class="eyebrow">${row.jurisdiction} / DEMO ${row.id.toUpperCase()} / synthetic policy</p><h1 class="detail-title">${row.title}</h1><span class="status ${row.hold ? "hold" : ""}">${row.status}</span><p class="detail-dek">${row.summary}</p></div>${saveControl(row.id, row.title)}</div>${stateNotice(params)}<div class="body-grid"><div>${row.hold ? '<div class="notice"><strong>Amended definitions await review</strong><p>Current applicability has not been approved for this sample revision.</p></div>' : ""}<section class="detail-section"><h2>What changed</h2><p>${row.status} in the synthetic source record, dated ${row.date}. The action supplies a day, not an exact timestamp.</p></section><section class="detail-section"><h2>Applicability</h2><dl class="facts"><dt>Geography</dt><dd>${row.jurisdiction === "Local" ? "Philadelphia / sample" : row.jurisdiction}</dd><dt>Covered entities</dt><dd>${row.hold ? "Pending amended-text review" : "Entities named in the sample provision"}</dd><dt>Legal effect</dt><dd>${row.stage === "withdrawn" ? "No obligation established by this withdrawn sample" : "Proposed; no current obligation asserted"}</dd><dt>Effective date</dt><dd>Not established</dd></dl></section><section class="detail-section"><h2>Responsible people</h2><p>${row.body}</p><p><a href="#policy?view=representatives&jurisdiction=${row.jurisdiction === "Local" ? "PA" : row.jurisdiction}">Representatives and office records</a></p></section><section class="detail-section"><h2>Action history</h2><ol class="timeline"><li><time>${row.date}</time><div><strong>${row.status}</strong><p class="subtle">Synthetic action / source-native status retained</p></div></li><li><time>Earlier fixture</time><div><strong>Original proposal recorded</strong><p class="subtle">Earlier text remains a separate version</p></div></li></ol></section><section class="detail-section"><h2>Evidence and review</h2><details><summary>Sample provision / version 2</summary><p>Illustrative source excerpt: "This proposal applies to the entities defined in section 2." This is synthetic text, not a legal citation.</p><p>Review state: ${row.hold ? "hold; amended definition unresolved" : "accepted fixture only"}.</p></details><details><summary>Historical interpretation / version 1</summary><p>A prior interpretation cannot authorize current text. The old artifact and review remain in history.</p></details></section></div>${policyAside()}</div>`;
}
function technologyAside() {
  return `<aside aria-label="Technology context"><section class="aside-block"><h2>Local connection</h2><p>Created, researched, piloted, or used in the Delaware Valley, with artifact-specific evidence.</p></section><section class="aside-block"><h2>Availability</h2><div class="coverage-row"><span>Open source</span><span>Reviewed terms</span></div><div class="coverage-row"><span>Restricted source</span><span>Conditions apply</span></div><div class="coverage-row"><span>Unknown</span><span>Not verified</span></div></section><section class="aside-block"><h2>Directory baseline</h2><p class="subtle">No new ORCA release date was verified in this research.</p></section></aside>`;
}
function technologyList(params) {
  const view = params.get("view") || "directory";
  const rows = technologyRows.filter((row) => matches(row, params, ["organization", "type", "license"]))
    .filter((row) => view !== "papers" || row.type === "Paper").filter((row) => view !== "releases" || !row.baseline);
  return heading("technology", "Technology Watch")
    + viewNav("technology", view, [["releases", "Latest Releases"], ["directory", "Technology Directory"], ["papers", "Papers"]]) + stateNotice(params)
    + filters("technology", params, [["organization", "Organization", ["CHOP", "Example regional lab"]], ["type", "Resource type", ["Software", "Dataset", "Database engine", "Paper"]], ["license", "License", ["Open source", "Restricted source", "Unknown", "Not applicable"]]])
    + `<div class="body-grid"><section aria-label="Technology results"><div class="results-meta"><span>${rows.length} ${view === "releases" ? "verified releases" : "design examples"}</span><a href="${href("technology", { view })}">Reset filters</a></div>${resultState(params, rows.length ? rows.map((row) => `<article class="result"><div class="eyebrow">${row.type} / ${row.organization}</div><div class="result-top"><h2><a href="#technology/${row.id}">${row.title}</a></h2>${saveControl(row.id, row.title)}</div><p>${row.purpose}</p><div class="result-meta"><span class="status ${row.license === "Restricted source" || row.license === "Unknown" ? "hold" : ""}">${row.license}</span><span>${row.relation}</span></div><div class="result-meta"><span>${row.date}</span><span>${row.status}</span></div></article>`).join("") : empty(view === "releases" ? "No verified new releases in these fixtures" : "No matching results", view === "releases" ? "Baseline projects remain available in the Technology Directory." : undefined))}</section>${technologyAside()}</div>`;
}
function technologyDetail(id, params) {
  const row = technologyRows.find((item) => item.id === id);
  if (!row) return empty("Profile not found", "This resource does not exist in the design fixtures.");
  const orca = id === "orca";
  return `<a class="crumb" href="#technology?view=directory">Technology Watch / Directory</a><div class="heading"><div><p class="eyebrow">${row.type} / ${row.organization}</p><h1 class="detail-title">${row.title}</h1><p class="detail-dek">${row.purpose}</p></div>${saveControl(row.id, row.title)}</div>${stateNotice(params)}<div class="body-grid"><div><div class="notice"><strong>${row.license}</strong><p>${orca ? "Review the primary license before clinical use. No deployment permission is implied." : "Synthetic artifact and license assessment; not a real product."}</p></div><section class="detail-section"><h2>Purpose and scope</h2><p>${orca ? "An offline reference workflow, not live order entry or patient-specific decision support." : row.purpose}</p></section><section class="detail-section"><h2>Documented workflow</h2><div class="workflow"><div><strong>1. Inputs</strong><p>${orca ? "Institution-specific order-set extract; fabricated demo content." : "Synthetic source data and documented schema."}</p></div><div><strong>2. Processing</strong><p>${orca ? "Convert extracted content into structured files." : "Versioned transformation and quality checks."}</p></div><div><strong>3. Output</strong><p>${orca ? "Viewer with offline reference access." : "Documented query or research output."}</p></div></div></section><section class="detail-section"><h2>Access and prerequisites</h2><dl class="facts"><dt>Setup status</dt><dd>${orca ? "Maintainer documentation; not desk-tested" : "Synthetic example only"}</dd><dt>Institution work</dt><dd>${orca ? "Data extraction, configuration, hosting, and access review" : "Verify schema, access conditions, and intended use"}</dd><dt>Release</dt><dd>${row.date}</dd><dt>License</dt><dd>${row.license}; checked revision must be recorded before publication</dd></dl></section><section class="detail-section"><h2>Evidence and limitations</h2><p>${orca ? "The bibliographic record identifies regional affiliations. The full study and a deployment were not evaluated for this blueprint." : "Research status, limitations, and artifact relationships would be independently verified."}</p><details><summary>Local relationship evidence</summary><p>${row.relation}. ${orca ? "See the repository and paper record below." : "Synthetic evidence only; no claim about a real institution."}</p></details>${orca ? '<div class="source-links"><a href="https://github.com/Stephonomon/orca-cds">Repository and setup documentation</a><a href="https://github.com/Stephonomon/orca-cds/blob/main/LICENSE.md">Primary license</a><a href="https://pubmed.ncbi.nlm.nih.gov/40419254/">Paper record</a></div>' : ""}</section></div>${technologyAside()}</div>`;
}
function newsList(params, id) {
  const rows = newsRows.filter((row) => (!id || row.id === id) && matches(row, params, ["topic", "org"]));
  return `${id ? '<a class="crumb" href="#news">News</a>' : ""}${heading("news", id ? "News / sample story" : "News")}${stateNotice(params)}${id ? "" : filters("news", params, [["org", "Organization", [...new Set(newsRows.map((row) => row.org))]], ["topic", "Topic", ["Interoperability", "Resilience"]]])}<div class="body-grid"><section aria-label="News results">${resultState(params, rows.length ? rows.map((row) => `<article class="result"><div class="eyebrow">Synthetic News fixture / ${row.topic}</div><h2><a href="#news/${row.id}">${row.title}</a></h2><p>${row.summary}</p><div class="result-meta"><span>${row.date}</span><span>${row.org}</span></div>${id ? '<section class="detail-section"><h2>Previous development</h2><p>Related coverage uses explicit subject links; a source refresh does not change this story date.</p><div class="source-links"><a href="#technology/orca">Technology profile example</a><a href="#policy/pa-01">Policy record example</a></div></section>' : ""}</article>`).join("") : empty())}</section><aside><section class="aside-block"><h2>Policy Watch</h2><p><a href="#policy/pa-01">Clinical AI disclosure proposal</a></p><p class="subtle">Synthetic policy / amended-text review hold</p></section><section class="aside-block"><h2>Technology Watch</h2><p><a href="#technology/orca">ORCA</a></p><p class="subtle">Research example / restricted source</p></section></aside></div>`;
}
function eventsList(params, id) {
  const rows = eventRows.filter((row) => (!id || row.id === id) && matches(row, params, ["format", "county", "status"]));
  return `${id ? '<a class="crumb" href="#events">Events</a>' : ""}${heading("events", id ? "Event / sample record" : "Events")}${stateNotice(params)}${id ? "" : filters("events", params, [["county", "County", ["Philadelphia", "Camden", "New Castle"]], ["format", "Format", ["In person", "Virtual"]], ["status", "Status", ["Upcoming", "Cancelled"]]])}<div class="body-grid"><section aria-label="Event results">${resultState(params, rows.length ? rows.map((row) => `<article class="result"><p class="event-date">${row.date} / ${row.time} / fixture</p><h2><a href="#events/${row.id}">${row.title}</a></h2><p>${row.summary}</p><div class="result-meta"><span class="status ${row.status === "Cancelled" ? "ended" : ""}">${row.status}</span><span>${row.format}</span><span>${row.county}</span><span>${row.price}</span></div>${id ? `<section class="detail-section"><h2>Attendance record</h2><dl class="facts"><dt>Host</dt><dd>${row.host}</dd><dt>Registration</dt><dd>No real registration link: synthetic event</dd><dt>Why attend</dt><dd>Sample regional informatics discussion</dd></dl></section>` : ""}</article>`).join("") : empty())}</section><aside><section class="aside-block"><h2>Chapter Radar</h2><p class="subtle">Existing chapter coverage retains its place.</p><div class="aside-item"><strong>Example chapter</strong><p><a href="#events/event-01">Regional health data forum</a></p></div></section><section class="aside-block"><h2>Next Up</h2><p><a href="#events/event-02">Clinical informatics research roundtable</a></p><p class="subtle">Sep 29 / virtual / synthetic</p></section></aside></div>`;
}
function render() {
  const { section, id, params } = route();
  const wasInMain = main.contains(document.activeElement);
  const focusedName = wasInMain ? document.activeElement.name : null;
  main.className = section;
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav === section) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.querySelector("#fixture-state").value = params.get("state") || "ready";
  const names = { policy: "Policy Watch", technology: "Technology Watch", news: "News", events: "Events" };
  document.title = `${names[section] || "Not found"} | The Valley Desk design fixtures`;
  if (section === "policy") main.innerHTML = id ? policyDetail(id, params) : policyList(params);
  else if (section === "technology") main.innerHTML = id ? technologyDetail(id, params) : technologyList(params);
  else if (section === "news") main.innerHTML = newsList(params, id);
  else if (section === "events") main.innerHTML = eventsList(params, id);
  else main.innerHTML = '<h1>Page not found</h1><p><a href="#policy">Policy Watch</a></p>';
  if (id && ["error", "empty"].includes(params.get("state"))) {
    main.innerHTML = heading(section, names[section] || "Record") + resultState(params, "");
  }
  if (focusedName) main.querySelector(`[name="${CSS.escape(focusedName)}"]`)?.focus();
  else if (wasInMain) main.focus();
  announcement.textContent = `${names[section] || "Page"} loaded. ${main.querySelectorAll(".result, .person").length} sample rows.`;
  main.dataset.renderedRoute = location.hash;
}
main.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-filter]");
  if (!form) return;
  event.preventDefault();
  const { section, params } = route();
  const values = Object.fromEntries(new FormData(form));
  location.hash = href(section, { view: params.get("view"), state: params.get("state"), ...values }).slice(1);
});
main.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-save]")) {
    if (target.checked) saved.add(target.dataset.save); else saved.delete(target.dataset.save);
    try { localStorage.setItem(storageKey, JSON.stringify([...saved])); }
    catch { announcement.textContent = "Saved for this session; browser storage is unavailable."; }
    const count = document.querySelector("#saved-count");
    if (count) count.textContent = `${saved.size} saved`;
  } else if (target.matches("select")) {
    const { section, params } = route();
    if (target.name === "jurisdiction" && params.get("view") === "representatives") {
      params.set("jurisdiction", target.value);
      params.delete("body");
      params.delete("district");
      location.hash = href(section, Object.fromEntries(params)).slice(1);
    } else target.closest("form")?.requestSubmit();
  }
});
main.addEventListener("click", (event) => {
  if (!event.target.closest("[data-retry]")) return;
  const { section, id, params } = route();
  params.delete("state");
  location.hash = href(`${section}${id ? `/${id}` : ""}`, Object.fromEntries(params)).slice(1);
});
document.querySelector("#fixture-state").addEventListener("change", (event) => {
  const { section, id, params } = route();
  params.set("state", event.target.value);
  location.hash = href(`${section}${id ? `/${id}` : ""}`, Object.fromEntries(params)).slice(1);
});
window.addEventListener("hashchange", render);
document.querySelector(".skip").addEventListener("click", (event) => {
  event.preventDefault();
  main.focus();
  main.scrollIntoView();
});
render();
