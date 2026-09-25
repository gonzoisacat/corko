import { useEffect, useRef, useState } from "react";
import { Plus, Settings } from "lucide-react";
import { ops, useBoard, useTags } from "../state/useBoard";
import { useBoardVocab } from "./boardVocab";
import { useBoardUI } from "./context";
import { ChipSlot } from "./ChipSlot";
import { highlightTag, latchTag, releaseLatch, stopHover, useLatchedKey } from "./legendHighlight";
import { legendDrag, LEGEND_DRAG_EFFECT, useLegendDragging } from "./legendDrag";
import { tagPanel } from "./tagPanel";
import { newTags, useNewTags } from "./newTags";
import { TagSwatch } from "./TagSwatch";

/* ------------------------------------------------------------------ *
 *  The Tags row of the legend (ADR 0002).
 *
 *  Three interactions turn a stored tag into a scannable one:
 *   - HOVER a swatch -> every card carrying it stays lit while the rest
 *     of the board dims (legendHighlight.ts does it in CSS),
 *   - CLICK it -> that stays lit until you click again or press Escape,
 *     so you can scroll the board looking for what it hit,
 *   - DRAG a swatch onto a card -> applies it there, drawn at the tag's
 *     own place and size.
 *
 *  A click and a drag share the chip, which the browser already separates
 *  for us: a completed drag fires dragstart/dragend and no click.
 *
 *  The gear opens that tag's floating settings panel (TagPanelPopover);
 *  right-clicking a tab on a card opens the same one. It used to appear
 *  only in the legend's edit mode -- that mode is gone, and this row's
 *  gear-on-hover is the pattern the other two rows now copy.
 * ------------------------------------------------------------------ */

