import type { ReactNode } from "react";
import { useChipReorder } from "./useChipReorder";

/* ------------------------------------------------------------------ *
 *  One legend chip, wrapped so it can be dropped ON.
 *
 *  This is the `.legend-chip` span the rows already used -- it just grew
 *  a drop zone. Everything inside (the swatch button, its gear) is
 *  unchanged, so the click-to-latch, hover-to-highlight and
 *  drag-onto-a-card behaviors all still work exactly as they did.
 *
 *  The marker is drawn in the GAP the drop will land in rather than as a
 *  highlight on the chip you happen to be over -- the same invariant the
 *  board's own drops are moving to: what you can see is where it goes.
 * ------------------------------------------------------------------ */
export function ChipSlot({
  id,
  nextId,
  kind = "tag",
  onReorder,
  children,
}: {
  id: string;
  nextId: string | null; // the chip after this one; null when last
  kind?: "tag" | "color";
  onReorder: (dragId: string, beforeId: string | null) => void;
  children: ReactNode;
}) {
  const { markBefore, markAfter, props } = useChipReorder(kind, id, nextId, onReorder);
  return (
    <span
      className={
        "legend-chip" + (markBefore ? " chip-drop-before" : "") + (markAfter ? " chip-drop-after" : "")
      }
      {...props}
    >
      {children}
    </span>
  );
}
