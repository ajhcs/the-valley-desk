/**
 * Reader support: a short letter, two ways to give (a lifetime founder gift or a 12-month gift, each
 * priced for individuals and institutions) and an invitation to give in kind. Supporters are thanked
 * by name in the home page footer (public-support-band.ts). The page stays unpublished (404, no footer
 * link, no sitemap entry) until a checkout link is set in src/content/support.json.
 */
import { directoryCatalog } from "./public-directory-data";
import { renderDirectoryPage } from "./public-directory-page";
import { html } from "./public-directory-ui";
import { httpsUrl, supportData, supportPath, type SupportData } from "./public-support-data";

export { supportOpen, supportPath } from "./public-support-data";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

type Card = { tier: "founder" | "year"; eyebrow: string; title: string; text: string; action: string };
const cards: Card[] = [
  {
    tier: "founder", eyebrow: "One gift, for good", title: "Founding supporter", action: "founding supporter",
    text: "Listed among the founders at the foot of the home page for as long as The Valley Desk runs.",
  },
  {
    tier: "year", eyebrow: "Twelve months", title: "Supporter", action: "supporter for twelve months",
    text: "Listed with the year’s supporters at the foot of the home page for twelve months from your gift.",
  },
];

function offer(data: SupportData, card: Card, who: "person" | "institution") {
  const key = `${who}${card.tier === "founder" ? "Founder" : "Year"}` as keyof SupportData["checkout"];
  const link = httpsUrl(data.checkout[key]);
  if (!link) return "";
  const price = usd(data.prices[key]);
  const label = who === "person" ? "Individual" : "Institution";
  return `<li class="offer-row">
          <span class="offer-who">${label}</span>
          <span class="offer-price">${html(price)}</span>
          <a class="button ${card.tier === "founder" ? "primary" : "secondary"}" href="${html(link)}" rel="noopener" aria-label="Give ${html(price)} as ${who === "person" ? "an individual" : "an institution"} ${card.action}">Give</a>
        </li>`;
}

function ways(data: SupportData) {
  return cards.map((card) => {
    const rows = offer(data, card, "person") + offer(data, card, "institution");
    if (!rows) return "";
    return `<section class="offer offer-${card.tier}" aria-labelledby="offer-${card.tier}-title">
        <p class="offer-eyebrow">${card.eyebrow}</p>
        <h3 id="offer-${card.tier}-title">${card.title}</h3>
        <p class="offer-text">${card.text}</p>
        <ul class="offer-rows">${rows}</ul>
      </section>`;
  }).join("");
}

export function supportContent(data: SupportData = supportData) {
  const email = data.inKindEmail.trim();
  const mailto = `mailto:${email}?subject=${encodeURIComponent("Gift in kind for The Valley Desk")}`;
  return `<article class="frame page prose-page support-page">
    <header class="support-head">
      <p class="eyebrow">Support</p>
      <h1>Keep The Valley Desk free and independent</h1>
      <p class="lede">The directory has no advertising, no paywall and no sponsored listings, and it doesn’t sell reader data. Readers and institutions who find it useful pay for what it costs to run.</p>
    </header>

    <section class="support-letter" aria-label="A note from the founder">
      <p>I started The Valley Desk because good healthcare research in this region was hard to find in one place: the papers, the code, the datasets, the trials. Keeping it accurate takes steady work, and the servers and data sources cost money each month.</p>
      <p>If the directory has saved you time, I’d be grateful for your support. Every gift is thanked by name at the foot of the home page.</p>
      <p class="support-signature">Cole Lyons</p>
    </section>

    <section class="support-give" aria-labelledby="support-give-title">
      <h2 id="support-give-title">Ways to give</h2>
      <div class="offers">${ways(data)}</div>
      <p class="muted support-fine">At checkout, enter the name to show: yours, your institution’s, or someone you’d like to honor. You can add a website for the name to link to, and, for a gift in someone else’s name, who it’s from. Leave the name blank to give without being named. Payment is handled by Stripe, and your card details never reach this site.</p>
    </section>

    ${email ? `<section class="support-in-kind" aria-labelledby="support-in-kind-title">
      <h2 id="support-in-kind-title">Gifts in kind</h2>
      <p>Organizations can also support the directory with what they already have: data access, compute or API credits, research expertise, or help reaching the people who would use it. In-kind partners are thanked at the foot of the home page alongside supporters.</p>
      <p><a class="button secondary" href="${html(mailto)}">Email ${html(email)}</a></p>
    </section>` : ""}

    <p class="muted support-fine support-closing">Support never affects what the directory lists. Every listing meets the same published <a href="/discover/methodology">evidence rules</a>.</p>
  </article>`;
}

export function supportPage(origin: string, nonce?: string, data: SupportData = supportData) {
  return renderDirectoryPage(
    {
      kind: "research",
      title: "Support The Valley Desk",
      summary: "The Valley Desk is free, with no advertising or sponsored listings. Become a founding supporter or support it for a year, as a person or an institution, or give in kind.",
      path: supportPath,
      content: supportContent(data),
      schema: { "@type": "WebPage", name: "Support The Valley Desk", url: origin + supportPath, isPartOf: { "@id": origin + "/#website" } },
    },
    directoryCatalog,
    origin,
    nonce,
  );
}

export function handleSupport(request: Request, origin: string, nonce?: string, data: SupportData = supportData) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  const body = supportPage(origin, nonce, data);
  return new Response(method === "HEAD" ? null : body, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
