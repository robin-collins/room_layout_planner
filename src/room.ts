// Room shapes, walls and openings (doors / windows).
//
// A room is described by a *shape* that produces a polygon outline (the interior face of the walls).
// Everything else — walls, corners, openings, dimensions, collision checks, PDF — works from that
// generic outline, so adding a new room shape (L-shaped, custom outline…) only means adding an entry
// to ROOM_SHAPES plus its setup fields.

import { Pt, pt, sub, add, mul, norm, perp, len, signedArea, dot, arcPoints } from './geometry';

export const WALL_THICKNESS = 12; // cm, drawing only

export interface RectRoomShape {
  kind: 'rect';
  width: number; // x extent (left to right)
  length: number; // y extent (top to bottom)
}

// Future shapes slot in here, e.g.
//   | { kind: 'L'; width; length; cutWidth; cutLength; cutCorner }
//   | { kind: 'polygon'; points: Pt[] }
export type RoomShape = RectRoomShape;
export type RoomShapeKind = RoomShape['kind'];

export interface RoomShapeField {
  key: string;
  label: string;
}

export interface RoomShapeDef<S extends RoomShape = RoomShape> {
  label: string;
  fields: RoomShapeField[];
  defaults: S;
  outline(shape: S): Pt[];
  validate(shape: S): string | null;
}

export const ROOM_SHAPES: { [K in RoomShapeKind]: RoomShapeDef<Extract<RoomShape, { kind: K }>> } = {
  rect: {
    label: 'Rectangle / square',
    fields: [
      { key: 'width', label: 'Width (left wall to right wall)' },
      { key: 'length', label: 'Length (top wall to bottom wall)' },
    ],
    defaults: { kind: 'rect', width: 400, length: 350 },
    outline: (s) => [pt(0, 0), pt(s.width, 0), pt(s.width, s.length), pt(0, s.length)],
    validate: (s) => (s.width < 50 || s.length < 50 ? 'Each side must be at least 50 cm.' : null),
  },
};

export interface Room {
  name: string;
  shape: RoomShape;
}

export function roomOutline(room: Room): Pt[] {
  const def = ROOM_SHAPES[room.shape.kind] as RoomShapeDef;
  return def.outline(room.shape);
}

export interface Wall {
  index: number;
  a: Pt; // start corner
  b: Pt; // end corner
  length: number;
  dir: Pt; // unit vector a -> b
  inward: Pt; // unit normal pointing into the room
  name: string;
  startCorner: string;
  endCorner: string;
}

function sideName(outward: Pt): 'Top' | 'Bottom' | 'Left' | 'Right' {
  if (Math.abs(outward.y) >= Math.abs(outward.x)) return outward.y < 0 ? 'Top' : 'Bottom';
  return outward.x < 0 ? 'Left' : 'Right';
}

function dedupe(names: string[], suffix: (i: number, n: number) => string): string[] {
  const counts = new Map<string, number>();
  names.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
  const seen = new Map<string, number>();
  return names.map((n) => {
    if ((counts.get(n) ?? 0) < 2) return n;
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return n + suffix(k, counts.get(n)!);
  });
}

export function getWalls(room: Room): Wall[] {
  const poly = roomOutline(room);
  const area = signedArea(poly);
  const n = poly.length;
  const base = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const dir = norm(sub(b, a));
    const left = perp(dir);
    const inward = area > 0 ? left : mul(left, -1);
    return { a, b, dir, inward, length: len(sub(b, a)), side: sideName(mul(inward, -1)) };
  });
  const wallNames = dedupe(
    base.map((w) => `${w.side} wall`),
    (k) => ` ${k}`,
  );
  // Corner i sits between wall i-1 and wall i.
  const cornerBase = base.map((w, i) => {
    const prev = base[(i - 1 + n) % n].side;
    const sides = [prev, w.side];
    const tb = sides.find((s) => s === 'Top' || s === 'Bottom');
    const lr = sides.find((s) => s === 'Left' || s === 'Right');
    return tb && lr ? `${tb}-${lr}`.toLowerCase() : `corner ${String.fromCharCode(65 + i)}`;
  });
  // Non-rectangular rooms can produce duplicate corner names; disambiguate with letters.
  const finalCorners = cornerBase.map((c, i) =>
    cornerBase.indexOf(c) !== cornerBase.lastIndexOf(c) ? `${c} (${String.fromCharCode(65 + i)})` : c,
  );
  return base.map((w, i) => ({
    index: i,
    a: w.a,
    b: w.b,
    length: w.length,
    dir: w.dir,
    inward: w.inward,
    name: wallNames[i],
    startCorner: finalCorners[i],
    endCorner: finalCorners[(i + 1) % n],
  }));
}

