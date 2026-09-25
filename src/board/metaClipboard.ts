import { useSyncExternalStore } from "react";
import type { Node } from "../state/types";

/* ------------------------------------------------------------------ *
 *  The card you copied metadata FROM.
 *
 *  Separate from board/clipboard.ts on purpose: that one cuts and pastes
 *  CARDS (it removes them from the board and holds them until you paste),
 *  and overloading it would mean "Copy" sometimes meaning a card and
 *  sometimes meaning its values. Two clipboards, two clearly-named menu
 *  items.
 *
 *  The values are SNAPSHOTTED at copy time rather than read live from the
 *  source: what you paste should be what you copied, even if the source
 *  has been edited or deleted since.
 * ------------------------------------------------------------------ */

export interface MetaClip {
  title: string; // the source card, so the paste dialog can name it
  values: Record<string, string>; // FieldDef.id -> value, as of the copy
}

let clip: MetaClip | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const metaClipboard = {
  copy(node: Node) {
    clip = { title: node.title, values: { ...(node.values ?? {}) } };
    emit();
  },
  get: () => clip,
  clear() {
    if (!clip) return;
    clip = null;
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const useMetaClip = (): MetaClip | null =>
  useSyncExternalStore(metaClipboard.subscribe, metaClipboard.get, () => null);
