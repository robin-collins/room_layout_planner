// Furniture / object shapes. Each item is positioned by the centre of its (unrotated) bounding box
// and rotated about that centre.

import { Pt, pt, add, rotate, bbox, Box, ellipsePoints } from './geometry';

export type ItemShape =
  | { kind: 'rect'; width: number; depth: number }
  | { kind: 'circle'; diameter: number }
  | { kind: 'oval'; width: number; depth: number }
  | {
      kind: 'L';
      width: number;
      depth: number;
      armA: number; // thickness of the full-depth arm (x extent)
      armB: number; // thickness of the full-width arm (y extent)
      mirror: boolean;
    };

export type ItemShapeKind = ItemShape['kind'];

export const SHAPE_LABELS: Record<ItemShapeKind, string> = {
  rect: 'Rectangle / square',
  circle: 'Circle',
  oval: 'Oval',
  L: 'L-shaped',
};

export interface Item {
  id: string;
  label: string;
  shape: ItemShape;
  x: number;
  y: number;
  rotation: number; // degrees, clockwise
  color: string;
  height?: number; // optional, informational (e.g. to check against window sills)
  ignoreCollisions?: boolean; // rugs, wall-mounted things, etc.
}

export const ITEM_COLORS = ['#8ab4f8', '#f6aea9', '#a8dab5', '#fdd663', '#d7aefb', '#fcad70', '#78d9ec', '#c5c9ce'];

export function shapeSize(s: ItemShape): { w: number; d: number } {
  if (s.kind === 'circle') return { w: s.diameter, d: s.diameter };
  return { w: s.width, d: s.depth };
}

/** Convex parts in local coordinates (centred on the bounding box centre, unrotated). */
export function localParts(s: ItemShape): Pt[][] {
  const { w, d } = shapeSize(s);
  const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
    pt(x0 - w / 2, y0 - d / 2),
    pt(x1 - w / 2, y0 - d / 2),
    pt(x1 - w / 2, y1 - d / 2),
    pt(x0 - w / 2, y1 - d / 2),
  ];
  switch (s.kind) {
    case 'rect':
      return [rect(0, 0, w, d)];
    case 'circle':
      return [ellipsePoints(w / 2, w / 2)];
    case 'oval':
      return [ellipsePoints(w / 2, d / 2)];
    case 'L': {
      const a = Math.min(s.armA, w);
      const b = Math.min(s.armB, d);
      const parts = [rect(0, 0, a, d), rect(a, d - b, w, d)].filter((p) => p[1].x > p[0].x + 1e-6);
      return s.mirror ? parts.map((p) => p.map((q) => pt(-q.x, q.y)).reverse()) : parts;
    }
  }
}

/** Full outline in local coordinates. */
export function localOutline(s: ItemShape): Pt[] {
  if (s.kind !== 'L') return localParts(s)[0];
  const { w, d } = shapeSize(s);
  const a = Math.min(s.armA, w);
  const b = Math.min(s.armB, d);
  const pts = [pt(0, 0), pt(a, 0), pt(a, d - b), pt(w, d - b), pt(w, d), pt(0, d)].map((p) =>
    pt(p.x - w / 2, p.y - d / 2),
  );
  return s.mirror ? pts.map((p) => pt(-p.x, p.y)).reverse() : pts;
}

export function toWorld(item: Item, p: Pt): Pt {
  return add(rotate(p, item.rotation), pt(item.x, item.y));
}

export function worldOutline(item: Item): Pt[] {
  return localOutline(item.shape).map((p) => toWorld(item, p));
}

export function worldParts(item: Item): Pt[][] {
  return localParts(item.shape).map((part) => part.map((p) => toWorld(item, p)));
}

export function itemBox(item: Item): Box {
  return bbox(worldOutline(item));
}

