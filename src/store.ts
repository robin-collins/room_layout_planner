// Application state: the project (persisted) plus transient UI state, with undo/redo.

import { Room, Opening, OpeningKind } from './room';
import { Item } from './furniture';
import { Units } from './units';

export interface Settings {
  units: Units;
  snap: number; // grid snap in cm, 0 = off
  showAllDims: boolean;
}

export interface Project {
  version: 1;
  room: Room;
  openings: Opening[];
  items: Item[];
  settings: Settings;
}

export type Selection = { type: 'item' | 'opening'; id: string } | null;

/** What the right-hand panel shows when nothing is selected. */
export type PanelMode = 'help' | 'new-door' | 'new-window' | 'new-item';

export interface PlacingOpening {
  kind: OpeningKind;
}

export interface UIState {
  selection: Selection;
  panel: PanelMode;
  placing: PlacingOpening | null; // waiting for a click on a wall
}

const STORAGE_KEY = 'room-layout-planner.project.v1';
const HISTORY_LIMIT = 200;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function hasDoor(p: Project): boolean {
  return p.openings.some((o) => o.kind === 'door');
}

type Listener = () => void;

export class Store {
  project: Project | null = null;
  ui: UIState = { selection: null, panel: 'help', placing: null };

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private gestureStart: string | null = null;
  private listeners = new Set<Listener>();
  private saveTimer: number | undefined;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(persist = true) {
    if (persist) this.scheduleSave();
    this.listeners.forEach((l) => l());
  }

  private scheduleSave() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 250);
  }

  saveNow() {
    try {
      if (this.project) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project));
    } catch {
      /* storage unavailable or full — the layout can still be saved to a file */
    }
  }

  loadFromStorage(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const p = normalizeProject(JSON.parse(raw));
      if (!p) return false;
      this.setProject(p);
      return true;
    } catch {
      return false;
    }
  }

  setProject(p: Project) {
    this.project = p;
    this.undoStack = [];
    this.redoStack = [];
    this.ui = { selection: null, panel: hasDoor(p) ? 'help' : 'new-door', placing: hasDoor(p) ? null : { kind: 'door' } };
    this.emit();
  }

  /** Apply a change as a single undoable step. */
  mutate(fn: (p: Project) => void) {
    if (!this.project) return;
    const before = JSON.stringify(this.project);
    fn(this.project);
    if (JSON.stringify(this.project) !== before) {
      this.pushUndo(before);
      this.redoStack = [];
    }
    this.emit();
  }

  /** For drags: call begin once, live() on every move, end once — produces one undo step. */
  beginGesture() {
    if (this.project) this.gestureStart = JSON.stringify(this.project);
  }

  live(fn: (p: Project) => void) {
    if (!this.project) return;
    fn(this.project);
    this.emit(false);
  }

  endGesture() {
    if (!this.project || this.gestureStart === null) return;
    if (JSON.stringify(this.project) !== this.gestureStart) {
      this.pushUndo(this.gestureStart);
      this.redoStack = [];
    }
    this.gestureStart = null;
    this.emit();
  }

  private pushUndo(s: string) {
    this.undoStack.push(s);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev || !this.project) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(prev);
    this.fixSelection();
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next || !this.project) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(next);
    this.fixSelection();
    this.emit();
  }

  private fixSelection() {
    const p = this.project!;
    const s = this.ui.selection;
    if (s && !(s.type === 'item' ? p.items : p.openings).some((x) => x.id === s.id)) this.ui.selection = null;
    if (!hasDoor(p)) this.ui = { selection: null, panel: 'new-door', placing: { kind: 'door' } };
  }

  setUI(patch: Partial<UIState>) {
    Object.assign(this.ui, patch);
    // Until the first door exists, keep the door form open.
    if (this.project && !hasDoor(this.project) && this.ui.panel !== 'new-door' && !this.ui.selection) {
      this.ui.panel = 'new-door';
    }
    this.emit(false);
  }

  select(selection: Selection) {
    this.setUI({ selection, placing: selection ? null : this.ui.placing });
  }
}

/** Validate / upgrade a project loaded from storage or a file. */
export function normalizeProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<Project>;
  if (p.version !== 1 || !p.room || !p.room.shape || !Array.isArray(p.openings) || !Array.isArray(p.items)) return null;
  return {
    version: 1,
    room: p.room,
    openings: p.openings,
    items: p.items,
    settings: { units: 'cm', snap: 5, showAllDims: false, ...(p.settings ?? {}) },
  };
}

export function newProject(room: Room, units: Units): Project {
  return { version: 1, room, openings: [], items: [], settings: { units, snap: 5, showAllDims: false } };
}
