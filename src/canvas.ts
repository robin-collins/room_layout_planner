// Interactive SVG plan view: rendering, pan/zoom, dragging objects & openings, placing openings.

import { Store } from './store';
import { Pt, pt, add, sub, mul, polyPath, offsetPolygon, projectToSegment, unionBox, Box, boxesOverlap, rotate } from './geometry';
import { roomOutline, getWalls, openingQuad, openingEnds, doorLeaves, Wall, Opening, WALL_THICKNESS, clampOffset } from './room';
import { Item, localOutline, itemBox, shapeSize, labelAnchor } from './furniture';
import { analyze, penBox, roomBox, findPenSpot, isInRoom, wallSnapDelta, ItemStatus } from './layout';
import { wallDims, itemGapDims, layoutDim, Dim, baseUnit } from './dimensions';
import { formatDims } from './units';
import { openingDraft } from './drafts';
import { createOpening } from './actions';

type Drag =
  | { type: 'item'; id: string; grab: Pt; moved: boolean }
  | { type: 'rotate'; id: string; moved: boolean }
  | { type: 'opening'; id: string; grabOffset: number; moved: boolean }
  | { type: 'pan'; start: Pt; o0: Pt; moved: boolean; deselect: boolean };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f = (n: number) => +n.toFixed(2);
const NS = 'vector-effect="non-scaling-stroke"';

export class CanvasView {
  private view = { ox: 0, oy: 0, scale: 1 };
  private drag: Drag | null = null;
  private ghost: Opening | null = null;
  private needsFit = true;

  constructor(
    private svg: SVGSVGElement,
    private store: Store,
  ) {
    svg.addEventListener('pointerdown', (e) => this.onDown(e));
    svg.addEventListener('pointermove', (e) => this.onMove(e));
    svg.addEventListener('pointerup', (e) => this.onUp(e));
    svg.addEventListener('pointercancel', (e) => this.onUp(e));
    svg.addEventListener('pointerleave', () => {
      if (this.ghost) {
        this.ghost = null;
        this.render();
      }
    });
    svg.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    new ResizeObserver(() => this.render()).observe(svg);
  }

  requestFit() {
    this.needsFit = true;
    this.render();
  }

  zoomBy(factor: number, at?: Pt) {
    const r = this.svg.getBoundingClientRect();
    const sx = at ? at.x : r.width / 2;
    const sy = at ? at.y : r.height / 2;
    const wx = this.view.ox + sx / this.view.scale;
    const wy = this.view.oy + sy / this.view.scale;
    this.view.scale = Math.max(0.05, Math.min(20, this.view.scale * factor));
    this.view.ox = wx - sx / this.view.scale;
    this.view.oy = wy - sy / this.view.scale;
    this.render();
  }

  private fit() {
    const p = this.store.project;
    const r = this.svg.getBoundingClientRect();
    if (!p || r.width < 10 || r.height < 10) return false;
    const u = baseUnit(p);
    const rb = roomBox(p);
    const m = WALL_THICKNESS + 6 * u;
    const box = unionBox({ minX: rb.minX - m, minY: rb.minY - m, maxX: rb.maxX + m, maxY: rb.maxY + m }, penBox(p));
    const w = box.maxX - box.minX + 40;
    const h = box.maxY - box.minY + 40;
    this.view.scale = Math.min(r.width / w, r.height / h);
    this.view.ox = (box.minX + box.maxX) / 2 - r.width / 2 / this.view.scale;
    this.view.oy = (box.minY + box.maxY) / 2 - r.height / 2 / this.view.scale;
    return true;
  }

  private toWorld(e: { clientX: number; clientY: number }): Pt {
    const r = this.svg.getBoundingClientRect();
    return pt(this.view.ox + (e.clientX - r.left) / this.view.scale, this.view.oy + (e.clientY - r.top) / this.view.scale);
  }

  private px(n: number) {
    return n / this.view.scale;
  }

  // ------------------------------------------------------------------------------------------
  // Interaction

  private nearestWall(w: Pt, width: number): { wall: Wall; offset: number } | null {
    const p = this.store.project!;
    let best: { wall: Wall; offset: number; d: number } | null = null;
    for (const wall of getWalls(p.room)) {
      if (wall.length < width) continue;
      const pr = projectToSegment(w, wall.a, wall.b);
      if (!best || pr.d < best.d) best = { wall, offset: pr.t * wall.length - width / 2, d: pr.d };
    }
    if (!best) return null;
    const snap = p.settings.snap;
    let offset = clampOffset({ width }, best.wall, best.offset);
    if (snap > 0) offset = clampOffset({ width }, best.wall, Math.round(offset / snap) * snap);
    return { wall: best.wall, offset };
  }

