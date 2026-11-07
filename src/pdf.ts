// Vector PDF export of the finished layout (jsPDF). Draws the room to a standard architectural scale
// with wall, opening and clearance dimensions, followed by a schedule of doors, windows and objects.

import { jsPDF } from 'jspdf';
import { Project } from './store';
import { Pt, pt, add, mul, sub, offsetPolygon, rotate, bbox, unionBox, Box } from './geometry';
import { roomOutline, getWalls, openingQuad, openingEnds, doorLeaves, WALL_THICKNESS, ROOM_SHAPES } from './room';
import { worldOutline, shapeSize, itemBox, SHAPE_LABELS, Item, labelAnchor } from './furniture';
import { wallDims, itemGapDims, layoutDim, Dim, baseUnit } from './dimensions';
import { analyze, statusText, wallGaps } from './layout';
import { formatLength, formatDims, Units } from './units';

export type Paper = 'a4' | 'a3' | 'letter';

export interface PdfOptions {
  paper: Paper;
  objectDims: boolean; // clearance dimensions from each object to the walls
  schedule: boolean; // second page with tables
  title: string;
}

const PAPER_MM: Record<Paper, [number, number]> = { a4: [297, 210], a3: [420, 297], letter: [279.4, 215.9] };
const SCALES = [10, 20, 25, 30, 40, 50, 75, 100, 125, 150, 200, 250, 500, 1000];
const MARGIN = 12;
const TITLE_H = 20;

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [200, 200, 200];
}

const lighten = (c: [number, number, number], k: number) => c.map((v) => Math.round(v + (255 - v) * k)) as [number, number, number];

