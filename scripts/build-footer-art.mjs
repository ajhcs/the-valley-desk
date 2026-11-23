#!/usr/bin/env node
/**
 * Philadelphia from the Schuylkill, for the site footer: the Art Museum and Boathouse Row on the
 * left, City Hall and the Center City towers in the middle, Old City and the Ben Franklin Bridge on
 * the right, all reflected in the river. Writes a dusk (light) and a night (dark) version.
 * Deterministic: the same script always draws the same city.
 *
 *   node scripts/build-footer-art.mjs          # write public/footer-skyline-{light,dark}.svg
 *   node scripts/build-footer-art.mjs --check  # fail if the committed files are stale
 */
import { readFileSync, writeFileSync } from "node:fs";

const W = 2400, H = 420, G = 330; // canvas, and the waterline
const r1 = (n) => Math.round(n * 10) / 10;

const palettes = {
  light: {
    far: "#e7dccd", back: "#c8bdc4", mid: "#7f7d9c", front: "#232848", water: "#1b2042",
    reflect: "#4a5288", ripple: "#1b2042", glint: "#f2c9a0", windows: "rgba(251,250,247,.13)",
    lit: null, boat: "rgba(246,231,200,.55)", sun: "#f2c9a0", sunOpacity: 0.75, moon: false, stars: false, gulls: "#232848",
  },
  dark: {
    far: "#1b2040", back: "#232a4e", mid: "#2a3160", front: "#0c0e1d", water: "#0a0c18",
    reflect: "#2a3160", ripple: "#0a0c18", glint: "#f0c26b", windows: "rgba(255,255,255,.035)",
    lit: "#f0c26b", boat: "#f3d58a", sun: "#ece6d2", sunOpacity: 0.9, moon: true, stars: true, gulls: null,
  },
};

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rect = (x, y, w, h) => `M${r1(x)},${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`;
const poly = (...pts) => `M${pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join("L")}Z`;

/** A plain tower: flat, stepped or chamfered top. Returns its outline and the box used for windows. */
function tower(x, w, h, top, rand) {
  const y = G - h;
  const parts = [rect(x, y, w, h)];
  if (top === "stepped") {
    parts.push(rect(x + w * 0.15, y - 8, w * 0.7, 8), rect(x + w * 0.32, y - 14, w * 0.36, 6));
  } else if (top === "chamfer") {
    parts.push(poly([x, y], [x + w * 0.25, y - 7], [x + w * 0.75, y - 7], [x + w, y]));
  } else if (top === "mast") {
    parts.push(rect(x + w / 2 - 1, y - 18 - rand() * 10, 2, 18 + rand() * 10));
  }
  return { d: parts.join(""), box: { x, y, w, h } };
}

/** Back-to-front strips of generic buildings, so the landmarks read against a believable city. */
function strip(rand, from, to, minH, maxH, minW, maxW, tops) {
  const out = [];
  for (let x = from; x < to;) {
    const w = minW + rand() * (maxW - minW);
    const h = minH + rand() * (maxH - minH);
    out.push(tower(x, w, h, tops[Math.floor(rand() * tops.length)], rand));
    x += w * (0.7 + rand() * 0.5);
  }
  return out;
}

function windows(boxes, p, rand) {
  // Fine vertical mullions by day; a scatter of lit rooms by night.
  const lines = [], lit = [];
  for (const { x, y, w, h } of boxes) {
    if (w < 14 || h < 30) continue;
    for (let wx = x + 4; wx < x + w - 3; wx += 4.5) lines.push(rect(wx, y + 5, 0.7, h - 8));
    if (!p.lit) continue;
    for (let wy = y + 6; wy < G - 6; wy += 5.5) {
      for (let wx = x + 3; wx < x + w - 4; wx += 4.5) if (rand() < 0.12) lit.push(rect(wx, wy, 2.2, 2.4));
    }
  }
  return { lines: lines.join(""), lit: lit.join("") };
}

// ---- Landmarks ------------------------------------------------------------------------------