  private onDown(e: PointerEvent) {
    const p = this.store.project;
    if (!p) return;
    const w = this.toWorld(e);
    const target = (e.target as Element).closest<SVGElement>('[data-kind]');
    const kind = target?.dataset.kind;
    const id = target?.dataset.id ?? '';

    if (e.button === 1 || (e.button === 0 && e.shiftKey && !kind)) {
      this.startPan(e, false);
      return;
    }
    if (e.button !== 0) return;

    if (this.store.ui.placing) {
      const spot = this.nearestWall(w, openingDraft.width);
      if (spot) {
        openingDraft.wall = spot.wall.index;
        createOpening(this.store, spot.wall.index, spot.offset);
      }
      this.ghost = null;
      return;
    }

    if (kind === 'item') {
      const item = p.items.find((i) => i.id === id)!;
      this.store.select({ type: 'item', id });
      this.store.beginGesture();
      this.drag = { type: 'item', id, grab: sub(w, pt(item.x, item.y)), moved: false };
    } else if (kind === 'rotate') {
      this.store.beginGesture();
      this.drag = { type: 'rotate', id, moved: false };
    } else if (kind === 'opening') {
      const op = p.openings.find((o) => o.id === id)!;
      const wall = getWalls(p.room)[op.wall];
      const along = projectToSegment(w, wall.a, wall.b).t * wall.length;
      this.store.select({ type: 'opening', id });
      this.store.beginGesture();
      this.drag = { type: 'opening', id, grabOffset: along - op.offset, moved: false };
    } else {
      this.startPan(e, true);
      return;
    }
    this.svg.setPointerCapture(e.pointerId);
  }

  private startPan(e: PointerEvent, deselect: boolean) {
    this.drag = { type: 'pan', start: pt(e.clientX, e.clientY), o0: pt(this.view.ox, this.view.oy), moved: false, deselect };
    this.svg.setPointerCapture(e.pointerId);
    this.svg.classList.add('panning');
  }

  private onMove(e: PointerEvent) {
    const p = this.store.project;
    if (!p) return;
    const w = this.toWorld(e);
    const d = this.drag;

    if (!d) {
      if (this.store.ui.placing) {
        const spot = this.nearestWall(w, openingDraft.width);
        this.ghost = spot
          ? { ...openingDraft, id: '__ghost', label: '', wall: spot.wall.index, offset: spot.offset }
          : null;
        this.render();
      }
      return;
    }
    d.moved = true;

    if (d.type === 'pan') {
      this.view.ox = d.o0.x - (e.clientX - d.start.x) / this.view.scale;
      this.view.oy = d.o0.y - (e.clientY - d.start.y) / this.view.scale;
      this.render();
      return;
    }

    if (d.type === 'item') {
      const item = p.items.find((i) => i.id === d.id);
      if (!item) return;
      let c = sub(w, d.grab);
      if (!e.altKey) {
        const box = itemBox({ ...item, x: c.x, y: c.y });
        const snap = p.settings.snap;
        if (snap > 0) c = add(c, pt(Math.round(box.minX / snap) * snap - box.minX, Math.round(box.minY / snap) * snap - box.minY));
        const box2 = itemBox({ ...item, x: c.x, y: c.y });
        c = add(c, wallSnapDelta(box2, getWalls(p.room), this.px(12)));
      }
      this.store.live(() => {
        item.x = f(c.x);
        item.y = f(c.y);
      });
    } else if (d.type === 'rotate') {
      const item = p.items.find((i) => i.id === d.id);
      if (!item) return;
      let deg = (Math.atan2(w.y - item.y, w.x - item.x) * 180) / Math.PI + 90;
      if (!e.shiftKey) deg = Math.round(deg / 15) * 15;
      this.store.live(() => (item.rotation = ((Math.round(deg * 10) / 10) % 360 + 360) % 360));
    } else if (d.type === 'opening') {
      const op = p.openings.find((o) => o.id === d.id);
      if (!op) return;
      const spot = this.nearestWall(w, op.width);
      if (!spot) return;
      let offset = projectToSegment(w, spot.wall.a, spot.wall.b).t * spot.wall.length - (spot.wall.index === op.wall ? d.grabOffset : op.width / 2);
      const snap = p.settings.snap;
      if (snap > 0 && !e.altKey) offset = Math.round(offset / snap) * snap;
      offset = clampOffset(op, spot.wall, offset);
      this.store.live(() => {
        if (op.wall !== spot.wall.index) d.grabOffset = op.width / 2;
        op.wall = spot.wall.index;
        op.offset = f(offset);
      });
    }
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    this.svg.classList.remove('panning');
    if (d.type === 'pan') {
      if (!d.moved && d.deselect) this.store.select(null);
      return;
    }
    const p = this.store.project!;
    if (d.type === 'item') {
      const item = p.items.find((i) => i.id === d.id);
      // Dropped somewhere that's neither the room nor the pen: tuck it into the pen.
      if (item && !isInRoom(p, item) && !boxesOverlap(itemBox(item), penBox(p))) {
        this.store.live(() => Object.assign(item, findPenSpot(p, item)));
      }
    }
    this.store.endGesture();
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = this.svg.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    this.zoomBy(factor, pt(e.clientX - r.left, e.clientY - r.top));
  }

