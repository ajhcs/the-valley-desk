"use strict";

const criteria = {
  usefulPurpose: "Useful purpose",
  healthRelevance: "Health relevance",
  datedRegionalBasis: "Dated regional basis",
  originalLink: "Original link",
};
const states = { queued: "Queued", held: "Held", rejected: "Rejected", eligible: "Admission-ready" };
const findings = { unknown: "Unknown", supported: "Supported", unsupported: "Unsupported" };
const pageSize = 24;
const get = (id) => document.getElementById(id);
const drafts = new Map();
let candidates = [];
let matching = [];
let selectedId = null;
let page = 0;
let saving = false;

const sessionKey = "valleyDeskReviewSession";

async function reviewFetch(path, options = {}) {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has("access")) {
    const access = fragment.get("access");
    history.replaceState(null, "", location.pathname + location.search);
    sessionStorage.removeItem(sessionKey);
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access }),
    });
    if (!response.ok) throw new Error("access");
    const session = await response.json();
    if (typeof session.token !== "string" || !session.token) throw new Error("access");
    sessionStorage.setItem(sessionKey, session.token);
  }
  const token = sessionStorage.getItem(sessionKey);
  if (!token) throw new Error("access");
  const response = await fetch(path, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    sessionStorage.removeItem(sessionKey);
    throw new Error("access");
  }
  return response;
}

function node(tag, { className, text, attrs = {} } = {}, children = []) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}

function externalLink(locator, text, className) {
  if (!locator) return null;
  try {
    const url = new URL(locator);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return node("a", {
      className, text, attrs: {
        href: url.href, target: "_blank", rel: "noopener noreferrer",
        "aria-label": `${text} (${url.hostname}, opens in a new tab)`,
      },
    });
  } catch {
    return null;
  }
}

function tagged(state) {
  return node("span", { text: states[state], className: "tag", attrs: { "data-state": state } });
}

function repoTags(candidate) {
  return [
    tagged(candidate.decision?.decision ?? "queued"),
    ...(candidate.fork ? [node("span", { text: "Fork" })] : []),
    ...(candidate.archived ? [node("span", { text: "Archived" })] : []),
  ];
}

function renderQueue() {
  const terms = get("search").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const state = get("status-filter").value;
  const fork = get("fork-filter").value;
  matching = candidates.filter((candidate) =>
    (state === "all" || state === (candidate.decision?.decision ?? "queued")) &&
    (fork === "all" || candidate.fork === (fork === "fork")) &&
    terms.every((term) => candidate.searchText.includes(term)),
  );
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
  page = Math.min(page, pageCount - 1);
  const start = page * pageSize;
  let countText = candidates.length ? "No candidates match these filters." : "The queue is empty.";
  if (matching.length) countText = `Showing ${start + 1}–${Math.min(start + pageSize, matching.length)} of ${matching.length}`;
  get("results-count").textContent = countText;
  get("candidate-list").replaceChildren(...matching.slice(start, start + pageSize).map((candidate) => {
    const row = node("button", { className: "candidate", attrs: { type: "button", "aria-controls": "detail" } }, [
      node("span", { text: candidate.repository, className: "candidate-title" }),
      node("span", { text: candidate.description || "No repository description", className: "candidate-description" }),
      node("span", { className: "meta-row" }, repoTags(candidate)),
    ]);
    row.disabled = saving;
    if (candidate.nativeId === selectedId) row.setAttribute("aria-current", "true");
    row.addEventListener("click", () => selectCandidate(candidate));
    return node("li", {}, [row]);
  }));
  get("pagination").hidden = pageCount < 2;
  get("prev-page").disabled = page === 0;
  get("next-page").disabled = page === pageCount - 1;
  get("page-number").textContent = `Page ${page + 1} of ${pageCount}`;
}

function renderTotals() {
  const counts = { queued: 0, held: 0, rejected: 0, eligible: 0 };
  for (const candidate of candidates) counts[candidate.decision?.decision ?? "queued"]++;
  const totals = get("totals");
  totals.replaceChildren(...Object.keys(states).map((state) => node("div", {}, [
    node("dt", { text: states[state] }),
    node("dd", { text: String(counts[state]) }),
  ])));
  totals.hidden = false;
}

