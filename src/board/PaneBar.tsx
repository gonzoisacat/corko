import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronsDownUp, Frame, Keyboard, LayoutGrid, Moon, Rows3, Sun } from "lucide-react";
import { keysPanel } from "./keysPanel";
import { setSetting, useSettings } from "../state/settings";
import { fold } from "../state/fold";
import { anchorSliderZoom } from "./useWheelZoom";
import type { Board } from "../state/types";
import { BoardsMenu } from "./BoardsMenu";
import { ZOOM_FACTOR_MAX, ZOOM_FACTOR_MIN } from "./useWheelZoom";
import { OptionsMenu } from "./OptionsMenu";
import { StatsMenu } from "./StatsMenu";
import { SearchMenu, type SearchMenuProps } from "./SearchMenu";
import type { PaneView } from "./BoardPane";

/* ------------------------------------------------------------------ *
 *  A pane's own control row: which board it shows, Detail vs
 *  Overview, that board's stats + options, and (in detail) the
 *  Furl/Unfurl menu. Everything here is per PANE -- the split view gives
 *  each panel its own bar -- so it lives below the app topbar, which
 *  keeps only project-wide controls (undo, presence, the project title).
 *
 *  SEARCH lives here as of 2026-08-03 (owner's call). It was in the topbar
 *  and read as project-wide, which it never was -- one query applied to
 *  whichever boards happened to be on screen, never a search ACROSS the
 *  project. And in practice find is used as a flexible tag filter, so the
 *  thing you actually want from a split view is two DIFFERENT filters at
 *  once: this board's scenes about the fire, that board's about the
 *  hearing. Same rule the legend highlight moved to on the same day -- a
 *  filter belongs to a view, not to the document. Applying one query to
 *  both panels costs a retype, which is cheap; the reverse was
 *  impossible.
 *
 *  Furl/unfurl is detail-only (the Overview never folds). One
 *  "Furl/Unfurl to <tier>" dropdown lists the whole ladder and routes to
 *  fold.foldToTier: a lane is collapsed iff its depth >= the picked
 *  level, so foldTo(0) is fully furled and foldTo(leaf) fully unfurled --
 *  furl and unfurl are the same operation from opposite ends. Fold state
 *  is per-user (state/fold.ts) and SHARED between panes: folding in one
 *  panel folds the same board in the other.
 * ------------------------------------------------------------------ */

/* WHAT THIS BOARD CALLS ITS TWO VIEW MODES (owner, 2026-08-16).
 *
 * A CUT board's modes are different representations of the board -- real
 * cards against cheap color proxies -- so "Detail" and "Overview" say
 * something true about each.
 *
 * A KANBAN board draws the identical cards in both, and the only thing
 * that changes is who decides the SCALE: "Fixed" is the sizes you set on
 * the tiers, "Fit" is the pane sizing the whole board to itself. Calling
 * that Detail/Overview would borrow a distinction this type does not
 * have. FIT IS ITS DEFAULT (App.selectBoard) -- a kanban board is meant
 * to be taken in at a glance, and the cut board's reason for defaulting
 * to detail (mounting a 2.5k-beat Overview used to wedge the tab) does
 * not apply to a type whose two modes are the same DOM under one
 * transform. */
export function viewName(board: Board | null, view: PaneView): string {
  /* Every type but the Beat Map draws the SAME cards either way and
   * differs only in who decides the scale, you or the pane -- so they
   * say Fixed / Fit. The Beat Map's two modes are different
   * REPRESENTATIONS (real cards against color proxies), which is what
   * earns Detail / Overview. */
  /* A typed board has one surface now (2026-09-04); the menu that asked
   * this is not drawn for it, but the name stays honest if asked. */
  if (board?.type) return "Board";
  return view === "overview" ? "Overview" : "Detail";
}