  // ------------------------------------------------------------------------------------------
  // Rendering

  render() {
    const p = this.store.project;
    if (!p) {
      this.svg.innerHTML = '';
      return;
    }
    if (this.needsFit && this.fit()) this.needsFit = false;
    const r = this.svg.getBoundingClientRect();
    const { ox, oy, scale } = this.view;
    this.svg.setAttribute('viewBox', `${f(ox)} ${f(oy)} ${f(r.width / scale)} ${f(r.height / scale)}`);

    const sel = this.store.ui.selection;
    const walls = getWalls(p.room);
    const outline = roomOutline(p.room);
    const status = analyze(p);
    const pen = penBox(p);
    const out: string[] = [];

    // Grid: 10 cm when zoomed in enough, otherwise 50 cm; major lines every metre.
    const minor = 10 * scale >= 7 ? 10 : 50;
    out.push(`<defs>
      <pattern id="g-minor" width="${minor}" height="${minor}" patternUnits="userSpaceOnUse">
        <path d="M ${minor} 0 L 0 0 0 ${minor}" fill="none" stroke="#eceff3" stroke-width="1" ${NS}/></pattern>
      <pattern id="g-major" width="100" height="100" patternUnits="userSpaceOnUse">
        <rect width="100" height="100" fill="url(#g-minor)"/>
        <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#dde1e7" stroke-width="1" ${NS}/></pattern>
    </defs>`);

    // Holding pen
    out.push(
      `<rect x="${f(pen.minX)}" y="${f(pen.minY)}" width="${f(pen.maxX - pen.minX)}" height="${f(pen.maxY - pen.minY)}" rx="${f(this.px(8))}" fill="#f8f9fa" stroke="#9aa0a6" stroke-dasharray="6 4" stroke-width="1.5" ${NS}/>`,
      `<rect x="${f(pen.minX)}" y="${f(pen.minY)}" width="${f(pen.maxX - pen.minX)}" height="${f(pen.maxY - pen.minY)}" fill="url(#g-major)" opacity="0.6" pointer-events="none"/>`,
      this.text(pt(pen.minX, pen.minY - this.px(10)), 'HOLDING PEN', 12, { anchor: 'start', fill: '#5f6368', weight: 600 }),
    );

    // Floor + walls
    out.push(
      `<path d="${polyPath(outline)}" fill="#fff"/>`,
      `<path d="${polyPath(outline)}" fill="url(#g-major)" pointer-events="none"/>`,
      `<path d="${polyPath(offsetPolygon(outline, WALL_THICKNESS))} ${polyPath(outline)}" fill="#4a4f55" fill-rule="evenodd"/>`,
    );

    // Openings
    const openings = this.ghost ? [...p.openings, this.ghost] : p.openings;
    for (const op of openings) {
      const wall = walls[op.wall];
      if (wall) out.push(this.renderOpening(op, wall, sel?.type === 'opening' && sel.id === op.id));
    }

    // Items (pen items first so room items draw on top), then labels on top of all shapes
    const rank = (i: Item) => (status.get(i.id)?.inRoom ? 2 : 0) + (i.ignoreCollisions ? 0 : 1);
    const ordered = [...p.items].sort((a, b) => rank(a) - rank(b));
    for (const it of ordered) out.push(this.renderItem(it, status.get(it.id), sel?.type === 'item' && sel.id === it.id));
    for (const it of ordered) out.push(this.renderItemLabel(it, p.settings.units));

    // Dimensions
    const chainWalls = new Set<number>();
    if (sel?.type === 'opening') {
      const op = p.openings.find((o) => o.id === sel.id);
      if (op) chainWalls.add(op.wall);
    }
    if (this.ghost) chainWalls.add(this.ghost.wall);
    const dims: Dim[] = wallDims(p, p.settings.showAllDims ? 'all' : chainWalls);
    if (p.settings.showAllDims) {
      for (const it of p.items) if (status.get(it.id)?.inRoom && !(sel?.type === 'item' && sel.id === it.id)) dims.push(...itemGapDims(p, it, 'nearest'));
    }
    const selItem = sel?.type === 'item' ? p.items.find((i) => i.id === sel.id) : undefined;
    if (selItem && status.get(selItem.id)?.inRoom) dims.push(...itemGapDims(p, selItem, 'all'));
    out.push(`<g class="dims" pointer-events="none">${dims.map((d) => this.renderDim(d)).join('')}</g>`);

    // Selection overlay
    if (selItem) out.push(this.renderSelection(selItem));

    this.svg.innerHTML = out.join('');
    this.svg.classList.toggle('placing', !!this.store.ui.placing);
  }

