import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ *
 *  The Promotion choice (owner's design, 2026-08-02): promoting a card
 *  that sits in the MIDDLE of its parent has two honest answers, and
 *  which one you want depends on why you're promoting --
 *
 *    Split  -- the parent splits around the promoted card, the trailing
 *              siblings moving into "<parent> (cont'd)". READING ORDER
 *              IS PRESERVED: the promoted card stays exactly where it
 *              sat in the story. The default instinct.
 *    After  -- the simple jump: the card lands after its old parent,
 *              whole and unsplit, and the story order shifts.
 *
 *  First/last children never ask -- promoting them can preserve order
 *  with plain placement (before/after the parent), so the menu just does
 *  it. Copy uses the BOARD'S OWN tier names, not jargon.
 * ------------------------------------------------------------------ */

export interface PromoteMenuState {
  nodeId: string;
  x: number;
  y: number;
  title: string; // the card being promoted
  tierName: string; // the tier it's promoting TO
  parentTitle: string; // the parent that would split
  parentTierName: string; // that parent's tier, for the copy
  before: number; // siblings ahead of the card
  after: number; // siblings behind it
  childName: string; // what the siblings are called (the card's own tier)
}

let state: PromoteMenuState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const promoteMenu = {
  open(s: PromoteMenuState) {
    state = s;
    emit();
  },
  close() {
    if (!state) return;
    state = null;
    emit();
  },
  get: (): PromoteMenuState | null => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

const NONE = () => null;
export const usePromoteMenu = (): PromoteMenuState | null =>
  useSyncExternalStore(promoteMenu.subscribe, promoteMenu.get, NONE);
