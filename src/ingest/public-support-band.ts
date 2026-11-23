/** The supporters band at the foot of the home page: names in the evening sky above the city. */
import { html } from "./public-directory-ui";
import { httpsUrl, listedSupporters, supportData, supportOpen, supportPath, type SupportData, type Supporter } from "./public-support-data";

function patron(s: Supporter) {
  const name = html(s.name.trim());
  const url = httpsUrl(s.url);
  // Supporters' links are paid placements, so search engines are told as much.
  const label = url ? `<a class="patron-link" href="${html(url)}" rel="sponsored noopener">${name}</a>` : name;
  const gift = s.givenBy?.trim() ? ` <span class="patron-gift">gift of ${html(s.givenBy.trim())}</span>` : "";
  return `<li class="patron${s.kind === "institution" ? " is-institution" : ""}">${label}${gift}</li>`;
}

function group(id: string, title: string | null, people: Supporter[], className = "") {
  if (!people.length) return "";
  return `<div class="patron-group${className}">
          ${title ? `<h3 class="patron-group-title" id="${id}">${title}</h3>` : ""}
          <ul class="patron-list"${title ? ` aria-labelledby="${id}"` : ""}>${people.map(patron).join("")}</ul>
        </div>`;
}

export function supportersBand(data: SupportData = supportData, now = new Date()) {
  if (!supportOpen(data)) return "";
  const { founders, supporters, partners } = listedSupporters(data, now);
  const others = Math.max(0, Math.floor(data.unnamed));
  const labelled = [founders, supporters, partners].filter((g) => g.length).length > 1;
  const groups = group("patrons-founders", "Founding supporters", founders, " is-founders")
    + group("patrons-year", labelled ? "Supporters" : null, supporters)
    + group("patrons-in-kind", "In-kind partners", partners, " is-partners");
  const more = others ? `…and ${others.toLocaleString("en-US")} ${others === 1 ? "other" : "others"} who asked not to be named.` : "";
  return `<section class="footer-patrons" id="supporters" aria-labelledby="footer-patrons-title">
      <div class="desk-frame">
        <h2 id="footer-patrons-title" class="patron-title">With thanks to our supporters</h2>
        ${groups || `<p class="patron-first">The first names will appear here.</p>`}
        <p class="patron-more">${more ? `<span>${more}</span>` : ""}<a href="${supportPath}">Become a supporter</a></p>
      </div>
    </section>`;
}