function selectCandidate(candidate) {
  if (saving) return;
  selectedId = candidate.nativeId;
  renderQueue();
  renderDetail(candidate);
  get("detail-heading").focus();
}

function selectField(name, options, initial) {
  const input = node("select", { attrs: { name } }, Object.entries(options).map(([value, text]) =>
    node("option", { text, attrs: { value } }),
  ));
  input.value = initial;
  return input;
}

function labeled(text, field, className) {
  const id = `review-field-${field.name}`;
  field.id = id;
  return node("div", { className: className ? `labeled-field ${className}` : "labeled-field" }, [
    node("label", { text, attrs: { for: id } }),
    field,
  ]);
}

function evidenceField(candidate, draft) {
  const field = node("fieldset", { className: "field-group" }, [node("legend", { text: "Evidence" })]);
  if (!candidate.evidence.length) {
    field.append(node("p", { text: "No evidence is retained for this candidate.", className: "muted hint" }));
    return field;
  }
  field.append(node("p", { text: "Select the retained evidence that supports your findings.", className: "muted hint" }));
  const list = node("ul", { className: "evidence-list" });
  for (const evidence of candidate.evidence) {
    const box = node("input", { attrs: { type: "checkbox", name: "evidenceRefs", value: evidence.id } });
    box.checked = draft.evidenceRefs.includes(evidence.id);
    const source = externalLink(evidence.locator, "Open source");
    const scope = evidence.criteria.map((name) => criteria[name]).filter(Boolean);
    if (evidence.observedDate) scope.unshift(`Checked ${evidence.observedDate}`);
    list.append(node("li", {}, [
      node("label", {}, [box, node("span", { text: evidence.fact })]),
      node("div", { className: "evidence-source" }, [
        source ?? node("span", { text: evidence.localLocator ?? "Local record", className: "muted" }),
        node("span", { text: scope.join(" · "), className: "muted" }),
      ]),
    ]));
  }
  field.append(list);
  return field;
}

function textField(name, value, length, multiline = false) {
  const attrs = { name, maxlength: String(length) };
  if (multiline) attrs.rows = "2";
  const input = node(multiline ? "textarea" : "input", { attrs });
  input.value = value ?? "";
  return input;
}

function listingField(listing) {
  const region = listing?.regionalBasis;
  const date = node("input", {
    attrs: {
      name: "regionalDate", maxlength: "10", placeholder: "YYYY-MM-DD",
      "aria-describedby": "regional-date-hint", pattern: "[0-9]{4}(-[0-9]{2}){0,2}",
    },
  });
  date.value = region?.date ?? "";
  const dateBasis = selectField("regionalDateBasis", {
    source: "Source date", observation: "Observation date",
  }, region?.dateBasis ?? "source");
  return node("fieldset", { className: "field-group" }, [
    node("legend", { text: "Listing draft" }),
    node("p", { text: "Summarize the selected evidence and qualify the regional connection.", className: "muted hint" }),
    node("div", { className: "listing-fields" }, [
      labeled("Title", textField("title", listing?.title, 160), "wide"),
      labeled("Purpose", textField("purpose", listing?.purpose, 600, true), "wide"),
      labeled("Health relevance summary", textField("listingHealthRelevance", listing?.healthRelevance, 600, true), "wide"),
      labeled("Regional connection", textField("regionalText", region?.text, 600, true), "wide"),
      node("div", {}, [
        labeled("Regional date", date),
        node("p", { text: "YYYY, YYYY-MM, or YYYY-MM-DD", className: "muted hint", attrs: { id: "regional-date-hint" } }),
      ]),
      labeled("Date basis", dateBasis),
      labeled("Scope and limitations", textField("regionalScope", region?.scope, 600, true), "wide"),
    ]),
  ]);
}

function blankDraft(candidate) {
  const decision = candidate.decision;
  return {
    criteria: Object.fromEntries(Object.keys(criteria).map((name) => [name, decision?.criteria?.[name] ?? "unknown"])),
    evidenceRefs: decision?.evidenceRefs ?? [],
    reason: decision?.reason ?? "",
    expectedRevision: decision?.revision ?? 0,
    preparedListing: decision?.preparedListing,
  };
}

function proposedState(values) {
  if (values.includes("unsupported")) return "rejected";
  return values.includes("unknown") ? "held" : "eligible";
}