export function exportPdf(p: Project, opts: PdfOptions): void {
  const units = p.settings.units;
  const walls = getWalls(p.room);
  const outline = roomOutline(p.room);
  const status = analyze(p);
  const u = baseUnit(p);
  const roomItems = p.items.filter((i) => status.get(i.id)?.inRoom).sort((a, b) => Number(!!b.ignoreCollisions) - Number(!!a.ignoreCollisions));
  const penItems = p.items.filter((i) => !status.get(i.id)?.inRoom);

  const dims: Dim[] = wallDims(p, 'all');
  if (opts.objectDims) for (const it of roomItems) dims.push(...itemGapDims(p, it, 'nearest'));

  // Drawing extents in world cm: room + walls + dimension strings (+ any objects overhanging walls).
  let ext: Box = bbox(offsetPolygon(outline, WALL_THICKNESS + 6.5 * u));
  for (const it of roomItems) ext = unionBox(ext, itemBox(it));

  const [pw, ph] = PAPER_MM[opts.paper];
  const ew = ext.maxX - ext.minX, eh = ext.maxY - ext.minY;
  const landscape = ew >= eh;
  const W = landscape ? pw : ph;
  const H = landscape ? ph : pw;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: opts.paper });

  const areaW = W - 2 * MARGIN;
  const areaH = H - 2 * MARGIN - TITLE_H;
  const den = SCALES.find((s) => (ew * 10) / s <= areaW && (eh * 10) / s <= areaH) ?? SCALES[SCALES.length - 1];
  const k = 10 / den; // mm on paper per cm in the world
  const x0 = MARGIN + (areaW - ew * k) / 2;
  const y0 = MARGIN + (areaH - eh * k) / 2;
  const P = (q: Pt): Pt => pt(x0 + (q.x - ext.minX) * k, y0 + (q.y - ext.minY) * k);

  // --- primitives ------------------------------------------------------------------------
  const poly = (pts: Pt[], style: 'S' | 'F' | 'FD', closed = true) => {
    if (pts.length < 2) return;
    const s = pts.map(P);
    const deltas = s.slice(1).map((q, i) => [q.x - s[i].x, q.y - s[i].y]);
    doc.lines(deltas, s[0].x, s[0].y, [1, 1], style, closed);
  };
  const line = (a: Pt, b: Pt) => {
    const A = P(a), B = P(b);
    doc.line(A.x, A.y, B.x, B.y);
  };
  /** Text centred on a paper-space point along a direction (angle in our clockwise convention). */
  const textAt = (s: string, at: Pt, sizePt: number, angle = 0, style: 'normal' | 'bold' = 'normal') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(sizePt);
    const w = doc.getTextWidth(s);
    const dir = rotate(pt(1, 0), angle);
    const start = sub(at, mul(dir, w / 2));
    doc.text(s, start.x, start.y, { angle: -angle });
  };
  const textW = (s: string, sizePt: number, style: 'normal' | 'bold' = 'normal') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(sizePt);
    return doc.getTextWidth(s);
  };

  // --- walls -------------------------------------------------------------------------------
  doc.setLineWidth(0.2);
  doc.setDrawColor(40);
  doc.setFillColor(85, 90, 96);
  poly(offsetPolygon(outline, WALL_THICKNESS), 'F');
  doc.setFillColor(255, 255, 255);
  poly(outline, 'F');

  // --- objects -----------------------------------------------------------------------------
  for (const it of roomItems) {
    const st = status.get(it.id)!;
    doc.setFillColor(...lighten(hexToRgb(it.color), it.ignoreCollisions ? 0.75 : 0.45));
    const bad = st.outside || st.overlaps.length > 0;
    doc.setDrawColor(...((bad ? [200, 40, 30] : [50, 50, 50]) as [number, number, number]));
    doc.setLineWidth(0.25);
    if (it.ignoreCollisions) doc.setLineDashPattern([1, 0.8], 0);
    poly(worldOutline(it), 'FD');
    doc.setLineDashPattern([], 0);
  }

  // --- openings ----------------------------------------------------------------------------
  doc.setDrawColor(30);
  for (const op of p.openings) {
    const wall = walls[op.wall];
    if (!wall) continue;
    const quad = openingQuad(op, wall);
    const { s, e } = openingEnds(op, wall);
    if (op.kind === 'window') {
      doc.setFillColor(232, 240, 254);
      doc.setLineWidth(0.2);
      poly(quad, 'FD');
      const mid = mul(wall.inward, -WALL_THICKNESS / 2);
      line(add(s, mid), add(e, mid));
    } else {
      doc.setFillColor(255, 255, 255);
      poly(quad, 'F');
      doc.setLineWidth(0.15);
      line(quad[0], quad[3]);
      line(quad[1], quad[2]);
      for (const leaf of doorLeaves(op, wall)) {
        doc.setLineWidth(0.35);
        line(leaf.hinge, leaf.openTip);
        doc.setLineWidth(0.15);
        doc.setLineDashPattern([1, 0.8], 0);
        poly(leaf.arc, 'S', false);
        doc.setLineDashPattern([], 0);
      }
    }
    doc.setTextColor(30);
    const c = add(mul(add(s, e), 0.5), mul(wall.inward, 3.2 / k));
    const tag = op.kind === 'window' ? `${op.label} (sill ${formatLength(op.sillHeight, units)})` : op.label;
    textAt(tag, add(P(c), pt(0, 1)), 6.5, 0, 'bold');
  }

  // --- object labels -----------------------------------------------------------------------
  for (const it of roomItems) {
    const b = itemBox(it);
    const bw = (b.maxX - b.minX) * k, bh = (b.maxY - b.minY) * k;
    const { w, d } = shapeSize(it.shape);
    const sizeTxt = it.shape.kind === 'circle' ? `dia. ${formatLength(w, units)}` : formatDims(w, d, units);
    let size = 7;
    while (size > 4 && (textW(it.label, size, 'bold') > bw * 0.9 || textW(sizeTxt, size * 0.85) > bw * 0.9 || size * 0.35 * 2.6 > bh)) size -= 0.5;
    const c = P(labelAnchor(it));
    doc.setTextColor(20);
    textAt(it.label, add(c, pt(0, -0.2)), size, 0, 'bold');
    doc.setTextColor(70);
    textAt(sizeTxt, add(c, pt(0, size * 0.35 + 0.6)), size * 0.85);
  }

  // --- dimensions --------------------------------------------------------------------------
  for (const d of dims) {
    const L = layoutDim(d);
    const isGap = d.kind === 'gap';
    const col: [number, number, number] = isGap ? [26, 115, 232] : [60, 60, 60];
    doc.setDrawColor(...col);
    doc.setLineWidth(0.12);
    if (d.extension) {
      line(add(d.a, mul(d.normal, 0.8 / k)), add(L.p1, mul(d.normal, 1.2 / k)));
      line(add(d.b, mul(d.normal, 0.8 / k)), add(L.p2, mul(d.normal, 1.2 / k)));
    }
    line(L.p1, L.p2);
    doc.setLineWidth(0.25);
    const t = mul(rotate(L.dir, -45), 1.1 / k);
    line(sub(L.p1, t), add(L.p1, t));
    line(sub(L.p2, t), add(L.p2, t));
    const lenMm = Math.hypot(L.p2.x - L.p1.x, L.p2.y - L.p1.y) * k;
    const size = isGap ? 6 : 7;
    if (lenMm > textW(d.text, size) * 0.6) {
      doc.setTextColor(...col);
      textAt(d.text, add(P(L.mid), mul(L.up, 0.9)), size, L.angle);
    }
  }
  doc.setDrawColor(0);
  doc.setTextColor(0);

  // --- title block & scale bar -------------------------------------------------------------
  const ty = H - MARGIN - TITLE_H + 6;
  doc.setLineWidth(0.3);
  doc.line(MARGIN, ty - 3, W - MARGIN, ty - 3);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(opts.title || p.room.name || 'Room layout', MARGIN, ty + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const rb = bbox(outline);
  const shapeLabel = ROOM_SHAPES[p.room.shape.kind].label;
  doc.text(
    `${shapeLabel} room, ${formatDims(rb.maxX - rb.minX, rb.maxY - rb.minY, units)}   |   Scale 1:${den} on ${opts.paper.toUpperCase()}   |   ${new Date().toLocaleDateString()}`,
    MARGIN,
    ty + 9.5,
  );
  doc.setFontSize(7);
  doc.setTextColor(90);
  doc.text('Dimensions are clear internal measurements. Blue dimensions show object clearance to walls.', MARGIN, ty + 13.5);
  doc.setTextColor(0);
  drawScaleBar(doc, W - MARGIN, ty + 2, k, units);

  if (opts.schedule) drawSchedule(doc, p, roomItems, penItems, status, units);

  const safe = (opts.title || p.room.name || 'room-layout').replace(/[^\w\- ]+/g, '').trim() || 'room-layout';
  doc.save(`${safe}.pdf`);
}