export function PaneBar({
  board,
  view,
  onView,
  onSelectBoard,
  search,
}: {
  board: Board | null;
  view: PaneView;
  onView: (v: PaneView) => void;
  onSelectBoard: (id: string) => void;
  /* Everything the search box and its menu need, bundled: the PANE owns
   * the state (query, match case, the match set's actions); this bar just
   * draws it. */
  search: Omit<SearchMenuProps, "board">;
}) {
  return (
    <div className="pane-bar">
      {/* the switcher names the board; renaming it lives in that menu
          (pencil per row), so there's no separate title field here */}
      {/* Named like the project above it (owner, 2026-09-04). A touch
          larger than "PROJECT NAME:" so, with two fewer letters, it runs
          a hair longer and the board's dropdown sits just right of the
          project's. */}
      <span className="pane-bar-label mono board-name-label">Board name:</span>
      <BoardsMenu activeBoardId={board?.id ?? null} onSelect={onSelectBoard} />
      {/* Names the view you ARE in, not the one you'd switch to -- as a
          dropdown, so the caret says "pick one" rather than "toggle".

          THE NAMES ARE THE BOARD TYPE'S (owner, 2026-08-16). On a cut
          board the two modes really are different REPRESENTATIONS --
          real cards against color proxies -- so Detail / Overview
          earns its keep. A kanban board draws the identical cards
          either way and the only thing that changes is who decides the
          SCALE, you or the pane, so it says Fixed / Fit. Two things
          that differ shouldn't share a name; the panel-vs-column
          rename is the same argument. */}
      {/* A TYPED board (grid, Columns) has ONE surface with a zoom level,
          so no Board View (owner, 2026-09-04); the Beat Map keeps Detail
          and Overview, which really are two drawings. */}
      {!board?.type && (
        <>
      <span className="pane-bar-label">Board View:</span>
      <BarMenu
        label={viewName(board, view)}
        icon={view === "overview" ? <LayoutGrid size={14} /> : <Rows3 size={14} />}
        items={[
          { key: "detail", name: viewName(board, "detail") },
          { key: "overview", name: viewName(board, "overview") },
        ]}
        active={view}
        onPick={(key) => onView(key as PaneView)}
      />
        </>
      )}
      {/* THE VIEW'S OWN CONTROL, one slot, whichever type is showing.
          A Beat Map's is Furl/Unfurl; a Columns board's is a zoom,
          because folding is a detail-view RENDERING rule that type
          ignores entirely -- the menu sat there inert until now
          (owner, 2026-08-24). Both answer the same question, "how am I
          looking at this board", so they share the place. */}
      {board && view === "detail" && !board.type && (
        <BarMenu
          className="furl-menu"
          label="Furl/Unfurl to"
          icon={<ChevronsDownUp size={14} />}
          items={board.levels.map((l, i) => ({ key: String(i), name: l.name }))}
          onPick={(key) => fold.foldToTier(board, Number(key))}
        />
      )}
      {/* No icon: this control replaces a 90px menu in a bar that already
          wraps at a narrow split, and the % readout says what it is more
          directly than a magnifier would. */}
      {/* THE ZOOM AND THE FRAME are not in the bar for either typed
          board any more: the Free Grid's moved DOWN to a toolbar row
          directly above the board (owner, 2026-09-11: "the controls for
          zoom and frame should live down where the sliders live in beat
          map's overview mode (closest row to the board)") and Columns
          followed (owner, 2026-09-21: "the columns bar should match").
          BoardPane draws ZoomControls there for both; the component
          still lives here because its classes are the bar's. */}
      <span className="pane-bar-spacer" />
      {/* This panel's filter, and the menu of what to do with the match
          set. The bar's one flexible member, so a narrow split gives here
          first rather than pushing the gears off the end. */}
      {/* WHERE SOMETHING WAS (owner, 2026-09-04): an ellipsis stands in
          for each shed control -- at the search's left for Furl, at its
          right for the tool group -- and the two become one once the
          search goes too. Which shows is the container queries' call. */}
      <span className="pane-bar-more left" aria-hidden="true">
        &#8943;
      </span>
      <SearchMenu {...search} board={board} />
      <span className="pane-bar-more right" aria-hidden="true">
        &#8943;
      </span>
      {/* THE TOOLS AS A GROUP, so a narrow column can drop them together
          (owner, 2026-09-04): Stats, the shortcut legend (moved down from
          the topbar into Usage's old slot -- Usage is deployment-wide and
          went up; `?` opens this too), and the light/dark switch.
          Options stays outside the group and is the last thing to go. */}
      <span className="pane-bar-tools">
        <StatsMenu board={board} />
        <button
          className="pane-btn icon-only"
          aria-label="Keyboard shortcuts (?)"
          data-tip="Keyboard shortcuts (?)"
          onClick={() => keysPanel.toggle()}
        >
          <Keyboard size={13} />
        </button>
      </span>
      <OptionsMenu board={board} />
    </div>
  );
}


/* THE ZOOM LEVEL AND THE FRAME TOGGLE of a typed board, one control:
 * the pane bar draws it for Columns, and BoardPane draws it in the
 * grid's own toolbar row above the board (owner, 2026-09-11). The
 * classes stay `pane-bar-zoom` wherever it is drawn -- the slider's
 * self-drawn track and tick are keyed on them -- and the anchor finds
 * the pane by ancestry, so nothing here cares which host it is in. */
