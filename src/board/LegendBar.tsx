import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Settings, X } from "lucide-react";
import { ops } from "../state/useBoard";
import { setSetting, useSettings } from "../state/settings";
import type { Board, LegendEntry } from "../state/types";
import { highlightColor, latchColor, releaseLatch, stopHover, useLatchedKey } from "./legendHighlight";
import { legendPanel } from "./legendPanel";
import { TagLegend } from "./TagLegend";
import { ChipSlot } from "./ChipSlot";
import { legendDrag, LEGEND_DRAG_EFFECT, useLegendDragging } from "./legendDrag";
import { DrivingWheel, type DrivingInfo } from "./DrivingWheel";
import { OverridesMenu } from "./OverridesMenu";
import { NoteDotsToggle } from "./NoteDotsToggle";
import { CardImagesToggle } from "./CardImagesToggle";
import { useBoardUI } from "./context";
import { useBoardVocab } from "./boardVocab";
import { newColors, useNewColors } from "./newColors";

/* The legend, frozen at the top of a pane. Three rows, in the order a
 * board is actually built: the tier **Default Tier Colors**, the free
 * **Color Overrides** that a card can be painted with instead, then
 * the project's **Tags**.
 *
 * Two things every chip does, on every row:
 *
 *  - HOVER lights every card it applies to and dims the rest, and CLICK
 *    latches that so it survives scrolling (board/legendHighlight.ts).
 *    The legend IS the board's filter rather than a separate filter UI
 *    beside it -- a tier-default swatch lights the cards merely
 *    INHERITING it, not just the ones that name it (colors.ts
 *    resolveNodeColorId).
 *  - HOVER also exposes that chip's gear, which opens its settings.
 *
 * That second one replaced a master edit/done toggle for the whole
 * legend. The toggle was a mode you had to remember to leave, and it
 * gated three different kinds of editing behind one switch; the Tags row
 * already had per-chip gears, so this is that row's behavior applied to
 * the other two rather than a new idiom. What each gear opens differs
 * because the rows differ: a tier default swatch IS a tier's fill color,
 * so it opens the tier's whole look; an override is one color, so it
 * opens its name and color.
 *
 * Colors are per BOARD (so split panes on different boards each show
 * their own); tags are per PROJECT. Both are shared, synced data. */