function drawScaleBar(doc: jsPDF, right: number, top: number, k: number, units: Units) {
  const metric = units !== 'ftin';
  const stepCm = metric ? 50 : 30.48; // 0.5 m or 1 ft
  const steps = 4;
  const segMm = stepCm * k;
  const total = segMm * steps;
  const left = right - total;
  doc.setLineWidth(0.2);
  for (let i = 0; i < steps; i++) {
    if (i % 2 === 0) doc.setFillColor(40, 40, 40);
    else doc.setFillColor(255, 255, 255);
    doc.rect(left + i * segMm, top, segMm, 1.6, 'FD');
  }
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  for (let i = 0; i <= steps; i++) {
    const label = metric ? `${(i * 0.5).toString()}${i === steps ? ' m' : ''}` : `${i}${i === steps ? ' ft' : ''}`;
    doc.text(label, left + i * segMm, top + 4.6, { align: 'center' });
  }
}

function drawSchedule(
  doc: jsPDF,
  p: Project,
  roomItems: Item[],
  penItems: Item[],
  status: ReturnType<typeof analyze>,
  units: Units,
) {
  doc.addPage('a4', 'portrait');
  const W = 210;
  let y = 18;
  const L = (n: number) => formatLength(n, units);
  const walls = getWalls(p.room);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`${p.room.name || 'Room'} - schedule`, MARGIN, y);
  y += 9;

  const table = (title: string, cols: { h: string; w: number }[], rows: string[][]) => {
    if (y > 260) {
      doc.addPage('a4', 'portrait');
      y = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(title, MARGIN, y);
    y += 5;
    doc.setFontSize(7.5);
    let x = MARGIN;
    doc.setFillColor(238, 240, 243);
    doc.rect(MARGIN, y - 3.6, W - 2 * MARGIN, 5.2, 'F');
    for (const c of cols) {
      doc.text(c.h, x + 1, y);
      x += c.w;
    }
    y += 5.5;
    doc.setFont('helvetica', 'normal');
    if (!rows.length) {
      doc.setTextColor(120);
      doc.text('None', MARGIN + 1, y);
      doc.setTextColor(0);
      y += 5;
    }
    for (const r of rows) {
      const wrapped = r.map((cell, i) => doc.splitTextToSize(cell, cols[i].w - 2) as string[]);
      const lines = Math.max(...wrapped.map((w) => w.length));
      if (y + lines * 3.4 > 285) {
        doc.addPage('a4', 'portrait');
        y = 18;
      }
      x = MARGIN;
      wrapped.forEach((w, i) => {
        doc.text(w, x + 1, y);
        x += cols[i].w;
      });
      y += lines * 3.4 + 1.6;
      doc.setDrawColor(225);
      doc.line(MARGIN, y - 3.2, W - MARGIN, y - 3.2);
      doc.setDrawColor(0);
    }
    y += 6;
  };

  const opRows = p.openings.map((o) => {
    const w = walls[o.wall];
    const fromStart = o.offset;
    const fromEnd = w ? w.length - o.offset - o.width : 0;
    const where = w ? `${w.name}: ${L(fromStart)} from ${w.startCorner}, ${L(fromEnd)} from ${w.endCorner}` : '?';
    const detail =
      o.kind === 'door'
        ? `${o.leaves === 2 ? 'Double' : `Single, hinged ${o.hinge}`}, opens ${o.swing === 'in' ? 'into room' : 'outward'}`
        : `Sill ${L(o.sillHeight)} above floor`;
    return [o.label, o.kind === 'door' ? 'Door' : 'Window', L(o.width), L(o.height), where, detail];
  });
  table(
    'Doors & windows',
    [
      { h: 'Ref', w: 12 },
      { h: 'Type', w: 16 },
      { h: 'Width', w: 20 },
      { h: 'Height', w: 20 },
      { h: 'Position', w: 66 },
      { h: 'Details', w: 52 },
    ],
    opRows,
  );

  const itemRows = roomItems.map((it) => {
    const { w, d } = shapeSize(it.shape);
    const size = it.shape.kind === 'circle' ? `dia. ${L(w)}` : formatDims(w, d, units);
    const gaps = wallGaps(p, it)
      .map((g) => `${g.side} ${L(g.distance)}`)
      .join(', ');
    const notes = [...statusText(status.get(it.id), p), it.ignoreCollisions ? 'Overlap allowed' : ''].filter(Boolean).join('; ');
    return [
      it.label,
      SHAPE_LABELS[it.shape.kind],
      size,
      it.height ? L(it.height) : '-',
      `${Math.round(it.rotation)} deg`,
      gaps,
      notes,
    ];
  });
  table(
    'Objects in the room',
    [
      { h: 'Object', w: 30 },
      { h: 'Shape', w: 22 },
      { h: 'Size (W x D)', w: 26 },
      { h: 'Height', w: 16 },
      { h: 'Rotation', w: 15 },
      { h: 'Clearance to walls', w: 42 },
      { h: 'Notes', w: 35 },
    ],
    itemRows,
  );

  if (penItems.length) {
    table(
      'Holding pen (not placed)',
      [
        { h: 'Object', w: 50 },
        { h: 'Shape', w: 30 },
        { h: 'Size (W x D)', w: 40 },
        { h: 'Height', w: 30 },
      ],
      penItems.map((it) => {
        const { w, d } = shapeSize(it.shape);
        return [it.label, SHAPE_LABELS[it.shape.kind], it.shape.kind === 'circle' ? `dia. ${L(w)}` : formatDims(w, d, units), it.height ? L(it.height) : '-'];
      }),
    );
  }
}