function cityHall() {
  const c = 1020;
  return [
    rect(940, G - 62, 160, 62),
    rect(936, G - 78, 26, 16), poly([936, G - 78], [949, G - 92], [962, G - 78]),
    rect(1078, G - 78, 26, 16), poly([1078, G - 78], [1091, G - 92], [1104, G - 78]),
    rect(1003, G - 92, 34, 30), poly([1003, G - 92], [c, G - 102], [1037, G - 92]),
    rect(1004, G - 196, 32, 104),
    rect(999, G - 216, 42, 20),
    rect(1005, G - 200, 30, 20),
    `M1005,${G - 200}Q1007,${G - 266} ${c},${G - 271}Q1033,${G - 266} 1035,${G - 200}Z`,
    rect(c - 2, G - 287, 4, 17), rect(c - 1.3, G - 291, 2.6, 4), rect(c - 4, G - 291.6, 8, 1.2),
  ].join("");
}
const cityHallClock = (fill) => `<circle cx="1020" cy="${G - 206}" r="5.5" fill="${fill}"/>`;

function oneLiberty() {
  const x = 1160, w = 48;
  return [
    rect(x, G - 214, w, 214), rect(x + 5, G - 230, w - 10, 16),
    poly([x + 5, G - 230], [x + w / 2, G - 270], [x + w - 5, G - 230]),
    rect(x + w / 2 - 1, G - 304, 2, 36),
  ].join("");
}
const oneLibertyChevrons = (stroke) => {
  const cx = 1184;
  return [0, 9, 18].map((k) => `<path d="M${cx - 15 + k * 0.45},${G - 232 - k} L${cx},${G - 262 + k * 0.1} L${cx + 15 - k * 0.45},${G - 232 - k}" fill="none" stroke="${stroke}" stroke-width="1"/>`).join("");
};

function twoLiberty() {
  const x = 1226, w = 40;
  return [rect(x, G - 190, w, 190), rect(x + 5, G - 204, w - 10, 14),
    poly([x + 5, G - 204], [x + w / 2, G - 234], [x + w - 5, G - 204]), rect(x + w / 2 - 0.8, G - 252, 1.6, 20)].join("");
}

const mellon = () => [rect(1066, G - 205, 46, 205), rect(1072, G - 215, 34, 10), rect(1078, G - 224, 22, 9),
  poly([1080, G - 224], [1089, G - 200], [1098, G - 224])].join("");

const comcastCenter = () => poly([1290, G], [1290, G - 270], [1298, G - 280], [1336, G - 284], [1344, G - 274], [1344, G]);

function comcastTech() {
  // The open crown reads as a lantern: draw the frame with an even-odd cut-out.
  const x = 1372, w = 58;
  return `${rect(x, G - 284, w, 284)}${rect(x - 2, G - 316, w + 4, 32)}${rect(x + 8, G - 309, w - 16, 20)}`;
}

const fmc = () => [rect(818, G - 196, 52, 196), rect(814, G - 206, 60, 10), rect(840, G - 222, 2, 16)].join("");
const cira = () => poly([884, G], [884, G - 108], [908, G - 126], [934, G - 98], [934, G]);

function independenceHall() {
  return [rect(1768, G - 40, 76, 40), rect(1796, G - 76, 20, 36), rect(1799, G - 92, 14, 16), rect(1802, G - 102, 8, 10),
    poly([1802, G - 102], [1806, G - 124], [1810, G - 102])].join("");
}

function artMuseum() {
  const hill = `M0,${G}L0,${G - 44}Q150,${G - 74} 300,${G - 80}Q430,${G - 82} 530,${G - 56}Q610,${G - 36} 700,${G - 18}L700,${G}Z`;
  const top = G - 80;
  const temple = (x, w, h, ped) => rect(x, top - h, w, h) + poly([x - 3, top - h], [x + w / 2, top - h - ped], [x + w + 3, top - h]);
  return {
    d: hill + rect(232, top - 6, 136, 8) + temple(255, 90, 26, 13) + temple(180, 62, 20, 9) + temple(358, 62, 20, 9),
    columns: [[258, 342, 26], [183, 239, 20], [361, 417, 20]]
      .map(([a, b, h]) => { let s = ""; for (let x = a; x <= b; x += 6) s += rect(x, top - h + 3, 1.2, h - 4); return s; }).join(""),
  };
}