  private text(
    at: Pt,
    s: string,
    sizePx: number,
    o: { anchor?: string; fill?: string; weight?: number; angle?: number; halo?: boolean } = {},
  ): string {
    const fs = this.px(sizePx);
    const rot = o.angle ? ` rotate(${f(o.angle)})` : '';
    return `<text transform="translate(${f(at.x)} ${f(at.y)})${rot}" font-size="${f(fs)}" text-anchor="${o.anchor ?? 'middle'}" fill="${o.fill ?? '#202124'}" font-weight="${o.weight ?? 400}"${o.halo === false ? '' : ` stroke="#fff" stroke-width="${f(fs * 0.3)}" paint-order="stroke" stroke-linejoin="round"`}>${esc(s)}</text>`;
  }

  private renderOpening(op: Opening, wall: Wall, selected: boolean): string {
    const ghost = op.id === '__ghost';
    const quad = openingQuad(op, wall);
    const { s, e } = openingEnds(op, wall);
    const parts: string[] = [];
    const stroke = selected ? '#1a73e8' : '#202124';
    if (op.kind === 'window') {
      const mid = mul(wall.inward, -WALL_THICKNESS / 2);
      parts.push(
        `<path d="${polyPath(quad)}" fill="#e8f0fe" stroke="${stroke}" stroke-width="${selected ? 2.5 : 1}" ${NS}/>`,
        `<path d="${polyPath([add(s, mid), add(e, mid)], false)}" stroke="${stroke}" stroke-width="1" ${NS}/>`,
      );
    } else {
      parts.push(`<path d="${polyPath(quad)}" fill="#fff" stroke="${selected ? '#1a73e8' : 'none'}" stroke-width="2.5" ${NS}/>`);
      for (const leaf of doorLeaves(op, wall)) {
        parts.push(
          `<path d="${polyPath([leaf.hinge, leaf.openTip], false)}" stroke="${stroke}" stroke-width="2" ${NS}/>`,
          `<path d="${polyPath(leaf.arc, false)}" fill="none" stroke="${stroke}" stroke-width="1" stroke-dasharray="4 3" ${NS}/>`,
        );
      }
    }
    if (!ghost) {
      const labelPos = add(mul(add(s, e), 0.5), mul(wall.inward, this.px(14)));
      parts.push(this.text(add(labelPos, pt(0, this.px(4))), op.label, 11, { fill: selected ? '#1a73e8' : '#3c4043', weight: 600 }));
    }
    // Wide transparent hit target over the wall gap
    const hit = `<path d="${polyPath(quad)}" fill="transparent" stroke="transparent" stroke-width="12" ${NS} data-kind="opening" data-id="${op.id}" class="opening-hit"/>`;
    return `<g ${ghost ? 'opacity="0.55" pointer-events="none"' : ''}>${parts.join('')}${ghost ? '' : hit}</g>`;
  }