export function LegendBar({
  board,
  driving,
  connections,
}: {
  board: Board;
  driving?: DrivingInfo;
  /* CONNECTIONS MODE (owner, 2026-08-29): a Free Grid's follow-the-string
   * toggle, living in the legend's bottom-right under the driving wheel
   * -- his placement. Null on every other board type: only a grid has
   * strings, so elsewhere this is not a disabled control, it is a
   * question the board cannot ask (the Furl-vs-zoom slot rule). */
  connections?: { on: boolean; onToggle: (v: boolean) => void } | null;
}) {
  const legend = board.legend;
  // the highlight is per PANEL, so every call here names this one
  const { slot } = useBoardUI();
  /* ROLLED UP (owner, 2026-09-04): "it gets a chevron and when
   * collapsed, it rolls up the colors and tags. The steering wheel on
   * the right side stays on screen, as does the Connections Mode button
   * on Free Grid (they just move closer together)". Per board, per
   * browser, like the rest of the look (state/settings.ts). */
  const collapsed = useSettings(board.id).legendCollapsed;
  const latched = useLatchedKey(slot);
  /* The Defaults row is the tier ladder, and ONLY that (owner,
   * 2026-08-24). The nesting-card fill moved down to Color Overrides:
   * the top row is the LADDER, and a swatch in it that names no rung
   * reads as one -- while the overrides row is already "the colors that
   * are not a tier", which is exactly what it is. It still RESOLVES as a
   * default (colors.ts `resolveNodeEntry`); only the row it is shown in
   * changed. */
  const defaults = legend.filter((e) => e.tier);
  /* THE OVERRIDES ROW SHOWS WHAT THIS BOARD WEARS (ADR 0006). Overrides
   * are the project's now, and the projected legend carries all of them;
   * the row shows the ones a card here names, plus any made this session
   * (board/newColors.ts, so "+ Add" visibly adds), and the nesting fill
   * last -- a default, not a member. The rest wait behind the add
   * button as "elsewhere in this project", exactly like tags. */
  const vocab = useBoardVocab(board);
  const fresh = useNewColors(board.id);
  const options = legend.filter((e) => !e.tier && !e.role);
  const shown = options.filter((e) => vocab.colorIds.has(e.id) || fresh.has(e.id));
  const elsewhere = options.filter((e) => !vocab.colorIds.has(e.id) && !fresh.has(e.id));
  const overrides = [...shown, ...legend.filter((e) => !e.tier && e.role)];
  const [menu, setMenu] = useState(false);
  const [dragOut, setDragOut] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  /* THE MENU THAT WOULD NOT COME BACK (owner, 2026-09-08: after dropping
   * an "elsewhere" color on a card, "+ Add stopped working on me"). The
   * drop puts that color in the row above, so its menu item UNMOUNTS
   * before its dragend can fire -- and dragend on a removed element
   * never fires -- leaving `dragOut` true and the menu hidden by
   * visibility every time it opened after. The drag STORE does end
   * (dropChip calls legendDrag.end), so it is the signal: when the drag
   * is over and the menu is still hidden for it, show it and close it. */
  const dragging = useLegendDragging();
  useEffect(() => {
    if (!dragging && dragOut) {
      setDragOut(false);
      setMenu(false);
    }
  }, [dragging, dragOut]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (ev: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(ev.target as HTMLElement)) setMenu(false);
    };
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && setMenu(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  const addColor = () => {
    const r = addRef.current!.getBoundingClientRect();
    const id = ops.addLegendEntry(board.id);
    if (!id) return;
    newColors.add(board.id, id); // ...so the chip actually shows up, HERE
    legendPanel.openEntry(board.id, id, r.left, r.bottom + 6);
  };

  // never leave the board dimmed behind an unmounted swatch (a pane
  // closing, a board switch) -- the injected rule outlives this component,
  // and a latch names an entry this board may not even have
  useEffect(() => () => {
    highlightColor(slot, null);
    releaseLatch(slot);
  }, []);

  /* Only the OVERRIDES row reorders. The tier-defaults row IS the tier
   * ladder's order (Board.structure), so letting a swatch slide within it
   * would either lie about the ladder or silently re-tier the board. */
  const chip = (e: LegendEntry, kind: "tier" | "role" | "entry", nextId: string | null = null) => {
    const held = latched === "color:" + e.id;
    const inner = (
      <>
        <button
          type="button"
          className={"legend-item" + (held ? " held" : "")}
          aria-pressed={held}
          /* ...and DRAG it onto a card to paint it (onto one of a
             selection to paint them all) -- the same gesture the tag
             chips have always had, on the same channel. */
          draggable
          aria-label={e.label || "Untitled"}
          data-tip={held ? "Release" : "Highlight"}
          onMouseEnter={() => highlightColor(slot, e.id)}
          onMouseLeave={() => highlightColor(slot, null)}
          onClick={() => latchColor(slot, e.id)}
          onDragStart={(ev) => {
            legendDrag.start("color", e.id);
            highlightColor(slot, null); // the board dims under a drag otherwise
            ev.dataTransfer.effectAllowed = LEGEND_DRAG_EFFECT;
            ev.dataTransfer.setData("text/plain", e.id);
          }}
          onDragEnd={() => legendDrag.end()}
        >
          <span className="legend-swatch" style={{ background: e.bg, borderColor: e.border }} />
          {e.label || <em className="legend-unnamed">untitled</em>}
        </button>
        <button
          className="legend-gear"
          aria-label={kind === "tier" ? `${e.label || "Tier"} settings` : "Color settings"} data-tip={kind === "tier" ? `${e.label || "Tier"} settings` : "Color settings"}
          onClick={(ev) => {
            // open beside the chip, not over the board
            const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
            stopHover(slot); // editing it, not scanning for it
            /* A tier swatch IS that tier's fill, so its gear opens the
               tier's whole look. The nested one has no tier behind it --
               there is no name, font or height to set -- so it opens the
               plain color panel, like an override. */
            if (kind === "tier") legendPanel.openTier(board.id, e.tier!, r.left, r.bottom + 6);
            else legendPanel.openEntry(board.id, e.id, r.left, r.bottom + 6);
          }}
        >
          <Settings size={11} />
        </button>
      </>
    );
    /* Neither of these reorders. The tier row IS the ladder's order, and
       the nested default belongs to no order at all -- only the OVERRIDES
       row is a sequence you can rearrange (it sets tag paint order). */
    if (kind !== "entry") {
      return (
        <span key={e.id} className="legend-chip">
          {inner}
        </span>
      );
    }
    return (
      <ChipSlot
        key={e.id}
        id={e.id}
        nextId={nextId}
        kind="color"
        onReorder={(dragId, beforeId) => ops.reorderLegendEntry(board.id, dragId, beforeId)}
      >
        {inner}
      </ChipSlot>
    );
  };

  const connectionsSwitch = connections && (
    <label className={"legend-connections" + (collapsed ? " inline" : "")}>
      Connections mode
      <button
        type="button"
        role="switch"
        aria-checked={connections.on}
        aria-label="Connections mode"
        className="legend-connections-btn"
        onClick={() => connections.onToggle(!connections.on)}
      >
        <span className={"driving-switch" + (connections.on ? " on" : "")} />
      </button>
    </label>
  );

  return (
    <div className={"legend" + (collapsed ? " collapsed" : "")}>
      <div className="legend-head">
        <button
          className="legend-fold"
          aria-label={collapsed ? "Expand the legend" : "Collapse the legend"}
          data-tip={collapsed ? "Expand legend" : "Collapse legend"}
          aria-expanded={!collapsed}
          onClick={() => setSetting(board.id, "legendCollapsed", !collapsed)}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <span className="legend-title">LEGEND</span>
        {/* only shown when something is held, so the way out is visible
            without a permanently parked button. Escape does it too. */}
        {latched && (
          <button className="legend-clear" data-tip="Release (Esc)" onClick={() => releaseLatch(slot)}>
            <X size={11} /> clear highlight
          </button>
        )}
        {/* right-justified on this row (margin-left: auto), so it sits in
            the legend's top-right corner whether or not the clear button
            is showing. Rolled up, Connections mode moves up beside it. */}
        {collapsed && connectionsSwitch}
        {/* the card images' switch, first in the corner group (his,
            2026-09-08); board/CardImagesToggle.tsx */}
        <CardImagesToggle boardId={board.id} />
        {/* the note dots' switch, beside the Overrides door by his
            placement (2026-09-07); board/NoteDotsToggle.tsx */}
        <NoteDotsToggle boardId={board.id} />
        {/* YOUR OVERRIDES of what the board owns (its backdrop, today),
            beside the wheel by the owner's placement; board/OverridesMenu.tsx */}
        <OverridesMenu boardId={board.id} />
        <DrivingWheel
          slot={slot}
          driving={
            driving ?? { twoUp: false, sameBoard: false, on: false, driver: "active" }
          }
        />
      </div>
      {!collapsed && (
      <>
      {/* The chips live in their own box rather than as siblings of the
          label, so a row that wraps indents its later lines past the label
          column instead of running back under it. The three group labels
          are then the only thing ever in that column, which is what makes
          the legend readable once a vocabulary outgrows one line. */}
      <div className="legend-row">
        <span className="legend-group mono">Default Tier Colors</span>
        <div className="legend-chips">{defaults.map((e) => chip(e, "tier"))}</div>
      </div>
      <div className="legend-row">
        <span className="legend-group mono">Color Overrides</span>
        <div className="legend-chips">
          {overrides.map((e, i) =>
            /* The nesting fill rides in this row but is not one of its
               members: it is a DEFAULT, so it does not reorder and it
               has no Remove (the panel hides it). */
            chip(e, e.role ? "role" : "entry", overrides[i + 1]?.id ?? null),
          )}
          {/* Adding used to be edit-mode-only. With the mode gone it lives
              here permanently, and opens the new entry's panel straight away
              so it can be named -- minting an unnamed swatch you then have
              to go and find is how the legend collects blanks. And since
              ADR 0006 it is also the door to the rest of the project's
              overrides, as the tag row's add button is to its tags. */}
          <div className="legend-add-wrap" ref={addRef}>
            <button
              className={"legend-add" + (menu ? " active" : "")}
              data-tip="Add color"
              onClick={() => {
                stopHover(slot); // see the note on TagLegend's add button
                if (!elsewhere.length) {
                  addColor();
                  return;
                }
                setMenu((v) => !v);
              }}
            >
              <Plus size={12} /> Add
            </button>
            {menu && (
              <div className={"legend-add-menu" + (dragOut ? " drag-out" : "")}>
                <button
                  className="legend-add-menu-new"
                  onClick={() => {
                    setMenu(false);
                    addColor();
                  }}
                >
                  <Plus size={12} /> New color...
                </button>
                <div className="legend-add-menu-head mono">Elsewhere in this project</div>
                {/* Draggable like a chip: drop one on a card and it joins the
                    row above, because it is then a color this board wears. */}
                {elsewhere.map((e) => (
                  <span
                    key={e.id}
                    className="legend-add-menu-item"
                    draggable
                    title={`${e.label || "Untitled color"} -- drag onto a card to use it here`}
                    onDragStart={(ev) => {
                      legendDrag.start("color", e.id);
                      ev.dataTransfer.effectAllowed = LEGEND_DRAG_EFFECT;
                      ev.dataTransfer.setData("text/plain", e.id);
                      window.setTimeout(() => setDragOut(true), 0); // the TagLegend dance
                    }}
                    onDragEnd={() => {
                      legendDrag.end();
                      setDragOut(false);
                      setMenu(false);
                    }}
                  >
                    <span className="legend-swatch" style={{ background: e.bg, borderColor: e.border }} />
                    {e.label || <em className="legend-unnamed">untitled</em>}
                  </span>
                ))}
              </div>
            )}
          </div>
          {/* What this row IS FOR, on a board that has not used it yet
              (owner, 2026-08-24: it goes "as soon as the +Add button is
              used the first time"). DERIVED from the row's contents
              rather than latched on a first click -- it explains an
              empty row, so it is wanted exactly while the row is empty,
              and a board that later clears every override wants the
              sentence back rather than a flag saying it once knew.

              The nesting fill does not count: it is a default nobody
              added, so a row holding only that one is still a row
              nobody has used.

              The break is FORCED rather than left to a width:
              `white-space: pre-line` is how the board picker keeps a
              parenthetical whole on its own line, and a width tuned to
              break in the right place stops being true the moment the
              type or the wording moves. The accent is escaped so this
              file stays ASCII (the project convention) while the word
              renders correctly. */}
          {!overrides.some((e) => !e.role) && (
            <span className="legend-hint">
              {"Define full card color overrides\n(i.e. B-roll, Archival, Interview, Verit\u00e9 etc...)"}
            </span>
          )}
        </div>
      </div>
      <TagLegend boardId={board.id} />
      {/* Bottom-justified under the wheel (owner's placement): label and
          a switch, nothing else. The switch is `.driving-switch` -- the
          app has ONE switch look, and this borrows it rather than
          minting a second. role=switch so it announces as the toggle it
          is; the label is the accessible name via the wrapping label. */}
      {connectionsSwitch}
      </>
      )}
    </div>
  );
}