export function ZoomControls({ board, zoom, onZoom }: { board: Board; zoom: number; onZoom: (z: number) => void }) {
  return (
    <span className="pane-bar-zoom">
      {/* ZOOM LEVEL, a factor over the whole board (owner, 2026-09-04):
          the label at the left, the slider, the factor at the right.
          ONE TICK under the slider at 1.0x (owner, later that day:
          "a small vertical hash mark at the 1.0 level... the only
          hash mark"), in place of the "(full board)" words that used
          to sit beside the value. Drawn by CSS on the wrapper, NOT a
          <datalist> option: Chromium snaps the thumb to a tick from
          a few pixels away, and with the tick this close to the
          track's start, 0.8x and 0.9x could not be reached by mouse
          at all (owner-reported: "zooming below 1 appears to have
          broken"). */}
      <span className="pane-bar-label">Zoom level:</span>
      <span
        className="zoom-track"
        style={
          {
            "--tick-at": (1 - ZOOM_FACTOR_MIN) / (ZOOM_FACTOR_MAX - ZOOM_FACTOR_MIN),
          } as CSSProperties
        }
      >
      <input
        type="range"
        min={ZOOM_FACTOR_MIN * 10}
        max={ZOOM_FACTOR_MAX * 10}
        value={Math.round(zoom * 10)}
        aria-label="Zoom level"
        data-tip="Zoom level"
        /* ANCHORED before every step (owner, 2026-08-29): the
           selected card's centre when one is on screen, the
           viewport's centre otherwise. Same pendingAnchor the
           ctrl-wheel uses. */
        onChange={(e) => {
          anchorSliderZoom(e.currentTarget.closest(".pane"), zoom);
          onZoom(Number(e.target.value) / 10);
        }}
      />
      </span>
      <button
        className="mono pane-bar-zoom-val"
        aria-label="Back to 1x"
        data-tip="Back to 1x"
        onClick={(e) => {
          anchorSliderZoom(e.currentTarget.closest(".pane"), zoom);
          onZoom(1);
        }}
      >
        {/* A FIXED-width button still (owner-reported 2026-09-04): a
            label that came and went beside the value took its width
            from the controls to the slider's LEFT and slid the slider
            under the pointer. The label is gone; the fixed width
            stays so the toggle after it never moves either. */}
        {zoom.toFixed(1)}x
      </button>
      {/* THE FRAME (owner, 2026-09-04): a cosmetic edge around the
          board with a wall outside it -- board/frame.ts. The toggle
          alone lives here, after the zoom (his placement); its
          material and the wall are set by right-clicking the frame
          or the wall (board/FramePopover.tsx). */}
      <FrameToggle boardId={board.id} />
    </span>
  );
}

/* The board frame's on/off, filled when on like the theme switch. Per
 * board, per browser (state/settings.ts). */
function FrameToggle({ boardId }: { boardId: string }) {
  const s = useSettings(boardId);
  return (
    <button
      className={"pane-btn icon-only frame-toggle" + (s.frame ? " active" : "")}
      aria-label={s.frame ? "Hide the board frame" : "Show a board frame"}
      data-tip={s.frame ? "Hide frame" : "Board frame"}
      aria-pressed={s.frame}
      onClick={() => setSetting(boardId, "frame", !s.frame)}
    >
      <Frame size={13} />
    </button>
  );
}

/* LIGHT / DARK, one button (owner, 2026-09-04): both pictograms, the
 * one in force FILLED and the other an outline, so the button says
 * which mode you are in rather than which you would get. In the
 * TOPBAR's right cluster since 2026-09-06 (owner: "move the dark/light
 * mode toggle up to the project row"): uiTheme is GLOBAL, so it
 * belongs with the project-wide things -- and the pane bar it lived in
 * is shelved when Notes takes the window, which left no way to flip
 * it from there. Rendered by App; any board id addresses the setting. */
export function ThemeToggle({ boardId }: { boardId: string }) {
  const s = useSettings(boardId);
  const dark = s.uiTheme === "dark";
  return (
    <button
      className="pane-btn icon-only theme-toggle"
      role="switch"
      aria-checked={dark}
      aria-label="Dark UI"
      data-tip={dark ? "Dark UI" : "Light UI"}
      onClick={() => setSetting(boardId, "uiTheme", dark ? "light" : "dark")}
    >
      <Sun size={13} className={dark ? "" : "on"} />
      <Moon size={13} className={dark ? "on" : ""} />
    </button>
  );
}

/* A pane-bar dropdown: a button that shows the current value (or a verb) and
 * opens a short list. Backs the Board View picker, Furl/Unfurl, and the
 * topbar's Project View picker (App.tsx) -- the three read as one idiom. */
export function BarMenu({
  label,
  icon,
  items,
  active,
  onPick,
  className,
}: {
  label: string;
  icon: ReactNode;
  /* so a particular menu can be pointed at from elsewhere -- the Drive
   * Modes hint outlines the Project View picker by name */
  className?: string;
  /* An item can carry its own icon -- the Project View menu draws each
   * mode as the shape of the window it makes, which reads faster than the
   * words do. */
  items: { key: string; name: string; icon?: ReactNode }[];
  active?: string; // marks the current choice, when the menu has one
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={"fold-menu" + (className ? " " + className : "")} ref={ref}>
      <button className={"pane-btn fold-btn" + (open ? " active" : "")} onClick={() => setOpen((o) => !o)}>
        {icon}
        <span>{label}</span>
        <ChevronDown size={12} className="fold-caret" />
      </button>
      {open && (
        <div className="fold-menu-pop">
          {items.map((it) => (
            <button
              key={it.key}
              className={"fold-menu-item" + (active === it.key ? " active" : "")}
              onClick={() => {
                onPick(it.key);
                setOpen(false);
              }}
            >
              {it.icon && <span className="fold-menu-icon">{it.icon}</span>}
              {it.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