function readDraft(form, expectedRevision) {
  const values = new FormData(form);
  const text = (name) => String(form.elements.namedItem(name)?.value ?? "").trim().replace(/\s+/g, " ");
  return {
    expectedRevision,
    criteria: Object.fromEntries(Object.keys(criteria).map((name) => [name, text(name)])),
    evidenceRefs: values.getAll("evidenceRefs"),
    reason: text("reason"),
    preparedListing: {
      title: text("title"),
      purpose: text("purpose"),
      healthRelevance: text("listingHealthRelevance"),
      regionalBasis: {
        text: text("regionalText"),
        date: text("regionalDate"),
        dateBasis: text("regionalDateBasis"),
        scope: text("regionalScope"),
      },
    },
  };
}

function renderDetail(candidate) {
  const draft = drafts.get(candidate.nativeId) ?? blankDraft(candidate);
  const back = node("a", { text: "Back to candidates", className: "back-to-queue", attrs: { href: "#queue-heading" } });
  back.addEventListener("click", (event) => {
    event.preventDefault();
    get("queue-heading").focus();
  });
  const heading = node("h2", { text: candidate.repository, attrs: { id: "detail-heading", tabindex: "-1" } });
  const header = node("div", { className: "panel-header" }, [
    back,
    heading,
    node("div", { className: "meta-row" }, [
      ...repoTags(candidate),
      node("span", { text: `GitHub ID ${candidate.nativeId}`, className: "muted" }),
    ]),
    node("p", { text: candidate.description || "No repository description", className: "detail-description" }),
  ]);
  const original = externalLink(candidate.originalUrl, "Open observed repository", "original-link");
  if (original) header.append(original);
  const aliases = (candidate.observedAliases ?? []).filter((url) => url !== candidate.originalUrl);
  if (aliases.length) {
    header.append(node("p", { text: "Observed repository addresses differ. Verify the current link before marking admission-ready.", className: "muted" }),
      node("ul", {}, aliases.map((url) => node("li", {}, [externalLink(url, url)]))));
  }

  const assessment = candidate.assessment;
  if (assessment) {
    const sources = [
      externalLink(assessment.source, "Open original follow-up"),
      externalLink(assessment.recheckSource, "Open recheck source"),
    ].filter(Boolean);
    header.append(node("section", { attrs: { "aria-label": "Private assessment" } }, [
      node("h3", { text: "Private assessment" }),
      node("p", { text: assessment.purpose ?? "Purpose needs evidence." }),
      node("p", { text: assessment.reason }),
      node("p", { text: `First check: ${assessment.originalOutcome}` }),
      ...(assessment.recheckOutcome ? [node("p", { text: `Recheck: ${assessment.recheckOutcome}` })] : []),
      ...sources.map(source => node("p", {}, [source])),
    ]));
  }

  const form = node("form", { className: "review-form" });
  const criterionField = node("fieldset", { className: "field-group" }, [
    node("legend", { text: "Review criteria" }),
    node("div", { className: "criteria-grid" }, Object.entries(criteria).map(([name, text]) =>
      labeled(text, selectField(name, findings, draft.criteria[name])),
    )),
  ]);
  const note = textField("reason", draft.reason, 1000, true);
  note.required = true;
  const listing = listingField(draft.preparedListing);
  const save = node("button", { text: "Save decision", className: "primary", attrs: { type: "submit" } });
  const saveNext = node("button", { text: "Save and open next", className: "secondary", attrs: { type: "submit" } });
  const preview = node("span");
  const feedback = node("p", { className: "save-feedback", attrs: { role: "status" } });
  const controls = node("fieldset", { className: "form-controls" }, [
    evidenceField(candidate, draft), criterionField, labeled("Decision note", note), listing,
    node("div", { className: "review-footer" }, [
      node("p", {}, [document.createTextNode("Decision preview: "), preview]),
      node("p", { text: "Saving records a private review decision.", className: "hint" }),
      node("div", { className: "review-actions" }, [save, saveNext]),
    ]),
  ]);

  function refreshPreview(values) {
    const state = proposedState(Object.values(values.criteria));
    preview.replaceChildren(tagged(state));
    listing.hidden = state !== "eligible";
    listing.disabled = listing.hidden;
    for (const input of listing.querySelectorAll("input, select, textarea")) input.required = true;
  }

  const setFeedback = (message, error = false) => {
    feedback.textContent = message;
    feedback.toggleAttribute("data-error", error);
  };

  form.append(controls, feedback);
  get("detail").replaceChildren(header, form);
  refreshPreview(draft);
  form.addEventListener("input", () => {
    const values = readDraft(form, draft.expectedRevision);
    drafts.set(candidate.nativeId, values);
    refreshPreview(values);
    setFeedback("Unsaved changes");
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    const decision = readDraft(form, draft.expectedRevision);
    const state = proposedState(Object.values(decision.criteria));
    const coverage = new Set(candidate.evidence.filter(({ id }) => decision.evidenceRefs.includes(id)).flatMap(({ criteria }) => criteria));
    const missing = Object.keys(criteria).filter((name) => decision.criteria[name] !== "unknown" && !coverage.has(name));
    if (missing.length) {
      setFeedback(`Select evidence for ${missing.map((name) => criteria[name].toLowerCase()).join(", ")}.`, true);
      return;
    }
    if (state === "eligible" && aliases.length) {
      setFeedback("Verify the current repository link before marking admission-ready.", true);
      return;
    }
    if (!decision.reason) {
      setFeedback("Enter a decision note.", true);
      note.focus();
      return;
    }
    const index = matching.findIndex(({ nativeId }) => nativeId === candidate.nativeId);
    const next = event.submitter === saveNext && index >= 0 ? matching[index + 1] : null;
    if (state !== "eligible") delete decision.preparedListing;
    saving = true;
    controls.disabled = true;
    setFeedback("Saving decision…");
    renderQueue();
    try {
      const response = await reviewFetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nativeId: candidate.nativeId, ...decision }),
      });
      if (response.status === 409) {
        setFeedback("This decision changed in another session. Copy your unsaved note and reload the page.", true);
        return;
      }
      if (!response.ok) throw new Error("save");
      const result = await response.json();
      if (!result.decision || !Object.hasOwn(states, result.decision.decision)) throw new Error("response");
      candidate.decision = result.decision;
      drafts.delete(candidate.nativeId);
      renderTotals();
      saving = false;
      renderQueue();
      if (next && matching.includes(next)) {
        page = Math.floor(matching.indexOf(next) / pageSize);
        selectCandidate(next);
      } else {
        renderDetail(candidate);
        get("detail-heading").focus();
      }
      get("detail").querySelector(".save-feedback").textContent = `Saved as ${states[result.decision.decision]}.`;
    } catch {
      setFeedback("The decision was not saved. Check its fields and try again.", true);
    } finally {
      controls.disabled = false;
      if (saving) {
        saving = false;
        renderQueue();
      }
    }
  });
}

