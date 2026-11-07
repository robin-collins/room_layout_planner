// Left (room / lists) and right (forms / properties) panels.

import { Store, hasDoor, Project } from './store';
import { esc, toast } from './html';
import { formatLength, formatDims, parseLength, unitHint, Units, UNIT_LABELS } from './units';
import { getWalls, ROOM_SHAPES, RoomShapeDef, clampOffset, Opening, Wall, OpeningKind } from './room';
import {
  Item, ItemShape, ItemShapeKind, SHAPE_LABELS, ITEM_COLORS, PRESET_GROUPS, shapeSize, convertShape,
  validateShape, localOutline, itemBox,
} from './furniture';
import { openingDraft, resetOpeningDraft, itemDraft } from './drafts';
import { analyze, statusText, roomBox, tidyPen, ItemStatus } from './layout';
import { createOpening, addItemFromDraft, deleteSelection, duplicateItem, rotateItem, sendToPen, moveIntoRoom } from './actions';
import { polyPath, bbox } from './geometry';

type Scope = 'room' | 'roomShape' | 'settings' | 'opDraft' | 'op' | 'itemDraft' | 'itemShapeDraft' | 'item' | 'itemShape' | 'itemPos';

const SNAP_OPTIONS: [number, string][] = [
  [0, 'Off'],
  [1, '1 cm'],
  [5, '5 cm'],
  [10, '10 cm'],
];

export class Panels {
  constructor(
    private left: HTMLElement,
    private right: HTMLElement,
    private store: Store,
  ) {
    for (const el of [left, right]) {
      el.addEventListener('click', (e) => this.onClick(e));
      el.addEventListener('change', (e) => this.onChange(e));
      el.addEventListener('keydown', (e) => {
        const t = e.target as HTMLElement;
        if (e.key === 'Enter' && t instanceof HTMLInputElement && t.type === 'text') t.blur();
      });
    }
  }

  private get p(): Project {
    return this.store.project!;
  }
  private get units(): Units {
    return this.p.settings.units;
  }

  // ------------------------------------------------------------------------------------------
  // Field builders

  private lengthField(scope: Scope, key: string, label: string, value: number | undefined, opts: { optional?: boolean; hint?: string } = {}) {
    const v = value === undefined || value === null ? '' : formatLength(value, this.units);
    return `<label class="field"><span>${esc(label)}${opts.optional ? ' <em>(optional)</em>' : ''}</span>
      <input type="text" inputmode="decimal" autocomplete="off" data-bind="${scope}:${key}" data-type="length" ${opts.optional ? 'data-optional="1"' : ''} value="${esc(v)}" placeholder="${esc(opts.hint ?? unitHint(this.units))}"></label>`;
  }

  private textField(scope: Scope, key: string, label: string, value: string) {
    return `<label class="field"><span>${esc(label)}</span><input type="text" autocomplete="off" data-bind="${scope}:${key}" data-type="text" value="${esc(value)}"></label>`;
  }

  private selectField(scope: Scope, key: string, label: string, value: string | number, options: [string | number, string][], type = 'text') {
    return `<label class="field"><span>${esc(label)}</span><select data-bind="${scope}:${key}" data-type="${type}">
      ${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}
    </select></label>`;
  }

  private checkField(scope: Scope, key: string, label: string, checked: boolean, title = '') {
    return `<label class="check" title="${esc(title)}"><input type="checkbox" data-bind="${scope}:${key}" data-type="check" ${checked ? 'checked' : ''}> <span>${esc(label)}</span></label>`;
  }

  private shapeFields(scope: 'itemShapeDraft' | 'itemShape', s: ItemShape): string {
    switch (s.kind) {
      case 'rect':
      case 'oval':
        return `<div class="row2">${this.lengthField(scope, 'width', 'Width', s.width)}${this.lengthField(scope, 'depth', 'Depth', s.depth)}</div>`;
      case 'circle':
        return this.lengthField(scope, 'diameter', 'Diameter', s.diameter);
      case 'L':
        return `<div class="row2">${this.lengthField(scope, 'width', 'Overall width', s.width)}${this.lengthField(scope, 'depth', 'Overall depth', s.depth)}</div>
          <div class="row2">${this.lengthField(scope, 'armA', 'Side arm thickness', s.armA)}${this.lengthField(scope, 'armB', 'Bottom arm thickness', s.armB)}</div>
          ${this.checkField(scope, 'mirror', 'Mirror (arm on the right)', s.mirror)}`;
    }
  }

