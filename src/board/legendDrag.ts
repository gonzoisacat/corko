import { useEffect, useState, useSyncExternalStore } from "react";
import type { DragEvent } from "react";
import { ops } from "../state/useBoard";
import { selection } from "./selection";

/* ------------------------------------------------------------------ *
 *  Dragging something out of the LEGEND onto a card.
 *
 *  Started as tags only (ADR 0002); colors joined in 2026-08-03, the
 *  same widening `legendHighlight` went through when hovering a color
 *  swatch started lighting its cards. One channel, because from a drop
 *  zone's point of view they are the same gesture -- something from the
 *  legend, landing on a card, applying to any tier.
 *
 *  Deliberately NOT board/drag.ts: that one carries a NODE being
 *  relocated, and every drop zone on the board is built to reject
 *  anything whose tier doesn't match. A tag or a color drops on any
 *  card at any tier, so it gets its own channel and the card drop zones
 *  simply ignore it.
 * ------------------------------------------------------------------ */

/* WHAT THE BROWSER IS ALLOWED TO DO WITH A CHIP IN FLIGHT, and it must
 * permit BOTH -- because the chip means two things and only the target
 * decides which: dropped on a CARD it applies the tag (a copy), dropped
 * on a sibling CHIP it reorders the row (a move).
 *
 * It said "copy" until 2026-08-05, and reordering silently did nothing
 * (owner-reported: "i see a preview line, but when i try to drop it,
 * nothing moves"). HTML5 drag-and-drop negotiates the two ends: when the
 * dropEffect a target asks for is not permitted by the source's
 * effectAllowed, the browser resets it to "none" and NEVER FIRES `drop`.
 * dragover still accepts, so the marker draws and the release does
 * nothing -- the handler, the op and the arithmetic are all fine and
 * never run. Nothing errors.
 *
 * The tell was that dropping a chip on a card had always worked: that
 * path asks for "copy", which the old value permitted. Only the "move"
 * path -- reordering -- was refused.
 *
 * Same family as the drop-catcher rule in board/dropCatcher.ts: a drag
 * gesture can be defeated by a protocol detail with no error and a
 * working-looking preview. Suspect the negotiation before the logic. */
export const LEGEND_DRAG_EFFECT = "copyMove";

export interface LegendDragItem {
  kind: "tag" | "color";
  id: string;
}

let current: LegendDragItem | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const legendDrag = {
  get: (): LegendDragItem | null => current,
  start(kind: LegendDragItem["kind"], id: string) {
    current = { kind, id };
    emit();
  },
  end() {
    if (current === null) return;
    current = null;
    emit();
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/* Whether a legend chip is in flight -- cards use it to offer themselves
 * as targets (and to know a plain node-drag isn't what's happening). */
export function useLegendDragging(): boolean {
  return useSyncExternalStore(
    legendDrag.subscribe,
    () => current !== null,
    () => false,
  );
}

/* LAND THE CHIP -- the one statement of what a legend drop DOES, shared
 * by every surface that accepts one (useDropZone's cards, the grid's
 * own hook below, the kanban head through useDropZone). Extracted
 * 2026-08-29 when the Free Grid turned out to accept no chip at all:
 * two copies of the apply rule is how the next surface drifts.
 *
 * Dropping onto a card that is part of the SELECTION applies to the
 * whole selection -- the same rule the card menu's Cut and Remove-tags
 * follow. Onto an unselected card it is just that one.
 *
 * Returns whether a chip was actually in flight, so a caller can fall
 * through to its node-drag handling when this was not a legend drop. */
export function dropChip(targetId: string): boolean {
  if (!current) return false;
  const chip = current;
  const targets =
    selection.has(targetId) && selection.size() > 1 ? selection.ids() : [targetId];
  if (chip.kind === "color") ops.setNodesColor(targets, chip.id);
  else ops.setNodeTag(targets, chip.id, true);
  legendDrag.end();
  return true;
}

/* A LEGEND-DROP TARGET for surfaces that do not use board/drag.ts's
 * useDropZone -- built for the Free Grid, whose gestures are pointer
 * events and which therefore had no HTML5 drop handlers at all: a chip
 * dragged onto a grid card simply never landed (owner-reported
 * 2026-08-29, "tags don't seem to apply to cards in free grid").
 * Deliberately the same accept/highlight shape as useDropZone's legend
 * half, without any of the node-drag machinery a grid has no use for. */
export function useLegendDrop(targetId: string): {
  over: boolean;
  props: {
    onDragOver: (e: DragEvent) => void;
    onDragEnter: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
} {
  const [over, setOver] = useState(false);
  /* a drag ending elsewhere never fires this element's dragleave */
  useEffect(
    () =>
      legendDrag.subscribe(() => {
        if (!current) setOver(false);
      }),
    [],
  );
  return {
    over,
    props: {
      onDragOver: (e) => {
        if (!current) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!over) setOver(true);
      },
      onDragEnter: (e) => {
        if (!current) return;
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: (e) => {
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        setOver(false);
      },
      onDrop: (e) => {
        if (!current) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        dropChip(targetId);
      },
    },
  };
}
