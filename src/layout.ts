// Layout analysis shared by the canvas and the PDF: holding pen, room membership, collisions,
// wall snapping and distances to walls.

import { Box, Pt, bbox, pointInPolygon, distanceToPolygonEdge, segmentsCross, convexOverlap, boxesOverlap, pt, raySegment } from './geometry';
import { roomOutline, getWalls, doorSwingAreas, Wall, WALL_THICKNESS } from './room';
import { Item, itemBox, worldOutline, worldParts } from './furniture';
import { Project } from './store';

export function isInRoom(p: Project, item: Item): boolean {
  return pointInPolygon(pt(item.x, item.y), roomOutline(p.room));
}

export function roomBox(p: Project): Box {
  return bbox(roomOutline(p.room));
}

// ---------------------------------------------------------------------------------------------
// Holding pen: an area to the right of the room for objects not (yet) placed.

const PEN_PAD = 15;

export function penBox(p: Project): Box {
  const rb = roomBox(p);
  const rw = rb.maxX - rb.minX;
  const rh = rb.maxY - rb.minY;
  const x0 = rb.maxX + WALL_THICKNESS + Math.max(120, rw * 0.25);
  const width = Math.max(260, rw * 0.7);
  let bottom = rb.minY + Math.max(rh, 250);
  for (const it of p.items) {
    if (isInRoom(p, it)) continue;
    const b = itemBox(it);
    if (b.minX >= x0 - 1) bottom = Math.max(bottom, b.maxY + PEN_PAD);
  }
  return { minX: x0, minY: rb.minY, maxX: x0 + width, maxY: bottom };
}

function penItems(p: Project, exceptId?: string): Item[] {
  return p.items.filter((i) => i.id !== exceptId && !isInRoom(p, i));
}

/** Find a free spot in the pen for `item`; returns the centre position. */
export function findPenSpot(p: Project, item: Item): Pt {
  const pen = penBox(p);
  const b = itemBox({ ...item, x: 0, y: 0 });
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const others = penItems(p, item.id).map(itemBox);
  const step = 5;
  for (let y = pen.minY + PEN_PAD; y < pen.maxY + 2000; y += step) {
    for (let x = pen.minX + PEN_PAD; x + w <= Math.max(pen.maxX - PEN_PAD, pen.minX + PEN_PAD + w); x += step) {
      const cand: Box = { minX: x, minY: y, maxX: x + w, maxY: y + h };
      if (!others.some((o) => boxesOverlap(o, cand, 10))) return pt(x - b.minX, y - b.minY);
    }
  }
  return pt(pen.minX + PEN_PAD - b.minX, pen.maxY + PEN_PAD - b.minY);
}

/** Re-pack everything in the pen, largest first. */
export function tidyPen(p: Project) {
  const items = penItems(p).sort((a, b) => {
    const ba = itemBox(a), bb = itemBox(b);
    return (bb.maxX - bb.minX) * (bb.maxY - bb.minY) - (ba.maxX - ba.minX) * (ba.maxY - ba.minY);
  });
  // Move them far away first so they don't block each other while re-packing.
  items.forEach((it, i) => {
    it.x = -1e6 - i * 1e4;
    it.y = -1e6;
  });
  for (const it of items) {
    const spot = findPenSpot(p, it);
    it.x = spot.x;
    it.y = spot.y;
  }
}

// ---------------------------------------------------------------------------------------------
// Collision / fit analysis

export interface ItemStatus {
  inRoom: boolean;
  outside: boolean; // in the room but crossing a wall
  overlaps: string[]; // ids of overlapping items
  blocksDoors: string[]; // labels of doors whose swing it obstructs
}

