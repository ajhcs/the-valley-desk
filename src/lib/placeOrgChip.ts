export type Rect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type ChipBox = { top: number; left: number; width: number; height: number };

const INSET = 8;
const GAP = 8;
const MIN_H = 40;

function box(top: number, left: number, width: number, height: number): Rect {
  return { top, left, right: left + width, bottom: top + height, width, height };
}

function overlaps(a: Rect, b: Rect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function clampLeft(left: number, _width: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(left, min), max);
}

/** Reed geometry: never cover mention, h1/dek, or the rail row. 8px viewport inset. */
export function placeOrgChip(opts: {
  mention: Rect;
  chip: { width: number; height: number };
  viewport: { width: number; height: number };
  header?: Rect | null;
  lead?: Rect | null;
  dek?: Rect | null;
  h1?: Rect | null;
  row?: Rect | null;
  news?: Rect | null;
  column?: Rect | null;
  mobile?: boolean;
}): ChipBox {
  const { mention, chip, viewport, header, lead, dek, h1, row, news, column, mobile } = opts;
  const w = Math.min(chip.width, Math.max(80, viewport.width - INSET * 2));
  const h = chip.height;

  const colLeft = column?.left ?? INSET;
  const colRight = column?.right ?? viewport.width - INSET;
  const minLeft = Math.max(colLeft, INSET);

  const pinLeft = (left: number, width: number) => {
    const maxLeft = Math.min(colRight, viewport.width - INSET) - width;
    return clampLeft(left, width, minLeft, maxLeft);
  };

  const hitsCover = (placed: Rect) =>
    overlaps(placed, mention) ||
    Boolean(h1 && overlaps(placed, h1)) ||
    Boolean(dek && overlaps(placed, dek)) ||
    Boolean(row && overlaps(placed, row)) ||
    Boolean(news && overlaps(placed, news));

  const headerHit = (placed: Rect) => Boolean(header && overlaps(placed, header));

  const fitsViewport = (placed: Rect) =>
    placed.top >= INSET && placed.bottom <= viewport.height - INSET;

  const ok = (placed: Rect) => !hitsCover(placed) && !headerHit(placed) && fitsViewport(placed);

  const tryPlace = (top: number, left: number, width: number, height: number): ChipBox | null => {
    const maxTop = Math.max(INSET, viewport.height - height - INSET);
    const t = Math.min(Math.max(top, INSET), maxTop);
    const l = pinLeft(left, width);
    const placed = box(t, l, width, height);
    if (ok(placed)) return { top: t, left: l, width, height };
    return null;
  };

  const ceiling = () => {
    let top = INSET;
    if (header) top = Math.max(top, header.bottom + GAP);
    if (h1) top = Math.max(top, h1.bottom + GAP);
    if (dek) top = Math.max(top, dek.bottom + GAP);
    if (lead) top = Math.max(top, lead.bottom + GAP);
    return top;
  };

  /** After viewport clamp, flip or shrink so the box is never on the annotated row. */
  const finish = (top: number, left: number, width = w, height = h): ChipBox => {
    const obstacle = row ?? news ?? mention;
    const aboveStart = ceiling();
    const aboveRoom = obstacle.top - GAP - aboveStart;
    const belowStart = obstacle.bottom + GAP;
    const belowRoom = viewport.height - INSET - belowStart;
    const l = pinLeft(left, width);

    const offRow = (placed: ChipBox): ChipBox => {
      const blockers = [row, news].filter((b): b is Rect => Boolean(b));
      if (!blockers.length) return placed;
      const r = box(placed.top, placed.left, placed.width, placed.height);
      if (!overlaps(r, mention) && blockers.every((b) => !overlaps(r, b))) return placed;
      if (belowRoom >= MIN_H) {
        return { top: belowStart, left: l, width: placed.width, height: belowRoom };
      }
      if (aboveRoom >= MIN_H) {
        return { top: aboveStart, left: l, width: placed.width, height: aboveRoom };
      }
      return { top: belowStart, left: l, width: placed.width, height: Math.max(MIN_H, belowRoom) };
    };

    const fitted = tryPlace(top, left, width, height);
    if (fitted) return offRow(fitted);

    const above = tryPlace(obstacle.top - height - GAP, left, width, height);
    if (above) return offRow(above);
    const below = tryPlace(obstacle.bottom + GAP, left, width, height);
    if (below) return offRow(below);

    if (belowRoom >= MIN_H && belowRoom >= aboveRoom) {
      return offRow({ top: belowStart, left: l, width, height: belowRoom });
    }
    if (aboveRoom >= MIN_H) {
      return offRow({ top: aboveStart, left: l, width, height: aboveRoom });
    }
    if (belowRoom >= MIN_H) {
      return offRow({ top: belowStart, left: l, width, height: belowRoom });
    }

    return offRow({ top: belowStart, left: l, width, height: Math.max(MIN_H, belowRoom) });
  };

  if (mobile) {
    const col = column ?? lead;
    const width = col ? col.width : viewport.width - INSET * 2;
    const left = col ? col.left : INSET;
    const top = dek ? dek.bottom + GAP : lead ? lead.bottom + GAP : mention.bottom + GAP;
    return finish(top, left, width);
  }

  const above = box(mention.top - h - GAP, mention.left, w, h);
  const aboveHeader = Boolean(header && overlaps(above, header));
  if (!aboveHeader && above.top >= INSET && !hitsCover(above)) {
    return finish(above.top, above.left);
  }

  if (lead || dek) {
    const anchor = lead ?? dek!;
    let top = anchor.bottom + GAP;
    if (dek) top = Math.max(top, dek.bottom + GAP);
    const belowLead = box(top, mention.left, w, h);
    if (!hitsCover(belowLead)) {
      return finish(belowLead.top, belowLead.left);
    }
  }

  if (row) {
    return finish(row.bottom + GAP, row.left);
  }

  return finish(mention.bottom + GAP, mention.left);
}
