// Operations shared by the canvas, panels and keyboard shortcuts.

import { Store, uid, hasDoor } from './store';
import { getWalls, nextOpeningLabel, clampOffset, Opening } from './room';
import { openingDraft, itemDraft, nextColor } from './drafts';
import { Item } from './furniture';
import { findPenSpot, isInRoom, roomBox } from './layout';

export function createOpening(store: Store, wallIndex: number, offset: number): Opening | null {
  const p = store.project;
  if (!p) return null;
  const wall = getWalls(p.room)[wallIndex];
  if (!wall || openingDraft.width > wall.length) return null;
  const { wall: _w, fromEnd: _f, distance: _d, ...props } = openingDraft;
  const op: Opening = {
    ...props,
    id: uid(),
    label: nextOpeningLabel(p.openings, openingDraft.kind),
    wall: wallIndex,
    offset: clampOffset(openingDraft, wall, offset),
  };
  store.mutate((pr) => pr.openings.push(op));
  store.setUI({ placing: null, panel: 'help', selection: { type: 'opening', id: op.id } });
  return op;
}

export function addItemFromDraft(store: Store): Item | null {
  const p = store.project;
  if (!p) return null;
  const item: Item = {
    id: uid(),
    label: itemDraft.label.trim() || 'Object',
    shape: structuredClone(itemDraft.shape),
    x: 0,
    y: 0,
    rotation: 0,
    color: itemDraft.color,
    height: itemDraft.height,
    ignoreCollisions: itemDraft.ignoreCollisions || undefined,
  };
  const spot = findPenSpot(p, item);
  item.x = spot.x;
  item.y = spot.y;
  store.mutate((pr) => pr.items.push(item));
  store.setUI({ selection: { type: 'item', id: item.id } });
  itemDraft.color = nextColor();
  return item;
}

export function deleteSelection(store: Store): string | null {
  const p = store.project;
  const sel = store.ui.selection;
  if (!p || !sel) return null;
  if (sel.type === 'opening') {
    const op = p.openings.find((o) => o.id === sel.id);
    if (op?.kind === 'door' && p.openings.filter((o) => o.kind === 'door').length === 1) {
      return 'The room needs at least one door. Add another door before deleting this one.';
    }
    store.mutate((pr) => (pr.openings = pr.openings.filter((o) => o.id !== sel.id)));
  } else {
    store.mutate((pr) => (pr.items = pr.items.filter((i) => i.id !== sel.id)));
  }
  store.select(null);
  if (!hasDoor(store.project!)) store.setUI({ panel: 'new-door' });
  return null;
}

export function duplicateItem(store: Store, id: string) {
  const p = store.project;
  const src = p?.items.find((i) => i.id === id);
  if (!p || !src) return;
  const copy: Item = { ...structuredClone(src), id: uid(), x: src.x + 20, y: src.y + 20 };
  if (!isInRoom(p, copy)) Object.assign(copy, findPenSpot(p, copy));
  store.mutate((pr) => pr.items.push(copy));
  store.select({ type: 'item', id: copy.id });
}

export function rotateItem(store: Store, id: string, by: number) {
  store.mutate((p) => {
    const it = p.items.find((i) => i.id === id);
    if (it) it.rotation = (((it.rotation + by) % 360) + 360) % 360;
  });
}

export function moveItem(store: Store, id: string, dx: number, dy: number) {
  store.mutate((p) => {
    const it = p.items.find((i) => i.id === id);
    if (it) {
      it.x += dx;
      it.y += dy;
    }
  });
}

export function sendToPen(store: Store, id: string) {
  store.mutate((p) => {
    const it = p.items.find((i) => i.id === id);
    if (!it) return;
    const spot = findPenSpot(p, it);
    it.x = spot.x;
    it.y = spot.y;
  });
}

export function moveIntoRoom(store: Store, id: string) {
  store.mutate((p) => {
    const it = p.items.find((i) => i.id === id);
    if (!it) return;
    const b = roomBox(p);
    it.x = (b.minX + b.maxX) / 2;
    it.y = (b.minY + b.maxY) / 2;
  });
}
