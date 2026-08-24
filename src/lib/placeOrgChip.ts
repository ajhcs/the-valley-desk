export type Rect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type ChipBox = { top: number; left: number; width: number };

const INSET = 8;
const GAP = 8;

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
  column?: Rect | null;
  mobile?: boolean;
}): ChipBox {
  const { mention, chip, viewport, header, lead, dek, h1, row, column, mobile } = opts;
  const w = Math.min(chip.width, Math.max(80, viewport.width - INSET * 2));
  const h = chip.height;

  const colLeft = column?.left ?? INSET;
  const colRight = column?.right ?? viewport.width - INSET;

  const finish = (top: number, left: number, width = w): ChipBox => {
    const maxLeft = Math.min(colRight, viewport.width - INSET) - width;
    const minLeft = Math.max(colLeft, INSET);
    return {
      top: Math.min(Math.max(top, INSET), Math.max(INSET, viewport.height - h - INSET)),
      left: clampLeft(left, width, minLeft, maxLeft),
      width,
    };
  };

  const hitsCover = (placed: Rect) =>
    overlaps(placed, mention) ||
    Boolean(h1 && overlaps(placed, h1)) ||
    Boolean(dek && overlaps(placed, dek)) ||
    Boolean(row && overlaps(placed, row));

  if (mobile) {
    const col = column ?? lead;
    const width = col ? col.width : viewport.width - INSET * 2;
    const left = col ? col.left : INSET;
    const top = dek ? dek.bottom + GAP : lead ? lead.bottom + GAP : mention.bottom + GAP;
    const placed = finish(top, left, width);
    if (h1 && overlaps(box(placed.top, placed.left, placed.width, h), h1)) {
      return finish((dek ?? lead ?? mention).bottom + GAP, left, width);
    }
    return placed;
  }

  const above = box(mention.top - h - GAP, mention.left, w, h);
  const headerHit = Boolean(header && overlaps(above, header));
  if (!headerHit && above.top >= INSET && !hitsCover(above)) {
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
