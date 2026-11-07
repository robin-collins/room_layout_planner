// Dimension lines, computed once and drawn by both the SVG canvas and the PDF exporter.

import { Pt, add, mul, sub, norm, perp, readableAngle, rotate, pt, lerp } from './geometry';
import { getWalls, WALL_THICKNESS } from './room';
import { Item } from './furniture';
import { Project } from './store';
import { formatLength } from './units';
import { roomBox, wallGaps, nearestGaps } from './layout';

export interface Dim {
  a: Pt;
  b: Pt;
  normal: Pt; // unit vector the dimension line is offset along
  offset: number; // world units
  text: string;
  extension: boolean; // draw extension lines from a/b to the dimension line
  kind: 'wall' | 'chain' | 'gap';
}

/** A spacing unit scaled to the room size, used to space dimension lines. */
export function baseUnit(p: Project): number {
  const b = roomBox(p);
  return Math.max(8, Math.min(40, Math.max(b.maxX - b.minX, b.maxY - b.minY) / 45));
}

/**
 * Wall dimensions. Every wall gets an overall length; walls in `chainWalls` also get a chained
 * dimension string locating each door / window along the wall.
 */
export function wallDims(p: Project, chainWalls: Set<number> | 'all'): Dim[] {
  const u = baseUnit(p);
  const units = p.settings.units;
  const dims: Dim[] = [];
  for (const w of getWalls(p.room)) {
    const out = mul(w.inward, -1);
    const ops = p.openings.filter((o) => o.wall === w.index);
    const chain = ops.length > 0 && (chainWalls === 'all' || chainWalls.has(w.index));
    if (chain) {
      const stops = [0, w.length];
      for (const o of ops) stops.push(o.offset, o.offset + o.width);
      stops.sort((x, y) => x - y);
      for (let i = 0; i < stops.length - 1; i++) {
        const s0 = stops[i], s1 = stops[i + 1];
        if (s1 - s0 < 0.5) continue;
        dims.push({
          a: add(w.a, mul(w.dir, s0)),
          b: add(w.a, mul(w.dir, s1)),
          normal: out,
          offset: WALL_THICKNESS + 2.2 * u,
          text: formatLength(s1 - s0, units),
          extension: true,
          kind: 'chain',
        });
      }
    }
    dims.push({
      a: w.a,
      b: w.b,
      normal: out,
      offset: WALL_THICKNESS + (chain ? 4.6 : 2.2) * u,
      text: formatLength(w.length, units),
      extension: true,
      kind: 'wall',
    });
  }
  return dims;
}

/** Clearances from an item to the walls: the nearest horizontal & vertical, or all four. */
export function itemGapDims(p: Project, item: Item, mode: 'nearest' | 'all'): Dim[] {
  const gaps = wallGaps(p, item);
  return (mode === 'all' ? gaps : nearestGaps(gaps))
    .filter((g) => g.distance > 0.5)
    .map((g) => ({
      a: g.from,
      b: g.to,
      normal: norm(perp(sub(g.to, g.from))),
      offset: 0,
      text: formatLength(g.distance, p.settings.units),
      extension: false,
      kind: 'gap' as const,
    }));
}

export interface DimLayout {
  p1: Pt;
  p2: Pt;
  dir: Pt; // unit, p1 -> p2
  angle: number; // degrees, readable text angle (clockwise, y-down)
  mid: Pt;
  up: Pt; // unit vector pointing to the "top" of the text
}

export function layoutDim(d: Dim): DimLayout {
  const off = mul(d.normal, d.offset);
  const p1 = add(d.a, off);
  const p2 = add(d.b, off);
  const dir = norm(sub(p2, p1));
  const angle = readableAngle(dir);
  const r = rotate(pt(1, 0), angle);
  return { p1, p2, dir, angle, mid: lerp(p1, p2, 0.5), up: pt(r.y, -r.x) };
}