export function analyze(p: Project): Map<string, ItemStatus> {
  const outline = roomOutline(p.room);
  const walls = getWalls(p.room);
  const result = new Map<string, ItemStatus>();
  const roomItems: { item: Item; parts: Pt[][]; box: Box }[] = [];

  for (const item of p.items) {
    const inRoom = pointInPolygon(pt(item.x, item.y), outline);
    const st: ItemStatus = { inRoom, outside: false, overlaps: [], blocksDoors: [] };
    result.set(item.id, st);
    if (!inRoom) continue;
    const wo = worldOutline(item);
    st.outside =
      wo.some((v) => !pointInPolygon(v, outline) && distanceToPolygonEdge(v, outline) > 0.5) ||
      wo.some((a, i) => outline.some((c, j) => segmentsCross(a, wo[(i + 1) % wo.length], c, outline[(j + 1) % outline.length])));
    if (!item.ignoreCollisions) roomItems.push({ item, parts: worldParts(item), box: itemBox(item) });
  }

  for (let i = 0; i < roomItems.length; i++) {
    for (let j = i + 1; j < roomItems.length; j++) {
      const A = roomItems[i], B = roomItems[j];
      if (!boxesOverlap(A.box, B.box)) continue;
      if (A.parts.some((pa) => B.parts.some((pb) => convexOverlap(pa, pb)))) {
        result.get(A.item.id)!.overlaps.push(B.item.id);
        result.get(B.item.id)!.overlaps.push(A.item.id);
      }
    }
  }

  for (const op of p.openings) {
    const wall = walls[op.wall];
    if (!wall) continue;
    const swings = doorSwingAreas(op, wall);
    if (!swings.length) continue;
    for (const ri of roomItems) {
      if (ri.parts.some((pa) => swings.some((s) => convexOverlap(pa, s)))) result.get(ri.item.id)!.blocksDoors.push(op.label);
    }
  }
  return result;
}

export function statusText(st: ItemStatus | undefined, p: Project): string[] {
  if (!st) return [];
  const out: string[] = [];
  if (st.outside) out.push('Goes through a wall');
  if (st.overlaps.length) {
    const names = st.overlaps.map((id) => p.items.find((i) => i.id === id)?.label ?? '?');
    out.push('Overlaps ' + names.join(', '));
  }
  if (st.blocksDoors.length) out.push('Blocks swing of door ' + st.blocksDoors.join(', '));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Snapping & distances

/** Shift needed to make the item's bounding box flush with a nearby axis-aligned wall. */
export function wallSnapDelta(box: Box, walls: Wall[], tol: number): Pt {
  let dx = 0, dy = 0, bestX = tol, bestY = tol;
  for (const w of walls) {
    const vertical = Math.abs(w.dir.x) < 1e-6;
    const horizontal = Math.abs(w.dir.y) < 1e-6;
    if (vertical) {
      const x = w.a.x;
      const y0 = Math.min(w.a.y, w.b.y), y1 = Math.max(w.a.y, w.b.y);
      if (box.maxY < y0 || box.minY > y1) continue;
      const edge = w.inward.x > 0 ? box.minX : box.maxX;
      const d = x - edge;
      if (Math.abs(d) < bestX) { bestX = Math.abs(d); dx = d; }
    } else if (horizontal) {
      const y = w.a.y;
      const x0 = Math.min(w.a.x, w.b.x), x1 = Math.max(w.a.x, w.b.x);
      if (box.maxX < x0 || box.minX > x1) continue;
      const edge = w.inward.y > 0 ? box.minY : box.maxY;
      const d = y - edge;
      if (Math.abs(d) < bestY) { bestY = Math.abs(d); dy = d; }
    }
  }
  return pt(dx, dy);
}

export interface WallGap {
  side: 'left' | 'right' | 'top' | 'bottom';
  from: Pt; // on the item's bounding box
  to: Pt; // on the wall
  distance: number;
}

/** Clear distance from each side of the item's bounding box to the nearest wall in that direction. */
export function wallGaps(p: Project, item: Item): WallGap[] {
  const b = itemBox(item);
  const walls = getWalls(p.room);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const rays: { side: WallGap['side']; o: Pt; d: Pt }[] = [
    { side: 'left', o: pt(b.minX, cy), d: pt(-1, 0) },
    { side: 'right', o: pt(b.maxX, cy), d: pt(1, 0) },
    { side: 'top', o: pt(cx, b.minY), d: pt(0, -1) },
    { side: 'bottom', o: pt(cx, b.maxY), d: pt(0, 1) },
  ];
  const out: WallGap[] = [];
  for (const r of rays) {
    let best = Infinity;
    for (const w of walls) {
      const t = raySegment(r.o, r.d, w.a, w.b);
      if (t !== null && t < best) best = t;
    }
    if (best < Infinity) out.push({ side: r.side, from: r.o, to: pt(r.o.x + r.d.x * best, r.o.y + r.d.y * best), distance: best });
  }
  return out;
}

/** The smaller horizontal gap and the smaller vertical gap — enough to fix the item's position. */
export function nearestGaps(gaps: WallGap[]): WallGap[] {
  const pick = (a?: WallGap, b?: WallGap) => (!a ? b : !b ? a : a.distance <= b.distance ? a : b);
  const g = (s: WallGap['side']) => gaps.find((x) => x.side === s);
  return [pick(g('left'), g('right')), pick(g('top'), g('bottom'))].filter((x): x is WallGap => !!x);
}