  private shapePreview(s: ItemShape, color: string): string {
    const pts = localOutline(s);
    const b = bbox(pts);
    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.08;
    return `<svg class="shape-preview" viewBox="${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}">
      <path d="${polyPath(pts)}" fill="${esc(color)}" fill-opacity="0.7" stroke="#3c4043" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
  }

  private swatches(target: 'draft' | 'item', current: string) {
    return `<div class="field"><span>Colour</span><div class="swatches">${ITEM_COLORS.map(
      (c) => `<button type="button" class="swatch ${c === current ? 'on' : ''}" style="background:${c}" data-action="color" data-target="${target}" data-color="${c}" aria-label="Colour ${c}"></button>`,
    ).join('')}</div></div>`;
  }

  private sizeText(it: { shape: ItemShape }) {
    const { w, d } = shapeSize(it.shape);
    return it.shape.kind === 'circle' ? `Ø ${formatLength(w, this.units)}` : formatDims(w, d, this.units);
  }

  // ------------------------------------------------------------------------------------------
  // Render

  render() {
    if (!this.store.project) {
      this.left.innerHTML = '';
      this.right.innerHTML = '';
      return;
    }
    const focus = this.captureFocus();
    const status = analyze(this.p);
    this.left.innerHTML = this.renderLeft(status);
    this.right.innerHTML = this.renderRight(status);
    this.restoreFocus(focus);
  }

  private captureFocus() {
    const el = document.activeElement as HTMLInputElement | null;
    if (!el || !(this.left.contains(el) || this.right.contains(el)) || !el.dataset.bind) return null;
    let sel: [number, number] | null = null;
    try {
      sel = el.selectionStart !== null ? [el.selectionStart, el.selectionEnd ?? el.selectionStart] : null;
    } catch {
      sel = null;
    }
    return { bind: el.dataset.bind, sel };
  }

  private restoreFocus(f: ReturnType<Panels['captureFocus']>) {
    if (!f) return;
    const el = (this.left.querySelector(`[data-bind="${f.bind}"]`) ?? this.right.querySelector(`[data-bind="${f.bind}"]`)) as HTMLInputElement | null;
    if (!el) return;
    el.focus();
    try {
      if (f.sel) el.setSelectionRange(f.sel[0], f.sel[1]);
    } catch {
      /* not a text input */
    }
  }

  private renderLeft(status: Map<string, ItemStatus>): string {
    const p = this.p;
    const def = ROOM_SHAPES[p.room.shape.kind] as RoomShapeDef;
    const shape = p.room.shape as unknown as Record<string, number>;
    const doorOk = hasDoor(p);
    const sel = this.store.ui.selection;
    const walls = getWalls(p.room);

    const opList = p.openings
      .map((o) => {
        const w = walls[o.wall];
        const on = sel?.type === 'opening' && sel.id === o.id;
        return `<li class="${on ? 'on' : ''}" data-action="select-opening" data-id="${o.id}">
          <span class="tag ${o.kind}">${esc(o.label)}</span>
          <span class="grow">${o.kind === 'door' ? 'Door' : 'Window'} · ${esc(w?.name ?? '?')}</span>
          <span class="muted">${esc(formatLength(o.width, this.units))}</span></li>`;
      })
      .join('');

    const itemLi = (it: Item) => {
      const st = status.get(it.id);
      const warns = st?.inRoom ? statusText(st, p) : [];
      const on = sel?.type === 'item' && sel.id === it.id;
      return `<li class="${on ? 'on' : ''}" data-action="select-item" data-id="${it.id}" title="${esc(warns.join('\n'))}">
        <span class="dot" style="background:${esc(it.color)}"></span>
        <span class="grow">${esc(it.label)}</span>
        ${warns.length ? `<span class="warn" aria-label="Has warnings">!</span>` : ''}
        <span class="muted">${esc(this.sizeText(it))}</span></li>`;
    };
    const inRoom = p.items.filter((i) => status.get(i.id)?.inRoom);
    const inPen = p.items.filter((i) => !status.get(i.id)?.inRoom);

    return `
      <section class="card">
        <h2>Room</h2>
        ${this.textField('room', 'name', 'Name', p.room.name)}
        <div class="row2">${def.fields.map((fd) => this.lengthField('roomShape', fd.key, fd.label.replace(/ \(.*\)/, ''), shape[fd.key])).join('')}</div>
        <div class="row2">
          ${this.selectField('settings', 'units', 'Units', p.settings.units, Object.entries(UNIT_LABELS) as [string, string][])}
          ${this.selectField('settings', 'snap', 'Snap to grid', p.settings.snap, SNAP_OPTIONS, 'int')}
        </div>
        ${this.checkField('settings', 'showAllDims', 'Show all dimensions', p.settings.showAllDims)}
      </section>

      <section class="card">
        <h2>Doors &amp; windows</h2>
        ${p.openings.length ? `<ul class="list">${opList}</ul>` : `<p class="muted small">No doors yet — the room needs at least one.</p>`}
        <div class="btns">
          <button data-action="new-door">+ Door</button>
          <button data-action="new-window" ${doorOk ? '' : 'disabled title="Add the first door before windows"'}>+ Window</button>
        </div>
      </section>

      <section class="card ${doorOk ? '' : 'disabled'}">
        <h2>Objects</h2>
        <button class="primary wide" data-action="new-item" ${doorOk ? '' : 'disabled'}>+ New object</button>
        <h3>In the room <span class="count">${inRoom.length}</span></h3>
        ${inRoom.length ? `<ul class="list">${inRoom.map(itemLi).join('')}</ul>` : `<p class="muted small">Drag objects from the holding pen into the room.</p>`}
        <h3>Holding pen <span class="count">${inPen.length}</span>
          ${inPen.length > 1 ? `<button class="link" data-action="tidy-pen">Tidy</button>` : ''}</h3>
        ${inPen.length ? `<ul class="list">${inPen.map(itemLi).join('')}</ul>` : `<p class="muted small">Empty.</p>`}
      </section>`;
  }

  private renderRight(status: Map<string, ItemStatus>): string {
    const p = this.p;
    const sel = this.store.ui.selection;
    if (sel?.type === 'item') {
      const it = p.items.find((i) => i.id === sel.id);
      if (it) return this.renderItemProps(it, status.get(it.id));
    }
    if (sel?.type === 'opening') {
      const op = p.openings.find((o) => o.id === sel.id);
      if (op) return this.renderOpeningProps(op);
    }
    switch (this.store.ui.panel) {
      case 'new-door':
        return this.renderOpeningForm('door');
      case 'new-window':
        return this.renderOpeningForm('window');
      case 'new-item':
        return this.renderItemForm();
      default:
        return this.renderHelp();
    }
  }

  private renderHelp(): string {
    return `<section class="card help">
      <h2>Tips</h2>
      <ul>
        <li><b>Add objects</b> with “+ New object”. They start in the <b>holding pen</b> beside the room.</li>
        <li><b>Drag</b> objects into the room. They snap to the grid and to walls (hold <kbd>Alt</kbd> to disable snapping).</li>
        <li><b>Rotate</b> with the round handle (15° steps, <kbd>Shift</kbd> for free), or press <kbd>R</kbd> for 90°.</li>
        <li><b>Arrow keys</b> nudge 1 cm (<kbd>Shift</kbd> = 10 cm). <kbd>Del</kbd> deletes, <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicates.</li>
        <li>Drag doors and windows along the walls, or select one to type exact positions.</li>
        <li><b>Pan</b> by dragging empty space, <b>zoom</b> with the mouse wheel.</li>
        <li>Red outlines mean overlaps or objects through walls; orange means an object blocks a door’s swing.</li>
        <li>Your layout is saved in this browser automatically. Use <b>Save</b> to keep a file copy.</li>
      </ul></section>`;
  }

  private renderOpeningForm(kind: OpeningKind): string {
    const p = this.p;
    const first = !hasDoor(p);
    const d = openingDraft;
    if (d.kind !== kind) resetOpeningDraft(kind);
    const walls = getWalls(p.room);
    const wall = walls[d.wall] ?? walls[0];
    d.wall = wall.index;
    const placing = !!this.store.ui.placing;
    const noun = kind === 'door' ? 'door' : 'window';
    return `<section class="card">
      <h2>${first ? 'Add the first door' : `New ${noun}`}</h2>
      ${first ? `<p class="note">Every room needs at least one door. Set its size, then click a wall on the plan — or place it by measurement.</p>` : ''}
      <h3>Size</h3>
      ${this.openingSizeFields('opDraft', d)}
      <h3>Position</h3>
      <button class="wide ${placing ? 'active' : 'primary'}" data-action="toggle-place">${placing ? `Click a wall on the plan… (Esc to stop)` : `Place with mouse`}</button>
      <div class="or"><span>or by measurement</span></div>
      ${this.selectField('opDraft', 'wall', 'Wall', wall.index, walls.map((w) => [w.index, `${w.name} (${formatLength(w.length, this.units)})`]), 'int')}
      ${this.selectField('opDraft', 'fromEnd', 'Measure from corner', d.fromEnd ? 1 : 0, [[0, wall.startCorner], [1, wall.endCorner]], 'int')}
      ${this.lengthField('opDraft', 'distance', `Distance from that corner to the ${noun}'s edge`, d.distance)}
      <div class="btns">
        <button class="primary" data-action="place-measure">Place ${noun}</button>
        ${first ? '' : `<button data-action="cancel-panel">Cancel</button>`}
      </div>
    </section>`;
  }

  private openingSizeFields(scope: 'opDraft' | 'op', o: Pick<Opening, 'kind' | 'width' | 'height' | 'leaves' | 'hinge' | 'swing' | 'sillHeight'>): string {
    if (o.kind === 'window') {
      return `<div class="row2">${this.lengthField(scope, 'width', 'Width', o.width)}${this.lengthField(scope, 'height', 'Window height', o.height)}</div>
        ${this.lengthField(scope, 'sillHeight', 'Height from floor (sill)', o.sillHeight)}`;
    }
    return `<div class="row2">${this.lengthField(scope, 'width', 'Width', o.width)}${this.lengthField(scope, 'height', 'Height', o.height)}</div>
      <div class="row2">
        ${this.selectField(scope, 'leaves', 'Type', o.leaves, [[1, 'Single'], [2, 'Double']], 'int')}
        ${this.selectField(scope, 'swing', 'Opens', o.swing, [['in', 'Into room'], ['out', 'Outward']])}
      </div>
      ${o.leaves === 1 ? this.selectField(scope, 'hinge', 'Hinges (seen from inside)', o.hinge, [['left', 'Left side'], ['right', 'Right side']]) : ''}`;
  }

  private renderOpeningProps(op: Opening): string {
    const p = this.p;
    const walls = getWalls(p.room);
    const wall = walls[op.wall];
    const lastDoor = op.kind === 'door' && p.openings.filter((o) => o.kind === 'door').length === 1;
    return `<section class="card">
      <h2><span class="tag ${op.kind}">${esc(op.label)}</span> ${op.kind === 'door' ? 'Door' : 'Window'}</h2>
      ${this.textField('op', 'label', 'Label', op.label)}
      <h3>Size</h3>
      ${this.openingSizeFields('op', op)}
      <h3>Position</h3>
      ${this.selectField('op', 'wall', 'Wall', op.wall, walls.map((w) => [w.index, `${w.name} (${formatLength(w.length, this.units)})`]), 'int')}
      ${wall ? `<div class="row2">
        ${this.lengthField('op', 'fromStart', `From ${wall.startCorner} corner`, op.offset)}
        ${this.lengthField('op', 'fromEnd', `From ${wall.endCorner} corner`, wall.length - op.offset - op.width)}
      </div>` : ''}
      <p class="muted small">Distances are to the nearest edge of the opening. You can also drag it along the wall.</p>
      <div class="btns">
        <button class="danger" data-action="delete" ${lastDoor ? 'disabled title="The room needs at least one door"' : ''}>Delete</button>
      </div>
    </section>`;
  }

  private renderItemForm(): string {
    const d = itemDraft;
    return `<section class="card">
      <h2>New object</h2>
      <label class="field"><span>Start from a preset</span><select data-bind="itemDraft:preset" data-type="text">
        <option value="">Custom…</option>
        ${PRESET_GROUPS.map((g) => `<optgroup label="${esc(g.group)}">${g.items.map((it) => `<option value="${esc(it.label)}" ${d.preset === it.label ? 'selected' : ''}>${esc(it.label)}</option>`).join('')}</optgroup>`).join('')}
      </select></label>
      ${this.textField('itemDraft', 'label', 'Label', d.label)}
      ${this.selectField('itemDraft', 'shapeKind', 'Shape', d.shape.kind, Object.entries(SHAPE_LABELS) as [string, string][])}
      <div class="shape-row">${this.shapePreview(d.shape, d.color)}<div class="grow">${this.shapeFields('itemShapeDraft', d.shape)}</div></div>
      ${this.lengthField('itemDraft', 'height', 'Height', d.height, { optional: true, hint: 'optional' })}
      ${this.swatches('draft', d.color)}
      ${this.checkField('itemDraft', 'ignoreCollisions', 'Allow overlaps (rugs, wall-mounted items)', d.ignoreCollisions)}
      <div class="btns">
        <button class="primary" data-action="add-item">Add to holding pen</button>
        <button data-action="cancel-panel">Close</button>
      </div>
    </section>`;
  }

  private renderItemProps(it: Item, st: ItemStatus | undefined): string {
    const p = this.p;
    const warns = st?.inRoom ? statusText(st, p) : [];
    let pos = '';
    if (st?.inRoom) {
      const rb = roomBox(p);
      const b = itemBox(it);
      pos = `<div class="row2">
        ${this.lengthField('itemPos', 'left', 'From left wall', b.minX - rb.minX)}
        ${this.lengthField('itemPos', 'top', 'From top wall', b.minY - rb.minY)}</div>`;
    }
    return `<section class="card">
      <h2><span class="dot" style="background:${esc(it.color)}"></span> ${esc(it.label)}</h2>
      ${warns.length ? `<div class="warnbox">${warns.map((w) => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : ''}
      ${this.textField('item', 'label', 'Label', it.label)}
      ${this.selectField('item', 'shapeKind', 'Shape', it.shape.kind, Object.entries(SHAPE_LABELS) as [string, string][])}
      <div class="shape-row">${this.shapePreview(it.shape, it.color)}<div class="grow">${this.shapeFields('itemShape', it.shape)}</div></div>
      ${this.lengthField('item', 'height', 'Height', it.height, { optional: true, hint: 'optional' })}
      <h3>Placement</h3>
      <div class="row-rot">
        <label class="field"><span>Rotation (°)</span><input type="number" step="1" data-bind="item:rotation" data-type="number" value="${+it.rotation.toFixed(1)}"></label>
        <button data-action="rot-ccw" title="Rotate 90° anticlockwise">⟲ 90°</button>
        <button data-action="rot-cw" title="Rotate 90° clockwise (R)">⟳ 90°</button>
      </div>
      ${pos}
      ${this.swatches('item', it.color)}
      ${this.checkField('item', 'ignoreCollisions', 'Allow overlaps (rugs, wall-mounted items)', !!it.ignoreCollisions)}
      <div class="btns">
        ${st?.inRoom ? `<button data-action="to-pen">Move to holding pen</button>` : `<button data-action="to-room">Move into room</button>`}
        <button data-action="duplicate">Duplicate</button>
        <button class="danger" data-action="delete">Delete</button>
      </div>
    </section>`;
  }

  // ------------------------------------------------------------------------------------------
  // Events

  private onClick(e: Event) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    const s = this.store;
    const sel = s.ui.selection;
    switch (el.dataset.action) {
      case 'select-item':
      case 'select-opening':
        s.select({ type: el.dataset.action === 'select-item' ? 'item' : 'opening', id: el.dataset.id! });
        break;
      case 'new-door':
      case 'new-window': {
        const kind = el.dataset.action === 'new-door' ? 'door' : 'window';
        resetOpeningDraft(kind);
        s.setUI({ selection: null, panel: el.dataset.action, placing: { kind } });
        break;
      }
      case 'new-item':
        s.setUI({ selection: null, panel: 'new-item', placing: null });
        break;
      case 'cancel-panel':
        s.setUI({ panel: 'help', placing: null });
        break;
      case 'toggle-place':
        s.setUI({ placing: s.ui.placing ? null : { kind: openingDraft.kind } });
        break;
      case 'place-measure':
        this.placeByMeasurement();
        break;
      case 'add-item':
        if (addItemFromDraft(s)) toast('Added to the holding pen — drag it into the room.');
        break;
      case 'color':
        if (el.dataset.target === 'draft') {
          itemDraft.color = el.dataset.color!;
          this.render();
        } else if (sel?.type === 'item') {
          this.updateItem(sel.id, (it) => (it.color = el.dataset.color!));
        }
        break;
      case 'delete': {
        const err = deleteSelection(s);
        if (err) toast(err, 'error');
        break;
      }
      case 'duplicate':
        if (sel?.type === 'item') duplicateItem(s, sel.id);
        break;
      case 'rot-cw':
      case 'rot-ccw':
        if (sel?.type === 'item') rotateItem(s, sel.id, el.dataset.action === 'rot-cw' ? 90 : -90);
        break;
      case 'to-pen':
        if (sel?.type === 'item') sendToPen(s, sel.id);
        break;
      case 'to-room':
        if (sel?.type === 'item') moveIntoRoom(s, sel.id);
        break;
      case 'tidy-pen':
        s.mutate((p) => tidyPen(p));
        break;
    }
  }

