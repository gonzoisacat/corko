import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ *
 *  The Demotion dialog's state (owner's design, settled 2026-08-02).
 *  Graduation is RARE, so the card menu carries exactly one entry --
 *  "Demote to <tier>..." -- and every choice lives here in the popup:
 *
 *    WHERE   -- into the neighbouring sibling, or into a new untitled
 *               container minted where the node stood (the only option
 *               when there is no neighbour). Both preserve reading order.
 *    LEAVES  -- when leaf content would be displaced: stow it (dormant
 *               below-leaf children; promote brings it back) or delete.
 *
 *  A demote with NOTHING to decide (only child, nothing displaced) never
 *  opens the popup at all.
 * ------------------------------------------------------------------ */

export interface DemoteMenuState {
  nodeId: string;
  x: number;
  y: number;
  title: string; // the node's title, for the header
  tierName: string; // the tier it demotes TO
  childName: string; // the node's OWN tier (what the new container would be)
  leafName: string; // the displaced things' tier name, pluralized in copy
  count: number; // how many leaf-tier (and deeper) nodes are displaced
  neighborTitle: string | null; // null = no neighbour (wrap is the only WHERE)
  neighborDir: "previous" | "next";
}

let state: DemoteMenuState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const demoteMenu = {
  open(s: DemoteMenuState) {
    state = s;
    emit();
  },
  close() {
    if (!state) return;
    state = null;
    emit();
  },
  get: (): DemoteMenuState | null => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

const NONE = () => null;
export const useDemoteMenu = (): DemoteMenuState | null =>
  useSyncExternalStore(demoteMenu.subscribe, demoteMenu.get, NONE);
