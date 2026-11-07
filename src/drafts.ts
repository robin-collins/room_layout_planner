// In-progress "new door/window" and "new object" forms. Kept outside the store so they survive
// panel re-renders but aren't saved or undone.

import { defaultOpening, Opening, OpeningKind } from './room';
import { ItemShape, ITEM_COLORS } from './furniture';

export type OpeningDraft = Omit<Opening, 'id' | 'label' | 'wall' | 'offset'> & {
  wall: number;
  fromEnd: boolean; // measure from the wall's end corner instead of its start corner
  distance: number; // from that corner to the nearest edge of the opening
};

export const openingDraft: OpeningDraft = { ...defaultOpening('door'), wall: 0, fromEnd: false, distance: 30 };

export function resetOpeningDraft(kind: OpeningKind) {
  Object.assign(openingDraft, defaultOpening(kind));
}

export interface ItemDraft {
  preset: string;
  label: string;
  shape: ItemShape;
  color: string;
  height?: number;
  ignoreCollisions: boolean;
}

let colorIndex = 0;

export const itemDraft: ItemDraft = {
  preset: '',
  label: 'Object',
  shape: { kind: 'rect', width: 100, depth: 60 },
  color: ITEM_COLORS[0],
  ignoreCollisions: false,
};

export function nextColor(): string {
  colorIndex = (colorIndex + 1) % ITEM_COLORS.length;
  return ITEM_COLORS[colorIndex];
}