  private placeByMeasurement() {
    const p = this.p;
    const d = openingDraft;
    const wall = getWalls(p.room)[d.wall];
    if (!wall) return;
    if (d.width > wall.length) {
      toast(`The ${d.kind} is wider than the ${wall.name.toLowerCase()}.`, 'error');
      return;
    }
    const offset = d.fromEnd ? wall.length - d.distance - d.width : d.distance;
    if (offset < -0.01 || offset + d.width > wall.length + 0.01) {
      const max = wall.length - d.width;
      toast(`That doesn't fit: on this wall the distance can be at most ${formatLength(max, this.units)}.`, 'error');
      return;
    }
    createOpening(this.store, wall.index, offset);
  }

  private updateItem(id: string, fn: (it: Item) => void) {
    this.store.mutate((p) => {
      const it = p.items.find((i) => i.id === id);
      if (it) fn(it);
    });
  }

  private updateOpening(id: string, fn: (op: Opening, wall: Wall, walls: Wall[]) => void) {
    this.store.mutate((p) => {
      const op = p.openings.find((o) => o.id === id);
      const walls = getWalls(p.room);
      if (op && walls[op.wall]) fn(op, walls[op.wall], walls);
    });
  }

  private onChange(e: Event) {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const bind = el.dataset.bind;
    if (!bind) return;
    const [scope, key] = bind.split(':') as [Scope, string];
    const type = el.dataset.type;

    let value: string | number | boolean | undefined;
    if (type === 'length') {
      const raw = el.value.trim();
      if (!raw && el.dataset.optional) value = undefined;
      else {
        const v = parseLength(raw, this.units);
        if (v === null || v < 0) {
          el.classList.add('invalid');
          toast(`Couldn't read “${raw}” as a length (${unitHint(this.units)}).`, 'error');
          return;
        }
        value = Math.round(v * 100) / 100;
      }
    } else if (type === 'check') value = (el as HTMLInputElement).checked;
    else if (type === 'int') value = parseInt(el.value, 10);
    else if (type === 'number') {
      value = parseFloat(el.value);
      if (!Number.isFinite(value)) return;
    } else value = el.value;

    const err = this.apply(scope, key, value);
    if (err) {
      toast(err, 'error');
      this.renderSoon();
    }
  }

