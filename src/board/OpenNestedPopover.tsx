import { useEffect, useRef } from "react";
import { Columns2, SquareArrowOutUpRight } from "lucide-react";
import { useClampToViewport } from "../ui/useClampToViewport";
import { useBoardIndex } from "../state/useBoard";
import { styleName } from "../state/boardStyles";
import { openNested, useOpenNested } from "./openNested";
import type { PaneSlot } from "./paneFocus";

export interface OpenNestedActions {
  /* Put `boardId` in the panel BESIDE `from`, opening a split if there
   * isn't one. Returns what the other panel was showing, or null. */
  beside: (from: PaneSlot, boardId: string) => void;
  /* Replace what `from` is showing. */
  here: (from: PaneSlot, boardId: string) => void;
  /* What the sibling panel currently shows, or null when there is only
   * one panel -- the copy needs it to say what "beside" will replace. */
  siblingBoardId: (from: PaneSlot) => string | null;
  twoUp: boolean;
}

/* Where to open a nested board, asked every time (see openNested.ts for
 * why every time rather than only when it is ambiguous).
 *
 * The two options are the same two words wherever you are; what changes
 * is the line under each, which names what the choice will COST -- the
 * board it replaces, or the notes panel it closes. Rendered once, above
 * the panes, like every other menu that outlives the row that opened it. */
export function OpenNestedPopover({ actions }: { actions: OpenNestedActions }) {
  const ask = useOpenNested();
  const nests = useBoardIndex();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ask) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) openNested.close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openNested.close();
    // opening focuses the first item, which is also what makes Escape and
    // the arrow walk work after a plain double-click (the card menu's rule)
    ref.current?.querySelector<HTMLButtonElement>("button.ctx-item")?.focus();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [ask]);

  const w = 232;
  const { left, top } = useClampToViewport(ref, ask?.x ?? 0, ask?.y ?? 0, { w, h: 118 });

  if (!ask) return null;
  const info = nests.get(ask.boardId);
  const name = info?.title || "Untitled board";
  const sibling = actions.siblingBoardId(ask.from);
  const siblingName = sibling ? nests.get(sibling)?.title || "Untitled board" : null;
  const already = sibling === ask.boardId;

  return (
    <div ref={ref} className="ctx-menu open-nested-menu" style={{ left, top, width: w }}>
      <div className="ctx-title">
        Open {name}
        {info ? <span className="ctx-note-line">{styleName(info.type)}</span> : null}
      </div>
      <button
        className="ctx-item"
        onClick={() => {
          actions.beside(ask.from, ask.boardId);
          openNested.close();
        }}
      >
        <Columns2 size={14} />
        <span className="ctx-stack">
          Open beside
          <span className="ctx-note-line">
            {already
              ? "Already there -- just go to it"
              : siblingName
                ? `Replaces ${siblingName}`
                : "Opens a split view"}
          </span>
        </span>
      </button>
      <button
        className="ctx-item"
        onClick={() => {
          actions.here(ask.from, ask.boardId);
          openNested.close();
        }}
      >
        <SquareArrowOutUpRight size={14} />
        <span className="ctx-stack">
          Open here
          <span className="ctx-note-line">Replaces this panel's board</span>
        </span>
      </button>
    </div>
  );
}