export function TagLegend({ boardId }: { boardId: string }) {
  const all = useTags();
  // the highlight is per COLUMN, so every call here names this one
  const { slot } = useBoardUI();
  const latched = useLatchedKey(slot);
  const board = useBoard(boardId);
  const { tagIds } = useBoardVocab(board);
  const fresh = useNewTags();
  const [menu, setMenu] = useState(false);
  /* A drag is leaving the open menu. The menu must NOT unmount at
   * dragstart -- Chromium cancels a drag whose source element leaves the
   * DOM in the same tick, so `setMenu(false)` there killed every drag the
   * moment it began and the menu items read as inert. Instead the menu
   * stays mounted but visually hidden for the duration (CSS `drag-out`,
   * visibility: hidden -- safe mid-drag where display: none is not), and
   * closes for real on dragend. */
  const [dragOut, setDragOut] = useState(false);
  /* the same guard as the color row's (LegendBar.tsx): a dropped tag's
   * menu item unmounts before its dragend, so the drag STORE ending is
   * what brings the hidden menu back */
  const dragging = useLegendDragging();
  useEffect(() => {
    if (!dragging && dragOut) {
      setDragOut(false);
      setMenu(false);
    }
  }, [dragging, dragOut]);
  const addRef = useRef<HTMLDivElement>(null);

  /* Only the tags this board actually uses. The vocabulary is project-wide
   * (ADR 0002) so a card keeps its meaning when it moves boards -- but the
   * legend is a SCANNING surface, and a tag no card here carries is a mark
   * you will never find. The rest are one click away on the add button. */
  /* ...plus anything made in this session that no card carries yet, or
   * "+ Add tag" adds one you cannot see (board/newTags.ts). */
  const shows = (t: { id: string }) => tagIds.has(t.id) || fresh.has(t.id);
  const tags = all.filter(shows);
  const elsewhere = all.filter((t) => !shows(t));

  // never leave the board dimmed behind an unmounted swatch
  useEffect(() => () => {
    highlightTag(slot, null);
    releaseLatch(slot);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!addRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  return (
    <div className="legend-row">
      <span className="legend-group mono">Tags/Splits</span>
      {/* own box so a wrapped row indents past the label column -- see the
          note on LegendBar's rows */}
      <div className="legend-chips">
      {tags.map((t, i) => {
        const held = latched === "tag:" + t.id;
        return (
          <ChipSlot
            key={t.id}
            id={t.id}
            nextId={tags[i + 1]?.id ?? null}
            onReorder={(dragId, beforeId) => ops.reorderTag(dragId, beforeId)}
          >
            <button
              type="button"
              className={"legend-item tag-chip" + (held ? " held" : "")}
              aria-pressed={held}
              draggable
              aria-label={t.name || "Untitled tag"}
              data-tip={held ? "Release" : "Highlight"}
              onMouseEnter={() => highlightTag(slot, t.id)}
              onMouseLeave={() => highlightTag(slot, null)}
              onClick={() => latchTag(slot, t.id)}
              onDragStart={(e) => {
                legendDrag.start("tag", t.id);
                highlightTag(slot, null);
                e.dataTransfer.effectAllowed = LEGEND_DRAG_EFFECT;
                // some browsers cancel a drag with no payload
                e.dataTransfer.setData("text/plain", t.id);
              }}
              onDragEnd={() => legendDrag.end()}
            >
              <TagSwatch tag={t} />
              {t.name || <em className="legend-unnamed">unnamed</em>}
            </button>
            <button
              className="legend-gear"
              aria-label="Tag settings" data-tip="Tag settings"
              onClick={(e) => {
                // open beside the swatch, not over the board
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                stopHover(slot); // editing it, not scanning for it
                tagPanel.open(t.id, r.left, r.bottom + 6, undefined, boardId);
              }}
            >
              <Settings size={11} />
            </button>
          </ChipSlot>
        );
      })}
      {/* The add button is also the door to the rest of the project's tags,
          since the row above only shows the ones this board uses. Opening
          a panel drops the hover (stopHover): adding grows the row, which
          slides this button out from under the cursor and drops it on the
          chip just created -- whose hover would then dim the whole board,
          because no card carries a brand-new tag. */}
      <div className="legend-add-wrap" ref={addRef}>
        <button
          className={"legend-add" + (menu ? " active" : "")}
          data-tip="Add tag"
          onClick={() => {
            stopHover(slot);
            // nothing else to offer -> skip the menu and just make one
            if (!elsewhere.length) {
              const r = addRef.current!.getBoundingClientRect();
              const id = ops.addTag({ name: "" });
              newTags.add(id); // ...so the chip actually shows up
              tagPanel.open(id, r.left, r.bottom + 6, undefined, boardId);
              return;
            }
            setMenu((v) => !v);
          }}
        >
          <Plus size={12} /> Add tag
        </button>
        {menu && (
          <div className={"legend-add-menu" + (dragOut ? " drag-out" : "")}>
            <button
              className="legend-add-menu-new"
              onClick={() => {
                setMenu(false);
                const r = addRef.current!.getBoundingClientRect();
                const id = ops.addTag({ name: "" });
                newTags.add(id);
                tagPanel.open(id, r.left, r.bottom + 6, undefined, boardId);
              }}
            >
              <Plus size={12} /> New tag...
            </button>
            <div className="legend-add-menu-head mono">Elsewhere in this project</div>
            {/* Draggable, exactly like a legend chip -- drop one on a card
                and it starts appearing in the row above, because it is then
                a tag this board uses. No separate "enable" step. */}
            {elsewhere.map((t) => (
              <span
                key={t.id}
                className="legend-add-menu-item"
                draggable
                title={`${t.name || "Untitled tag"} -- drag onto a card to apply it here`}
                onDragStart={(e) => {
                  legendDrag.start("tag", t.id);
                  e.dataTransfer.effectAllowed = LEGEND_DRAG_EFFECT;
                  e.dataTransfer.setData("text/plain", t.id);
                  /* Hide on the NEXT tick, not in this handler. Chromium
                   * captures the drag image and commits the drag session
                   * after dragstart returns; a source that is already
                   * invisible by then cancels the drag exactly like an
                   * unmounted one. The deferred hide lands right after the
                   * session is real, which is the classic drag-source-hiding
                   * dance. */
                  window.setTimeout(() => setDragOut(true), 0);
                }}
                onDragEnd={() => {
                  legendDrag.end();
                  setDragOut(false);
                  setMenu(false); // NOW it can go -- the drag is over
                }}
              >
                <TagSwatch tag={t} />
                {t.name || <em className="legend-unnamed">unnamed</em>}
              </span>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