  /**
   * Re-render after the current event has finished. A 'change' event fires while Tab is moving
   * focus; rendering synchronously would replace the field mid-move and the Tab would be lost.
   * Deferring lets focus land on the next field first, and render() then keeps it there.
   */
  private renderQueued = false;
  private renderSoon() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  /** Apply a field change. Returns an error message if the value was rejected. */
  private apply(scope: Scope, key: string, value: string | number | boolean | undefined): string | null {
    const s = this.store;
    const sel = s.ui.selection;
    switch (scope) {
      case 'room':
        s.mutate((p) => ((p.room as unknown as Record<string, unknown>)[key] = value));
        return null;

      case 'roomShape': {
        const shape = { ...s.project!.room.shape, [key]: value };
        const err = (ROOM_SHAPES[shape.kind] as RoomShapeDef).validate(shape);
        if (err) return err;
        s.mutate((p) => {
          p.room.shape = shape;
          const walls = getWalls(p.room);
          for (const op of p.openings) {
            const w = walls[op.wall];
            if (!w) continue;
            op.width = Math.min(op.width, w.length);
            op.offset = clampOffset(op, w, op.offset);
          }
        });
        return null;
      }

      case 'settings':
        s.mutate((p) => ((p.settings as unknown as Record<string, unknown>)[key] = value));
        return null;

      case 'opDraft': {
        const d = openingDraft as unknown as Record<string, unknown>;
        if (key === 'fromEnd') d.fromEnd = value === 1;
        else d[key] = value;
        this.renderSoon();
        return null;
      }

      case 'op': {
        if (sel?.type !== 'opening') return null;
        let err: string | null = null;
        this.updateOpening(sel.id, (op, wall, walls) => {
          if (key === 'fromStart' || key === 'fromEnd') {
            const v = value as number;
            const offset = key === 'fromStart' ? v : wall.length - v - op.width;
            if (offset < -0.01 || offset + op.width > wall.length + 0.01) {
              err = `That doesn't fit on this wall (max ${formatLength(wall.length - op.width, this.units)}).`;
              return;
            }
            op.offset = clampOffset(op, wall, offset);
          } else if (key === 'width') {
            if ((value as number) > wall.length) {
              err = 'The opening is wider than the wall.';
              return;
            }
            if ((value as number) < 10) {
              err = 'Width must be at least 10 cm.';
              return;
            }
            op.width = value as number;
            op.offset = clampOffset(op, wall, op.offset);
          } else if (key === 'wall') {
            const nw = walls[value as number];
            if (!nw || op.width > nw.length) {
              err = 'The opening is wider than that wall.';
              return;
            }
            op.wall = nw.index;
            op.offset = clampOffset(op, nw, op.offset);
          } else {
            (op as unknown as Record<string, unknown>)[key] = value;
          }
        });
        return err;
      }

      case 'itemDraft': {
        if (key === 'preset') {
          itemDraft.preset = value as string;
          const preset = PRESET_GROUPS.flatMap((g) => g.items).find((x) => x.label === value);
          if (preset) {
            itemDraft.label = preset.label;
            itemDraft.shape = structuredClone(preset.shape);
            itemDraft.height = preset.height;
            itemDraft.ignoreCollisions = !!preset.ignoreCollisions;
          }
        } else if (key === 'shapeKind') {
          itemDraft.shape = convertShape(itemDraft.shape, value as ItemShapeKind);
        } else {
          (itemDraft as unknown as Record<string, unknown>)[key] = value;
        }
        this.renderSoon();
        return null;
      }

      case 'itemShapeDraft': {
        const shape = { ...itemDraft.shape, [key]: value } as ItemShape;
        const err = validateShape(shape);
        if (err) return err;
        itemDraft.shape = shape;
        this.renderSoon();
        return null;
      }

      case 'item':
        if (sel?.type !== 'item') return null;
        this.updateItem(sel.id, (it) => {
          if (key === 'shapeKind') it.shape = convertShape(it.shape, value as ItemShapeKind);
          else if (key === 'rotation') it.rotation = ((((value as number) % 360) + 360) % 360);
          else if (key === 'label') it.label = (value as string).trim() || 'Object';
          else (it as unknown as Record<string, unknown>)[key] = value;
        });
        return null;

      case 'itemShape': {
        if (sel?.type !== 'item') return null;
        const it = s.project!.items.find((i) => i.id === sel.id);
        if (!it) return null;
        const shape = { ...it.shape, [key]: value } as ItemShape;
        const err = validateShape(shape);
        if (err) return err;
        this.updateItem(sel.id, (x) => (x.shape = shape));
        return null;
      }

      case 'itemPos': {
        if (sel?.type !== 'item') return null;
        const p = s.project!;
        const it = p.items.find((i) => i.id === sel.id);
        if (!it) return null;
        const rb = roomBox(p);
        const b = itemBox(it);
        this.updateItem(sel.id, (x) => {
          if (key === 'left') x.x += (value as number) - (b.minX - rb.minX);
          else x.y += (value as number) - (b.minY - rb.minY);
        });
        return null;
      }
    }
    return null;
  }
}