async function loadQueue() {
  get("queue-error").hidden = true;
  get("retry").hidden = true;
  get("results-count").textContent = "Loading review queue…";
  try {
    const response = await reviewFetch("/api/review", { cache: "no-store" });
    if (!response.ok) throw new Error("queue");
    const data = await response.json();
    candidates = data.candidates.map((candidate) => ({
      ...candidate,
      searchText: [candidate.repository, candidate.description, candidate.nativeId, candidate.assessment?.purpose].filter(Boolean).join(" ").toLowerCase(),
    }));
    renderTotals();
    renderQueue();
  } catch (error) {
    get("results-count").textContent = "Queue unavailable.";
    get("queue-error").textContent = error.message === "access"
      ? "Open the URL in the server’s private launch file. To get a new link, restart the server."
      : "Could not load the review queue. Check that the local review server is running.";
    get("queue-error").hidden = false;
    get("retry").hidden = false;
  }
}

function updateFilters() {
  page = 0;
  renderQueue();
}

get("search").addEventListener("input", updateFilters);
get("status-filter").addEventListener("change", updateFilters);
get("fork-filter").addEventListener("change", updateFilters);
get("clear-filters").addEventListener("click", () => {
  get("search").value = "";
  get("status-filter").value = "all";
  get("fork-filter").value = "all";
  updateFilters();
  get("search").focus();
});
get("prev-page").addEventListener("click", () => {
  page--;
  renderQueue();
  get("queue-heading").focus();
});
get("next-page").addEventListener("click", () => {
  page++;
  renderQueue();
  get("queue-heading").focus();
});
get("retry").addEventListener("click", loadQueue);
loadQueue();
