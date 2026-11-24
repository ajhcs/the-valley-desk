/**
 * The directory's icon set. Every glyph is drawn on a 20 × 20 grid with a 1.5 stroke, round caps and
 * joins, and no fill except where a class below adds one, so the set reads as one family at 14–20 px.
 * Icons inherit the surrounding text colour. An icon is decorative unless it is given a label.
 */
const paths = {
  // Kinds of listing
  software: '<path d="M6.75 6 2.75 10l4 4M13.25 6l4 4-4 4M11.25 4.25l-2.5 11.5"/>',
  publication: '<path d="M5 2.75h6.5l3.5 3.5v11H5z"/><path d="M11.5 2.75v3.5H15M7.5 10h5M7.5 13h5"/>',
  study: '<path d="M7 4H5v13.25h10V4h-2"/><path d="M7.5 2.75h5v2.5h-5zM7 11.75h1.75l1-2.25 1.5 4.25 1-2h1.75"/>',
  dataset: '<rect x="3" y="3.5" width="14" height="13" rx="1"/><path d="M3 7.75h14M3 12h14M7.75 3.5v13"/>',
  // Public data about the region: a folded map
  regional: '<path d="M2.75 5.25 7.5 3.5l5 1.75 4.75-1.75v11.25L12.5 16.5l-5-1.75-4.75 1.75z"/><path d="M7.5 3.5v11.25M12.5 5.25V16.5"/>',
  // Controls
  search: '<circle cx="8.75" cy="8.75" r="5.5"/><path d="m12.9 12.9 4.35 4.35"/>',
  filter: '<path d="M2.75 5.5h14.5M5.5 10h9M8.25 14.5h3.5"/>',
  sort: '<path d="M6 3.5v13M6 16.5l-3-3M6 16.5l3-3M14 16.5v-13M14 3.5l-3 3M14 3.5l3 3"/>',
  arrow: '<path d="M3.5 10h12.5M11.5 5.25 16.25 10l-4.75 4.75"/>',
  close: '<path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/>',
  calendar: '<rect x="3" y="4.25" width="14" height="12.5" rx="1"/><path d="M3 8.25h14M6.75 2.75v3M13.25 2.75v3"/>',
  feed: '<path d="M4 4.25a11.75 11.75 0 0 1 11.75 11.75M4 9a7 7 0 0 1 7 7"/><circle cx="4.75" cy="15.25" r="1.25"/>',
  // Dataset access: an open padlock, a key, a closed padlock
  "access-open": '<rect x="4" y="9" width="12" height="8.25" rx="1"/><path d="M7 9V6.25a3 3 0 0 1 5.85-.95M10 12.25v1.75"/>',
  "access-registration": '<circle cx="6.75" cy="10" r="3.25"/><path d="M10 10h7.25M14.75 10v2.5M17.25 10v2"/>',
  "access-controlled": '<rect x="4" y="9" width="12" height="8.25" rx="1"/><path d="M7 9V6.25a3 3 0 0 1 6 0V9M10 12.25v1.75"/>',
  // Regional evidence
  verified: '<path class="glyph-fill" d="M10 2.5 16 4.75V9.5c0 3.75-2.6 6.6-6 8-3.4-1.4-6-4.25-6-8V4.75z"/><path d="m7.25 9.75 2 2 3.6-3.75"/>',
  listed: '<path d="M10 2.5 16 4.75V9.5c0 3.75-2.6 6.6-6 8-3.4-1.4-6-4.25-6-8V4.75z"/><path d="M7.5 10h5"/>',
  // Who and where
  institution: '<path d="M2.75 7.25 10 3.25l7.25 4M4 7.25h12M5.5 9.25v5M8.5 9.25v5M11.5 9.25v5M14.5 9.25v5M2.75 16.75h14.5"/>',
  place: '<path d="M10 17.5s5.25-4.5 5.25-8.75a5.25 5.25 0 0 0-10.5 0C4.75 13 10 17.5 10 17.5z"/><circle cx="10" cy="8.75" r="1.75"/>',
  account: '<circle cx="10" cy="7" r="3.25"/><path d="M3.75 17c.75-3 3.25-4.75 6.25-4.75s5.5 1.75 6.25 4.75"/>',
  source: '<path d="M11.5 3.25h5.25V8.5M16.75 3.25 9.5 10.5M14.25 11.75v4.5a.5.5 0 0 1-.5.5h-9.5a.5.5 0 0 1-.5-.5v-9.5a.5.5 0 0 1 .5-.5h4.5"/>',
  // Topics
  "biomedical-and-life-sciences": '<path d="M6 2.75c0 4.25 8 3.5 8 7.25s-8 3-8 7.25M14 2.75c0 4.25-8 3.5-8 7.25s8 3 8 7.25M7.25 5h5.5M7.25 15h5.5"/>',
  neuroscience: '<path d="M10 4.25c-.9-1.2-3.4-1.4-4.4.2-1.6.1-2.6 1.9-1.9 3.3-1.2 1-1 3.1.4 3.8-.2 1.6 1.1 3 2.7 2.8.6 1.4 2.4 1.8 3.2.6zM10 4.25c.9-1.2 3.4-1.4 4.4.2 1.6.1 2.6 1.9 1.9 3.3 1.2 1 1 3.1-.4 3.8.2 1.6-1.1 3-2.7 2.8-.6 1.4-2.4 1.8-3.2.6zM10 4.25V15"/>',
  "medical-imaging": '<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="1"/><circle cx="10" cy="10" r="3.25"/><path d="M10 6.75v6.5M6.75 10h6.5"/>',
  "research-data": '<ellipse cx="10" cy="5" rx="6" ry="2.25"/><path d="M4 5v10c0 1.25 2.7 2.25 6 2.25s6-1 6-2.25V5M4 10c0 1.25 2.7 2.25 6 2.25s6-1 6-2.25"/>',
  "disease-research": '<circle cx="10" cy="10" r="4"/><path d="M10 2.75V6M10 14v3.25M2.75 10H6M14 10h3.25M4.9 4.9l2.3 2.3M12.8 12.8l2.3 2.3M4.9 15.1l2.3-2.3M12.8 7.2l2.3-2.3"/>',
  "clinical-care": '<path d="M5.5 2.75v5a3.5 3.5 0 0 0 7 0v-5M4.5 2.75h2M11.5 2.75h2M9 11.25v1.5a4 4 0 0 0 8 0v-2"/><circle cx="17" cy="9" r="1.5"/>',
  "public-health": '<circle cx="6.25" cy="6" r="2"/><circle cx="13.75" cy="6" r="2"/><path d="M2.5 15c.4-2.6 1.9-4 3.75-4s3.35 1.4 3.75 4c.4-2.6 1.9-4 3.75-4s3.35 1.4 3.75 4"/>',
  "rehabilitation-and-accessibility": '<circle cx="10" cy="3.75" r="1.5"/><path d="M5 7.25h10M10 7.25v4.5l3.25 5.5M10 11.75l-3.25 5.5"/>',
  "other-science": '<circle cx="10" cy="10" r="1.75"/><ellipse cx="10" cy="10" rx="7.25" ry="2.75"/><ellipse cx="10" cy="10" rx="7.25" ry="2.75" transform="rotate(60 10 10)"/><ellipse cx="10" cy="10" rx="7.25" ry="2.75" transform="rotate(120 10 10)"/>',
} as const;

export type IconName = keyof typeof paths;

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

/** An inline SVG icon. With a label it is announced as an image; without one it is hidden from assistive technology. */
export function icon(name: IconName, label?: string, className = "") {
  const a11y = label ? `role="img" aria-label="${escape(label)}"` : 'aria-hidden="true"';
  return `<svg class="glyph glyph-${name}${className ? " " + className : ""}" ${a11y} viewBox="0 0 20 20" width="20" height="20" focusable="false">${paths[name]}</svg>`;
}

/** The icon for a topic label, falling back to the general science glyph. */
export function topicIcon(topic: string) {
  const key = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return icon((key in paths ? key : "other-science") as IconName);
}
