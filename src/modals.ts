// Modal dialogs: room setup and PDF export.

import { esc, toast } from './html';
import { ROOM_SHAPES, RoomShapeDef, RoomShapeKind, RoomShape } from './room';
import { Units, UNIT_LABELS, parseLength, formatLength, unitHint } from './units';
import { Project } from './store';
import { exportPdf, Paper } from './pdf';

function openModal(html: string, onClose?: () => void): { root: HTMLElement; close: () => void } {
  const host = document.getElementById('modal-root')!;
  host.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const root = host.querySelector<HTMLElement>('.modal')!;
  const close = () => {
    host.innerHTML = '';
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && root.querySelector('[data-close]')) {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  setTimeout(() => root.querySelector<HTMLElement>('input, select')?.focus(), 0);
  return { root, close };
}

export function isModalOpen(): boolean {
  return !!document.getElementById('modal-root')?.children.length;
}

export interface SetupResult {
  name: string;
  shape: RoomShape;
  units: Units;
}

/** Ask for the room's name, shape and dimensions. */
export function openSetupModal(opts: { existing: Project | null }, onDone: (r: SetupResult) => void) {
  let units: Units = opts.existing?.settings.units ?? 'cm';
  let kind: RoomShapeKind = 'rect';
  const values: Record<string, number> = { ...(ROOM_SHAPES[kind].defaults as unknown as Record<string, number>) };

  const body = () => {
    const def = ROOM_SHAPES[kind] as RoomShapeDef;
    return `
      <h2>${opts.existing ? 'Start a new room' : 'Set up your room'}</h2>
      <p class="muted">Enter the room's internal measurements, wall to wall. You can change them later.</p>
      ${opts.existing ? `<p class="note warn">This replaces the current layout. Use <b>Save</b> first if you want to keep it.</p>` : ''}
      <form class="setup">
        <label class="field"><span>Room name</span><input name="name" value="${esc(opts.existing ? '' : 'Living room')}" placeholder="e.g. Bedroom"></label>
        <div class="row2">
          <label class="field"><span>Shape</span><select name="kind">
            ${Object.entries(ROOM_SHAPES).map(([k, d]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}
          </select></label>
          <label class="field"><span>Units</span><select name="units">
            ${Object.entries(UNIT_LABELS).map(([k, l]) => `<option value="${k}" ${k === units ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select></label>
        </div>
        ${def.fields
          .map(
            (f) => `<label class="field"><span>${esc(f.label)}</span>
            <input name="dim:${f.key}" inputmode="decimal" value="${esc(formatLength(values[f.key], units))}" placeholder="${esc(unitHint(units))}"></label>`,
          )
          .join('')}
        <p class="error" hidden></p>
        <div class="btns end">
          ${opts.existing ? `<button type="button" data-close>Cancel</button>` : ''}
          <button type="submit" class="primary">Create room</button>
        </div>
      </form>`;
  };

  const { root, close } = openModal(body());
  const rerender = () => {
    root.innerHTML = body();
    root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    wire();
  };
  const readDims = (form: HTMLFormElement): string | null => {
    for (const f of (ROOM_SHAPES[kind] as RoomShapeDef).fields) {
      const raw = (form.elements.namedItem(`dim:${f.key}`) as HTMLInputElement).value;
      const v = parseLength(raw, units);
      if (v === null || v <= 0) return `Couldn't read “${raw || '(empty)'}” for ${f.label.toLowerCase()} (${unitHint(units)}).`;
      values[f.key] = v;
    }
    return null;
  };
  const wire = () => {
    const form = root.querySelector<HTMLFormElement>('form')!;
    (form.elements.namedItem('units') as HTMLSelectElement).addEventListener('change', (e) => {
      readDims(form);
      units = (e.target as HTMLSelectElement).value as Units;
      rerender();
    });
    (form.elements.namedItem('kind') as HTMLSelectElement).addEventListener('change', (e) => {
      kind = (e.target as HTMLSelectElement).value as RoomShapeKind;
      Object.assign(values, ROOM_SHAPES[kind].defaults);
      rerender();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const errEl = form.querySelector<HTMLElement>('.error')!;
      let err = readDims(form);
      const shape = { ...(ROOM_SHAPES[kind].defaults as object), ...values, kind } as RoomShape;
      err = err ?? (ROOM_SHAPES[kind] as RoomShapeDef).validate(shape);
      if (err) {
        errEl.textContent = err;
        errEl.hidden = false;
        return;
      }
      const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim() || 'Room';
      close();
      onDone({ name, shape, units });
    });
  };
  wire();
}

export function openExportModal(p: Project) {
  const { root, close } = openModal(`
    <h2>Export PDF</h2>
    <p class="muted">A scaled plan of the room with doors, windows, objects and their measurements.</p>
    <form class="export">
      <label class="field"><span>Title</span><input name="title" value="${esc(p.room.name)}"></label>
      <label class="field"><span>Paper size</span><select name="paper">
        <option value="a4">A4</option><option value="a3">A3</option><option value="letter">US Letter</option>
      </select></label>
      <label class="check"><input type="checkbox" name="objectDims" checked> <span>Show each object's distance to the nearest walls</span></label>
      <label class="check"><input type="checkbox" name="schedule" checked> <span>Add a schedule page (doors, windows, object list)</span></label>
      <div class="btns end">
        <button type="button" data-close>Cancel</button>
        <button type="submit" class="primary">Download PDF</button>
      </div>
    </form>`);
  const form = root.querySelector<HTMLFormElement>('form')!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      exportPdf(p, {
        title: String(fd.get('title') ?? ''),
        paper: String(fd.get('paper')) as Paper,
        objectDims: fd.get('objectDims') === 'on',
        schedule: fd.get('schedule') === 'on',
      });
      close();
      toast('PDF downloaded.');
    } catch (err) {
      console.error(err);
      toast('Sorry — the PDF could not be created.', 'error');
    }
  });
}