  private renderItem(it: Item, st: ItemStatus | undefined, selected: boolean): string {
    const problem = st?.inRoom && (st.outside || st.overlaps.length > 0);
    const warn = st?.inRoom && (st.blocksDoors.length ?? 0) > 0;
    const stroke = problem ? '#d93025' : warn ? '#e8710a' : selected ? '#1a73e8' : '#3c4043';
    const width = selected || problem || warn ? 2.25 : 1.25;
    const dash = it.ignoreCollisions ? ' stroke-dasharray="5 3"' : '';
    return `<g data-kind="item" data-id="${it.id}" class="item" transform="translate(${f(it.x)} ${f(it.y)}) rotate(${f(it.rotation)})">
      <path d="${polyPath(localOutline(it.shape))}" fill="${esc(it.color)}" fill-opacity="${it.ignoreCollisions ? 0.35 : 0.7}" stroke="${stroke}" stroke-width="${width}"${dash} ${NS}/></g>`;
  }

  private renderItemLabel(it: Item, units: Parameters<typeof formatDims>[2]): string {
    const { w, d } = shapeSize(it.shape);
    const b = itemBox(it);
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    const dims = it.shape.kind === 'circle' ? `Ø ${formatDims(w, w, units).split(' x ')[1]}` : formatDims(w, d, units);
    const chars = Math.max(it.label.length, dims.length);
    const fsWorld = Math.min(this.px(12), (bw * 0.9) / (chars * 0.58), bh / 3);
    const fsPx = fsWorld * this.view.scale;
    if (fsPx < 5) return '';
    const c = labelAnchor(it);
    return `<g pointer-events="none">${this.text(add(c, pt(0, -fsWorld * 0.15)), it.label, fsPx, { weight: 600, halo: false })}${this.text(add(c, pt(0, fsWorld * 1.05)), dims, fsPx * 0.85, { fill: '#3c4043', halo: false })}</g>`;
  }

  private renderSelection(it: Item): string {
    const b: Box = itemBox(it);
    const pad = this.px(4);
    const { d } = shapeSize(it.shape);
    const handle = add(pt(it.x, it.y), rotate(pt(0, -d / 2 - this.px(26)), it.rotation));
    const top = add(pt(it.x, it.y), rotate(pt(0, -d / 2), it.rotation));
    return `<g>
      <rect x="${f(b.minX - pad)}" y="${f(b.minY - pad)}" width="${f(b.maxX - b.minX + 2 * pad)}" height="${f(b.maxY - b.minY + 2 * pad)}" fill="none" stroke="#1a73e8" stroke-dasharray="4 3" stroke-width="1" ${NS} pointer-events="none"/>
      <path d="${polyPath([top, handle], false)}" stroke="#1a73e8" stroke-width="1" ${NS}/>
      <circle cx="${f(handle.x)}" cy="${f(handle.y)}" r="${f(this.px(7))}" fill="#fff" stroke="#1a73e8" stroke-width="2" ${NS} data-kind="rotate" data-id="${it.id}" class="rotate-handle"><title>Drag to rotate (hold Shift for free rotation)</title></circle>
    </g>`;
  }

  private renderDim(d: Dim): string {
    const L = layoutDim(d);
    const color = d.kind === 'gap' ? '#1a73e8' : '#5f6368';
    const parts: string[] = [];
    const line = (a: Pt, b: Pt, w = 1) => `<path d="${polyPath([a, b], false)}" stroke="${color}" stroke-width="${w}" ${NS}/>`;
    if (d.extension) {
      const gap = mul(d.normal, this.px(3));
      const over = mul(d.normal, this.px(4));
      parts.push(line(add(d.a, gap), add(L.p1, over)), line(add(d.b, gap), add(L.p2, over)));
    }
    parts.push(line(L.p1, L.p2));
    const t = mul(rotate(L.dir, -45), this.px(5));
    for (const p of [L.p1, L.p2]) parts.push(line(sub(p, t), add(p, t), 1.5));
    const len = Math.hypot(L.p2.x - L.p1.x, L.p2.y - L.p1.y) * this.view.scale;
    if (len > 24) parts.push(this.text(add(L.mid, mul(L.up, this.px(4))), d.text, 11, { angle: L.angle, fill: d.kind === 'gap' ? '#1a73e8' : '#3c4043' }));
    return parts.join('');
  }
}