function boathouseRow() {
  // Nine houses on the water's edge, each outlined the way the real ones are lit at night.
  const houses = [], outlines = [];
  const spec = [[432, 38, 20, 1], [474, 30, 24, 0], [508, 44, 18, 1], [556, 34, 26, 0], [594, 40, 20, 1],
    [638, 32, 23, 0], [674, 42, 19, 1], [720, 34, 25, 0], [758, 40, 21, 1]];
  for (const [x, w, h, turret] of spec) {
    const ridge = G - h - w * 0.3;
    const outline = [[x, G], [x, G - h], [x + w / 2, ridge], [x + w, G - h], [x + w, G]];
    houses.push(poly(...outline));
    outlines.push(`M${outline.map(([a, b]) => `${r1(a)},${r1(b)}`).join("L")}`);
    if (turret) {
      const tx = x + w - 8;
      const t = [[tx, G - h], [tx, G - h - 12], [tx + 3.5, G - h - 22], [tx + 7, G - h - 12], [tx + 7, G - h]];
      houses.push(poly(...t));
      outlines.push(`M${t.map(([a, b]) => `${r1(a)},${r1(b)}`).join("L")}`);
    }
  }
  return { d: houses.join(""), outline: outlines.join("") };
}

function bridge(p) {
  // Ben Franklin Bridge, seen side-on: two towers, the deck, the main cable and its suspenders.
  const deck = G - 38, towers = [2066, 2306], topY = G - 150;
  const towerPath = towers.map((tx) => [rect(tx - 9, topY, 6, G - topY + 4), rect(tx + 3, topY, 6, G - topY + 4),
    rect(tx - 9, topY + 8, 18, 4), rect(tx - 9, topY + 52, 18, 4), rect(tx - 9, deck - 4, 18, 4), rect(tx - 12, topY - 4, 24, 5)].join("")).join("");
  const deckPath = `M1956,${G - 16}Q1995,${deck} 2040,${deck}L${W},${deck}L${W},${deck + 6}L2040,${deck + 6}Q1998,${deck + 6} 1962,${G - 8}Z`;
  const q = (a, c, b, t) => (1 - t) ** 2 * a + 2 * (1 - t) * t * c + t ** 2 * b;
  const spans = [
    [[1985, deck - 2], [2030, G - 95], [towers[0], topY]],
    [[towers[0], topY], [(towers[0] + towers[1]) / 2, G + 58], [towers[1], topY]],
    [[towers[1], topY], [2350, G - 90], [2420, deck - 10]],
  ];
  let cable = "", hangers = "", lights = "";
  for (const [a, c, b] of spans) {
    cable += `M${a[0]},${a[1]}Q${c[0]},${c[1]} ${b[0]},${b[1]}`;
    for (let t = 0.04; t < 0.98; t += 0.035) {
      const x = q(a[0], c[0], b[0], t), y = q(a[1], c[1], b[1], t);
      if (y < deck - 2) hangers += `M${r1(x)},${r1(y)}V${deck}`;
      if (p.lit) lights += `<circle cx="${r1(x)}" cy="${r1(y)}" r="1.1"/>`;
    }
  }
  return { body: towerPath + deckPath, cable, hangers, lights };
}

// ---- Compose --------------------------------------------------------------------------------

