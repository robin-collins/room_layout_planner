import './style.css';
import { Store, newProject, normalizeProject, hasDoor } from './store';
import { CanvasView } from './canvas';
import { Panels } from './panels';
import { openSetupModal, openExportModal, isModalOpen } from './modals';
import { deleteSelection, rotateItem, moveItem, duplicateItem } from './actions';
import { toast } from './html';

const store = new Store();
const svg = document.getElementById('canvas') as unknown as SVGSVGElement;
const canvas = new CanvasView(svg, store);
const panels = new Panels(document.getElementById('left')!, document.getElementById('right')!, store);

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function renderChrome() {
  const p = store.project;
  $('#room-title').textContent = p ? p.room.name : '';
  $<HTMLButtonElement>('[data-cmd="undo"]').disabled = !store.canUndo;
  $<HTMLButtonElement>('[data-cmd="redo"]').disabled = !store.canRedo;
  $<HTMLButtonElement>('[data-cmd="export"]').disabled = !p || !hasDoor(p);
  const hint = $('#hint');
  const placing = store.ui.placing;
  let msg = '';
  if (placing) msg = `Click on a wall to place the ${placing.kind}. Press Esc to stop.`;
  else if (p && !hasDoor(p)) msg = 'Add the first door: click “Place with mouse” or enter a measurement on the right.';
  hint.textContent = msg;
  hint.hidden = !msg;
}

let frame = 0;
store.subscribe(() => {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    canvas.render();
    panels.render();
    renderChrome();
  });
});

function startNewRoom() {
  openSetupModal({ existing: store.project }, (r) => {
    store.setProject(newProject({ name: r.name, shape: r.shape }, r.units));
    canvas.requestFit();
  });
}

function saveToFile() {
  const p = store.project;
  if (!p) return;
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(p.room.name || 'room').replace(/[^\w\- ]+/g, '').trim() || 'room'}.layout.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const fileInput = document.getElementById('file-input') as HTMLInputElement;
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const p = normalizeProject(JSON.parse(await file.text()));
    if (!p) throw new Error('not a layout');
    store.setProject(p);
    canvas.requestFit();
    toast(`Opened “${p.room.name}”.`);
  } catch {
    toast("That file isn't a room layout saved by this app.", 'error');
  }
});

document.querySelector('.topbar')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-cmd]');
  if (!btn || btn.disabled) return;
  switch (btn.dataset.cmd) {
    case 'new':
      startNewRoom();
      break;
    case 'open':
      fileInput.click();
      break;
    case 'save':
      saveToFile();
      break;
    case 'undo':
      store.undo();
      break;
    case 'redo':
      store.redo();
      break;
    case 'export':
      if (store.project) openExportModal(store.project);
      break;
  }
});

document.querySelector('.zoom')!.addEventListener('click', (e) => {
  const cmd = (e.target as HTMLElement).closest<HTMLElement>('[data-zoom]')?.dataset.zoom;
  if (cmd === 'in') canvas.zoomBy(1.25);
  else if (cmd === 'out') canvas.zoomBy(0.8);
  else if (cmd === 'fit') canvas.requestFit();
});

document.addEventListener('keydown', (e) => {
  if (isModalOpen() || !store.project) return;
  const t = e.target as HTMLElement;
  const typing = t.closest('input, select, textarea');
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && key === 's') {
    e.preventDefault();
    saveToFile();
    return;
  }
  if (typing) return;
  if (mod && key === 'z') {
    e.preventDefault();
    e.shiftKey ? store.redo() : store.undo();
    return;
  }
  if (mod && key === 'y') {
    e.preventDefault();
    store.redo();
    return;
  }

  const sel = store.ui.selection;
  if (e.key === 'Escape') {
    if (store.ui.placing) store.setUI({ placing: null });
    else store.select(null);
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    const err = deleteSelection(store);
    if (err) toast(err, 'error');
    return;
  }
  if (sel?.type !== 'item') return;
  if (mod && key === 'd') {
    e.preventDefault();
    duplicateItem(store, sel.id);
  } else if (key === 'r' && !mod) {
    rotateItem(store, sel.id, e.shiftKey ? -90 : 90);
  } else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    moveItem(store, sel.id, dx, dy);
  }
});

window.addEventListener('beforeunload', () => store.saveNow());

if (store.loadFromStorage()) {
  canvas.requestFit();
} else {
  renderChrome();
  startNewRoom();
}