/** Convert a shape to another kind, keeping its size as sensible as possible. */
export function convertShape(s: ItemShape, kind: ItemShapeKind): ItemShape {
  const { w, d } = shapeSize(s);
  switch (kind) {
    case 'rect':
      return { kind, width: w, depth: d };
    case 'oval':
      return { kind, width: w, depth: d };
    case 'circle':
      return { kind, diameter: Math.max(w, d) };
    case 'L':
      return {
        kind,
        width: w,
        depth: d,
        armA: Math.round(Math.min(w, d) / 2.5),
        armB: Math.round(Math.min(w, d) / 2.5),
        mirror: false,
      };
  }
}

export function validateShape(s: ItemShape): string | null {
  const { w, d } = shapeSize(s);
  if (!(w >= 1 && d >= 1)) return 'Dimensions must be at least 1 cm.';
  if (s.kind === 'L') {
    if (s.armA >= w || s.armB >= d) return 'Arm thicknesses must be smaller than the overall width/depth.';
    if (s.armA < 1 || s.armB < 1) return 'Arm thicknesses must be at least 1 cm.';
  }
  return null;
}

export interface Preset {
  label: string;
  shape: ItemShape;
  height?: number;
  ignoreCollisions?: boolean;
}

const r = (label: string, width: number, depth: number, height?: number): Preset => ({
  label,
  shape: { kind: 'rect', width, depth },
  height,
});

export const PRESET_GROUPS: { group: string; items: Preset[] }[] = [
  {
    group: 'Bedroom',
    items: [
      r('Single bed', 90, 190, 50),
      r('Double bed', 140, 190, 50),
      r('King bed', 160, 200, 50),
      r('Super king bed', 180, 200, 50),
      r('Wardrobe', 150, 60, 200),
      r('Chest of drawers', 80, 45, 90),
      r('Bedside table', 45, 40, 55),
    ],
  },
  {
    group: 'Living',
    items: [
      r('Sofa (2-seat)', 160, 90, 85),
      r('Sofa (3-seat)', 210, 90, 85),
      {
        label: 'Corner sofa',
        shape: { kind: 'L', width: 250, depth: 200, armA: 90, armB: 90, mirror: false },
        height: 85,
      },
      r('Armchair', 85, 85, 90),
      r('Coffee table', 110, 60, 45),
      { label: 'Round coffee table', shape: { kind: 'circle', diameter: 80 }, height: 45 },
      r('TV unit', 160, 40, 50),
      r('Bookcase', 80, 30, 180),
      { label: 'Rug', shape: { kind: 'rect', width: 200, depth: 300 }, ignoreCollisions: true },
      r('Upright piano', 150, 60, 125),
    ],
  },
  {
    group: 'Dining & office',
    items: [
      r('Dining table (6)', 180, 90, 75),
      { label: 'Round dining table', shape: { kind: 'circle', diameter: 110 }, height: 75 },
      { label: 'Oval dining table', shape: { kind: 'oval', width: 180, depth: 100 }, height: 75 },
      r('Dining chair', 45, 50, 90),
      r('Desk', 140, 70, 75),
      {
        label: 'Corner desk',
        shape: { kind: 'L', width: 160, depth: 140, armA: 60, armB: 60, mirror: false },
        height: 75,
      },
      { label: 'Office chair', shape: { kind: 'circle', diameter: 65 }, height: 110 },
    ],
  },
  {
    group: 'Utility',
    items: [r('Washing machine', 60, 60, 85), r('Fridge freezer', 60, 65, 180), r('Storage boxes', 60, 40, 30)],
  },
];

/** Where to put an item's label: its centre, or for L-shapes the corner where both arms meet. */
export function labelAnchor(it: Item): Pt {
  if (it.shape.kind !== 'L') return pt(it.x, it.y);
  const { width: w, depth: d, armA, armB, mirror } = it.shape;
  let local = pt(-w / 2 + Math.min(armA, w) / 2 + Math.min(w * 0.18, 40), d / 2 - Math.min(armB, d) / 2);
  if (mirror) local = pt(-local.x, local.y);
  return toWorld(it, local);
}