function draw(mode) {
  const p = palettes[mode];
  const rand = rng(1682); // the year Penn laid out the city
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMax slice">`);
  out.push(`<defs>
    <clipPath id="water"><rect x="0" y="${G}" width="${W}" height="${H - G}"/></clipPath>
    <mask id="etch"><rect width="${W}" height="${H}" fill="#fff"/>${p.moon ? "" : Array.from({ length: 9 }, (_, i) => `<rect x="520" y="${G - 112 + i * 7 + i * i * 0.3}" width="180" height="${1.2 + i * 0.55}" fill="#000"/>`).join("")}</mask>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="reflection"><rect x="0" y="${G}" width="${W}" height="${H - G}" fill="url(#fade)"/></mask>
  </defs>`);

  // Sky ornaments
  if (p.stars) {
    let s = "";
    for (let i = 0; i < 140; i++) {
      const x = rand() * W, y = 8 + rand() * (G - 170);
      s += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(0.5 + rand() * 0.9)}" opacity="${r1(0.25 + rand() * 0.6)}"/>`;
    }
    out.push(`<g fill="#e8e6f5">${s}</g>`);
  }
  if (p.moon) {
    out.push(`<circle cx="1640" cy="${G - 200}" r="100" fill="${p.sun}" opacity=".025"/><circle cx="1640" cy="${G - 200}" r="62" fill="${p.sun}" opacity=".045"/>`);
    out.push(`<circle cx="1640" cy="${G - 200}" r="24" fill="${p.sun}" opacity="${p.sunOpacity}"/><circle cx="1631" cy="${G - 205}" r="4" fill="#d6cfb8" opacity=".5"/><circle cx="1647" cy="${G - 193}" r="2.6" fill="#d6cfb8" opacity=".45"/>`);
  } else {
    out.push(`<circle cx="610" cy="${G - 112}" r="104" fill="${p.sun}" opacity=".22"/><circle cx="610" cy="${G - 112}" r="78" fill="${p.sun}" opacity="${p.sunOpacity}" mask="url(#etch)"/>`);
  }
  if (p.gulls) {
    out.push(`<g fill="none" stroke="${p.gulls}" stroke-width="1.3" stroke-linecap="round" opacity=".55">${[[742, 118, 1], [770, 104, 0.8], [796, 126, 0.65], [1880, 120, 0.7]]
      .map(([x, y, s]) => `<path d="M${x - 8 * s},${y - 3 * s}Q${x - 4 * s},${y - 6 * s} ${x},${y}Q${x + 4 * s},${y - 6 * s} ${x + 8 * s},${y - 3 * s}"/>`).join("")}</g>`);
  }

  // Far city: a low, pale line all the way across.
  const far = strip(rand, 0, W, 22, 70, 30, 90, ["flat", "flat", "chamfer"]).concat(strip(rand, 780, 1800, 50, 130, 24, 46, ["flat", "mast", "stepped"]));
  out.push(`<path fill="${p.far}" d="${far.map((b) => b.d).join("")}"/>`);

  // Back layer: the body of Center City behind the landmarks.
  const back = strip(rand, 760, 1760, 70, 190, 28, 58, ["flat", "stepped", "chamfer", "mast"]);
  out.push(`<path fill="${p.back}" d="${back.map((b) => b.d).join("")}${mellon()}"/>`);

  // Middle distance: the Art Museum on its hill, trees along Kelly Drive, the west bank.
  const museum = artMuseum();
  let trees = "";
  for (let x = 410; x < 830; x += 9 + rand() * 9) trees += `<circle cx="${r1(x)}" cy="${r1(G - 12 - rand() * 14)}" r="${r1(9 + rand() * 9)}"/>`;
  const midFill = strip(rand, 1440, 1760, 70, 150, 26, 50, ["flat", "stepped", "chamfer"]);
  out.push(`<g fill="${p.mid}"><path d="${museum.d}${midFill.map((b) => b.d).join("")}"/>${trees}</g>`);
  out.push(`<path fill="${mode === "light" ? "rgba(251,250,247,.35)" : "rgba(240,194,107,.45)"}" d="${museum.columns}"/>`);

  // Front: the landmarks and the street wall.
  const filler = [
    ...strip(rand, 1104, 1160, 96, 130, 22, 30, ["flat"]),
    ...strip(rand, 1270, 1290, 120, 150, 18, 22, ["flat"]),
    ...strip(rand, 1432, 1720, 60, 150, 26, 52, ["flat", "stepped", "chamfer", "mast"]),
    ...strip(rand, 1700, 1960, 24, 62, 22, 46, ["flat", "chamfer"]),
    ...strip(rand, 840, 940, 40, 90, 20, 34, ["flat"]),
  ];
  const landmarks = [fmc(), cira(), cityHall(), oneLiberty(), twoLiberty(), comcastCenter(), independenceHall()];
  const boats = boathouseRow();
  const span = bridge(p);
  const frontD = filler.map((b) => b.d).join("") + landmarks.join("") + boats.d + span.body;
  const front = `<path fill="${p.front}" d="${frontD}"/><path fill="${p.front}" fill-rule="evenodd" d="${comcastTech()}"/>
    <path fill="none" stroke="${p.front}" stroke-width="2.4" d="${span.cable}"/>
    <path fill="none" stroke="${p.front}" stroke-width=".8" d="${span.hangers}"/>`;
  out.push(front);

  const towers = [...filler.map((b) => b.box), { x: 1160, y: G - 214, w: 48, h: 214 }, { x: 1226, y: G - 190, w: 40, h: 190 },
    { x: 1290, y: G - 270, w: 54, h: 270 }, { x: 1372, y: G - 284, w: 58, h: 284 }, { x: 818, y: G - 196, w: 52, h: 196 }];
  const win = windows(towers, p, rand);
  out.push(`<path fill="${p.windows}" d="${win.lines}"/>`);
  if (win.lit) out.push(`<path fill="${p.lit}" opacity=".55" d="${win.lit}"/>`);
  out.push(cityHallClock(p.lit ?? "rgba(251,250,247,.5)"));
  out.push(oneLibertyChevrons(mode === "dark" ? "rgba(170,180,255,.55)" : "rgba(251,250,247,.35)"));
  out.push(`<path fill="none" stroke="${p.boat}" stroke-width="1.5" stroke-linecap="round" stroke-dasharray=".1 3.4" d="${boats.outline}"/>`);
  if (span.lights) out.push(`<g fill="${p.lit}" opacity=".8">${span.lights}</g>`);

  // The river, the city upside down in it, and the ripples that break the reflection.
  out.push(`<rect x="0" y="${G}" width="${W}" height="${H - G}" fill="${p.water}"/>`);
  out.push(`<g clip-path="url(#water)" mask="url(#reflection)"><g transform="translate(0 ${2 * G}) scale(1 -1)" fill="${p.reflect}">
    <path d="${frontD}${museum.d}${comcastTech()}"/></g></g>`);
  if (p.lit) {
    // Boathouse Row's lights doubled in the water, the city's best-known reflection.
    out.push(`<g clip-path="url(#water)" opacity=".7"><g transform="translate(0 ${2 * G}) scale(1 -1)">
      <path fill="none" stroke="${p.boat}" stroke-width="1.5" stroke-linecap="round" stroke-dasharray=".1 3.4" d="${boats.outline}"/></g></g>`);
  }
  let ripples = "";
  for (let y = G + 2; y < H; y += 2.6 + rand() * 2.2) {
    for (let x = -40; x < W; x += 60 + rand() * 160) ripples += rect(x, y, 30 + rand() * 120, 1 + rand() * 1.1);
  }
  out.push(`<path fill="${p.ripple}" d="${ripples}"/>`);
  let glint = "";
  const gx = p.moon ? 1640 : 610;
  for (let i = 0; i < 16; i++) {
    const y = G + 6 + i * 4.8, half = (p.moon ? 22 : 70) * (1 - i / 22) * (0.5 + rand() * 0.6);
    glint += rect(gx - half + (rand() - 0.5) * 20, y, half * 2, 1.1);
  }
  out.push(`<path fill="${p.glint}" opacity="${p.moon ? 0.35 : 0.5}" d="${glint}"/>`);
  out.push(`<rect x="0" y="${G}" width="${W}" height="1" fill="${mode === "light" ? "rgba(251,250,247,.25)" : "rgba(170,180,255,.12)"}"/>`);
  out.push(`</svg>`);
  return out.join("\n");
}

const check = process.argv.includes("--check");
let stale = false;
for (const mode of ["light", "dark"]) {
  const file = new URL(`../public/footer-skyline-${mode}.svg`, import.meta.url);
  const svg = draw(mode) + "\n";
  if (check) {
    let current = "";
    try { current = readFileSync(file, "utf8"); } catch {}
    if (current !== svg) { stale = true; console.error(`stale: public/footer-skyline-${mode}.svg`); }
  } else {
    writeFileSync(file, svg);
    console.log(`wrote public/footer-skyline-${mode}.svg (${(svg.length / 1024).toFixed(1)} KB)`);
  }
}
if (stale) process.exit(1);