// ---------------------------------------------------------------------------------------------
// Openings

export type OpeningKind = 'door' | 'window';

export interface Opening {
  id: string;
  kind: OpeningKind;
  label: string;
  wall: number; // wall index
  offset: number; // distance from the wall's start corner to the near edge of the opening
  width: number;
  // Doors
  leaves: 1 | 2;
  hinge: 'left' | 'right'; // as seen from inside the room, facing the door
  swing: 'in' | 'out';
  // Windows
  sillHeight: number;
  height: number;
}

export function openingEnds(op: Opening, wall: Wall): { s: Pt; e: Pt } {
  return { s: add(wall.a, mul(wall.dir, op.offset)), e: add(wall.a, mul(wall.dir, op.offset + op.width)) };
}

/** The quad the opening cuts out of the wall band. */
export function openingQuad(op: Opening, wall: Wall): Pt[] {
  const { s, e } = openingEnds(op, wall);
  const out = mul(wall.inward, -WALL_THICKNESS);
  return [s, e, add(e, out), add(s, out)];
}

export interface DoorLeaf {
  hinge: Pt;
  openTip: Pt;
  arc: Pt[]; // from closed position to fully open
}

/** Is the wall's end point on the right-hand side for someone inside the room facing this wall? */
function endIsRight(wall: Wall): boolean {
  const facing = mul(wall.inward, -1);
  const right = { x: -facing.y, y: facing.x }; // visually clockwise 90° in y-down coords
  return dot(wall.dir, right) > 0;
}

export function doorLeaves(op: Opening, wall: Wall): DoorLeaf[] {
  let { s, e } = openingEnds(op, wall);
  const swingDir = op.swing === 'in' ? wall.inward : mul(wall.inward, -1);
  if (op.swing === 'out') {
    const shift = mul(wall.inward, -WALL_THICKNESS);
    s = add(s, shift);
    e = add(e, shift);
  }
  const leaf = (hinge: Pt, closedTip: Pt, r: number): DoorLeaf => {
    const openTip = add(hinge, mul(swingDir, r));
    const a0 = Math.atan2(closedTip.y - hinge.y, closedTip.x - hinge.x);
    let a1 = Math.atan2(openTip.y - hinge.y, openTip.x - hinge.x);
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    a1 = a0 + delta;
    return { hinge, openTip, arc: arcPoints(hinge, r, a0, a1, 20) };
  };
  if (op.leaves === 2) {
    const mid = add(s, mul(sub(e, s), 0.5));
    return [leaf(s, mid, op.width / 2), leaf(e, mid, op.width / 2)];
  }
  const hingeAtEnd = (op.hinge === 'right') === endIsRight(wall);
  return hingeAtEnd ? [leaf(e, s, op.width)] : [leaf(s, e, op.width)];
}

/** Convex sectors swept by inward-opening door leaves (used for clearance checks). */
export function doorSwingAreas(op: Opening, wall: Wall): Pt[][] {
  if (op.kind !== 'door' || op.swing !== 'in') return [];
  return doorLeaves(op, wall).map((l) => [l.hinge, ...l.arc]);
}

export function defaultOpening(kind: OpeningKind): Omit<Opening, 'id' | 'label' | 'wall' | 'offset'> {
  return kind === 'door'
    ? { kind, width: 82, leaves: 1, hinge: 'left', swing: 'in', sillHeight: 0, height: 204 }
    : { kind, width: 120, leaves: 1, hinge: 'left', swing: 'in', sillHeight: 90, height: 120 };
}

export function nextOpeningLabel(openings: Opening[], kind: OpeningKind): string {
  const prefix = kind === 'door' ? 'D' : 'W';
  let max = 0;
  for (const o of openings) {
    const m = o.label.match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${max + 1}`;
}

export function clampOffset(op: Pick<Opening, 'width'>, wall: Wall, offset: number): number {
  return Math.max(0, Math.min(wall.length - op.width, offset));
}
