// Basic 2D geometry helpers. World units are centimetres, y axis points down (screen convention).

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const pt = (x: number, y: number): Pt => ({ x, y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
export const len = (a: Pt): number => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt): number => len(sub(a, b));
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const perp = (a: Pt): Pt => ({ x: -a.y, y: a.x });

export function norm(a: Pt): Pt {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
}

/** Rotate by `deg` degrees. With y pointing down this is visually clockwise (same as SVG rotate()). */
export function rotate(p: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
  return s / 2;
}

export function bbox(pts: Pt[]): Box {
  const b: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    if (p.x < b.minX) b.minX = p.x;
    if (p.y < b.minY) b.minY = p.y;
    if (p.x > b.maxX) b.maxX = p.x;
    if (p.y > b.maxY) b.maxY = p.y;
  }
  return b;
}

export function unionBox(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boxesOverlap(a: Box, b: Box, margin = 0): boolean {
  return a.minX < b.maxX + margin && b.minX < a.maxX + margin && a.minY < b.maxY + margin && b.minY < a.maxY + margin;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface Projection {
  t: number; // 0..1 along segment
  point: Pt;
  d: number; // distance from p to the projected point
}

export function projectToSegment(p: Pt, a: Pt, b: Pt): Projection {
  const ab = sub(b, a);
  const l2 = dot(ab, ab) || 1;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const point = lerp(a, b, t);
  return { t, point, d: dist(p, point) };
}

export function distanceToPolygonEdge(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    best = Math.min(best, projectToSegment(p, poly[i], poly[(i + 1) % poly.length]).d);
  }
  return best;
}

/** True when segments ab and cd cross at a single interior point (touching / collinear does not count). */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const eps = 1e-7;
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

/** Separating-axis test for two convex polygons. `eps` lets shapes touch without counting as overlap. */
export function convexOverlap(A: Pt[], B: Pt[], eps = 0.5): boolean {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length], poly[i]);
      if (len(e) < 1e-9) continue;
      const axis = norm(perp(e));
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const p of A) {
        const v = dot(p, axis);
        minA = Math.min(minA, v);
        maxA = Math.max(maxA, v);
      }
      for (const p of B) {
        const v = dot(p, axis);
        minB = Math.min(minB, v);
        maxB = Math.max(maxB, v);
      }
      if (maxA <= minB + eps || maxB <= minA + eps) return false;
    }
  }
  return true;
}

/** Offset a simple polygon outward by d (mitred corners). Works for either winding. */
export function offsetPolygon(poly: Pt[], d: number): Pt[] {
  const area = signedArea(poly);
  const n = poly.length;
  const outward = (a: Pt, b: Pt): Pt => {
    const e = norm(sub(b, a));
    // For positive area the interior is to the left of each edge (-e.y, e.x); outward is the opposite.
    return area > 0 ? { x: e.y, y: -e.x } : { x: -e.y, y: e.x };
  };
  return poly.map((p, i) => {
    const prev = poly[(i - 1 + n) % n];
    const next = poly[(i + 1) % n];
    const n1 = outward(prev, p);
    const n2 = outward(p, next);
    const m = norm(add(n1, n2));
    const k = dot(m, n1) || 1;
    return add(p, mul(m, d / k));
  });
}

/** Distance along unit vector `dir` from `o` to segment ab, or null if the ray misses. */
export function raySegment(o: Pt, dir: Pt, a: Pt, b: Pt): number | null {
  const ab = sub(b, a);
  const denom = cross(dir, ab);
  if (Math.abs(denom) < 1e-9) return null;
  const ao = sub(a, o);
  const t = cross(ao, ab) / denom;
  const s = cross(ao, dir) / denom;
  if (t >= -1e-6 && s >= -1e-6 && s <= 1 + 1e-6) return Math.max(0, t);
  return null;
}

export function arcPoints(center: Pt, r: number, a0: number, a1: number, segments = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments;
    out.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
  }
  return out;
}

export function ellipsePoints(rx: number, ry: number, segments = 48): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
  }
  return out;
}

/** Angle (degrees) for a direction so that text along it reads left-to-right / bottom-to-top. */
export function readableAngle(dir: Pt): number {
  let deg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  if (deg > 90.5) deg -= 180;
  if (deg <= -89.5) deg += 180;
  return deg;
}

export function polyPath(pts: Pt[], close = true): string {
  if (!pts.length) return '';
  const f = (n: number) => +n.toFixed(2);
  return 'M' + pts.map((p) => `${f(p.x)} ${f(p.y)}`).join(' L') + (close ? ' Z' : '');
}
