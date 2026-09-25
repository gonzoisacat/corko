import { useEffect, useRef } from "react";
import { Plus, Layers, ClipboardPaste } from "lucide-react";
import { useClampToViewport } from "../../ui/useClampToViewport";
import { ops, useBoard } from "../../state/useBoard";
import { getSnapshot } from "../../state/ydoc";
import { DEFAULT_SPAN, clampCell } from "../../state/gridBoard";
import { clipboard, usePasteCount } from "../clipboard";
import { nestPicker } from "../nestPicker";
import { openNew } from "../autoEdit";
import { canvasMenu, useCanvasMenu } from "./canvasMenu";

/* ------------------------------------------------------------------ *
 *  WHAT THE BARE CORK OFFERS (board/grid/canvasMenu.ts says why it is a
 *  menu at all).
 *
 *  Three items, and two of them are the point of doing this as a menu
 *  rather than as a button. "Add nested board" took two steps before --
 *  add a card, then convert it -- for the thing this board type exists
 *  to hang other boards off. And PASTE was keyboard-only: on a grid,
 *  pasting AT a position is more meaningful than anywhere else in the
 *  app, and nothing offered it.
 * ------------------------------------------------------------------ */

/* Where a run of pasted cards lands, laid left to right from the point
 * you clicked and wrapping -- the same shape as `placedCell`'s parking,
 * so a paste reads in its own order rather than stacking on one spot. */
const PASTE_COLS = 4;
const pasteCell = (from: { x: number; y: number }, i: number) => ({
  x: from.x + (i % PASTE_COLS) * (DEFAULT_SPAN.w + 1),
  y: from.y + Math.floor(i / PASTE_COLS) * (DEFAULT_SPAN.h + 1),
});

export function CanvasMenuPopover() {
  const menu = useCanvasMenu();
  const board = useBoard(menu?.boardId ?? "");
  /* A grid ships a ONE-rung ladder, so its cards sit at role height 0 --
   * the same rung a beat pastes into. That is what lets a run of beats
   * cut from a Beat Map land here as cards. */
  const pasteCount = usePasteCount(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) canvasMenu.close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && canvasMenu.close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const w = 196;
  const { left, top } = useClampToViewport(ref, menu?.x ?? 0, menu?.y ?? 0, { w, h: 108 });
  if (!menu || !board) return null;

  /* A card at the clicked cell, opened straight into edit -- what the
   * ghost's `+` did. Returns the id so the nesting item can build on it. */
  const addHere = (): string => {
    const id = ops.addRoot(menu.boardId);
    if (id) ops.setNodeCells({ [id]: clampCell(menu.cell) });
    return id;
  };

  return (
    <div ref={ref} className="ctx-menu canvas-menu" style={{ left, top, width: w }}>
      <button
        className="ctx-item"
        onClick={() => {
          const id = addHere();
          canvasMenu.close();
          if (id) openNew(id);
        }}
      >
        <Plus size={14} /> Add card here
      </button>

      <button
        className="ctx-item"
        onClick={() => {
          canvasMenu.close();
          /* NO CARD YET. The picker hands back the board you chose
           * (`onPick`) and the card is minted only then, so backing out
           * leaves nothing behind. Minting first and cleaning up on
           * cancel cannot be made correct: `link` closes the picker
           * before it nests, and "New board..." goes on to open the
           * template picker, so close-detection either fires too early
           * or has to know two other stores' timing. */
          nestPicker.open({
            mode: "pick",
            nodeId: "", // unused: onPick owns what happens
            boardId: menu.boardId,
            childCount: 0, // nothing exists yet, so nothing to warn about
            targetId: "",
            x: menu.x,
            y: menu.y,
            onPick: (targetId) => {
              const id = addHere();
              if (id) ops.nestNode(id, targetId);
            },
          });
        }}
      >
        <Layers size={14} /> Add nested board here...
      </button>

      <button
        className="ctx-item"
        disabled={!pasteCount}
        onClick={() => {
          canvasMenu.close();
          /* insertNodes does not report the ids it minted, so diff the
           * ROOT SET rather than trusting an index -- immune to where
           * they landed and to anything else touching the board. */
          const before = new Set(board.roots.map((n) => n.id));
          clipboard.paste(null, board.roots.length, 0, menu.boardId);
          const fresh = (
            getSnapshot().boards.find((b) => b.id === menu.boardId)?.roots ?? []
          ).filter((n) => !before.has(n.id));
          if (!fresh.length) return;
          const cells: Record<string, { x: number; y: number }> = {};
          fresh.forEach((n, i) => (cells[n.id] = clampCell(pasteCell(menu.cell, i))));
          ops.setNodeCells(cells);
        }}
      >
        <ClipboardPaste size={14} />{" "}
        {pasteCount ? `Paste ${pasteCount} card${pasteCount === 1 ? "" : "s"} here` : "Nothing to paste"}
      </button>
    </div>
  );
}
