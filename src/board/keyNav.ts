import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Board, Node } from "../state/types";
import { fold } from "../state/fold";
import { useBoardIndex, ops } from "../state/useBoard";
import { editCard } from "./autoEdit";
import { cardMenu } from "./cardMenu";
import { metaPanel, META_W, NOTE_W, openNoteFor, notesDrive, playerDrive } from "./cardPanels";
import { keysPanel } from "./keysPanel";
import { openNested } from "./openNested";
import { select, selection } from "./selection";
import { matchesSearch, showsWholeSubtree } from "./flatten";
import { searchTitle, type NestInfo } from "../state/nesting";
import { spacePan } from "./spacePan";
import { clipboard } from "./clipboard";
import { lastPoint } from "./grid/canvasMenu";
import { gridCards, landCells } from "../state/gridBoard";
import { getSnapshot } from "../state/ydoc";
import { hit } from "../state/counts";
import type { BoardPaneHandle } from "./BoardPane";
import { pickSpatial, readCells } from "./spatialNav";

/* ------------------------------------------------------------------ *
 *  Keyboard navigation over the board (first pass, 2026-08-01).
 *
 *  A "keyboard cursor" that IS the selection -- no second highlight to
 *  invent, and everything selection already powers (drag, tag, cut,
 *  paste-values) works on whatever the keyboard lands on. The map is the
 *  SCREEN, not the tree (owner's call -- v1 walked the tree and
 *  Down-into-first-child surprised everyone): the board reads as rows,
 *  like lines of text. Left/Right walk a row and wrap at its ends -- a
 *  scene's Right steps into its first beat, a last beat's Right lands on
 *  the next row -- and Up/Down go to the neighbouring row's head, so a
 *  scene's Down is the NEXT SCENE (or whatever header comes next), never
 *  its own beats. Folded rows collapse to their head (navRows).
 *
 *    Arrows   move (revealing + scrolling the detail pane as they go)
 *    Shift+   extend the selection to wherever that arrow lands -- along
 *      arrow  a row, or a whole row at a time with Up/Down. Sibling-bound
 *             like every range here: crossing a tier resets to one card.
 *    Enter    edit the title in place (Editable's own Enter/Escape
 *             commit/revert; a second Enter re-opens)
 *    Space    open the card menu on the cursor -- the everything key for
 *             the everything menu, and the only way graduation, cut/paste
 *             and recolor are reachable without a mouse. ContextMenu and
 *             Shift+F10 (the platform-standard pair, absent from a Mac
 *             laptop keyboard) do the same, unadvertised.
 *    N        open the Note panel beside the card
 *    M        open the More-metadata panel beside the card
 *    Escape   clear the selection (when nothing else claims it)
 *
 *  Three deliberate stay-out-of-the-way rules:
 *   - nothing fires while typing (inputs, textareas, contenteditable) or
 *     with a modifier held -- the browser and the undo shortcut own those;
 *   - nothing fires while an overlay is up (panels, card menu, template
 *     picker, add-tag menu): each owns its own keys, and arrows moving the
 *     board UNDER an open per-card panel would desync the two. Escape is
 *     included -- the overlays close themselves on it, and the selection
 *     must not vanish in the same press (matching FloatPanel's two-stage
 *     Escape for text fields);
 *   - Escape also yields to a latched legend highlight (the `.app` root
 *     pane carries data-legend-hover), which releases on its own Escape.
 *
 *  One keyboard, one cursor -- but in the split view the cursor can be in
 *  either panel: App drives this hook with whichever pane holds the
 *  keyboard (board/paneFocus.ts, focus follows mouse-down), so `board`
 *  and `pane` both swap together and the cursor simply picks up wherever
 *  the selection is in the new panel.
 * ------------------------------------------------------------------ */

export type NavDir = "left" | "right" | "up" | "down";

/* The board as the GRID the eye actually reads -- a spreadsheet of
 * cells, one entry per VISUAL line (owner's spec, 2026-08-02: "we're
 * simulating moving through cells of a spreadsheet"). Every cell carries
 * its COLUMN, because the lines don't all start at the same place:
 *
 *   [ header(0) ]
 *   [ scene(0), b1(1), b2(2), ... ]     <- the scene's first beat row
 *   [ b9(1), b10(2), ... ]              <- its WRAPPED rows: beats only,
 *                                          same columns as the row above
 *
 * A scene's beat strip wraps exactly where the board wraps it -- after
 * `maxRowBeats` cards (Board.maxRowBeats, default 8) and after a manual
 * `breakAfter` -- and hidden (stacked-away) beats aren't cells at all.
 * Folded rows collapse to their head; navigation must not walk cards
 * that aren't on screen. */
export interface NavCell {
  id: string;
  col: number;
}

const DEFAULT_ROW_CAP = 8; // Board.maxRowBeats unset -- ydoc's default

export function navRows(
  board: Board,
  isFolded: (id: string) => boolean = () => false,
  /* the active search, lowercased. A filtered board draws only the cards
   * that match (flatten.ts), so the cursor has to walk only those --
   * arrows used to travel to cards that weren't on screen. Searching
   * also EXPANDS everything, exactly as flatten does, so fold is ignored
   * while a query is live. */
  q = "",
  matchCase = false,
  /* A NESTING CARD IS WALKED BY THE NAME IT SHOWS (state/nesting.ts
   * `searchTitle`), so the cursor visits exactly the cards the board
   * drew -- the invariant this whole file exists to keep. */
  nests?: Map<string, NestInfo>,
): NavCell[][] {
  const rows: NavCell[][] = [];
  const leaf = board.levels.length - 1;
  const cap = Math.max(1, board.maxRowBeats ?? DEFAULT_ROW_CAP);
  const searching = q.length > 0;
  /* `whole` mirrors flatten's rule exactly: a node that matched by its own
   * NAME shows its entire subtree, so the cursor must walk all of it too.
   * Both predicates are imported rather than restated -- the keyboard
   * landing on a card the board didn't draw is the bug this guards. */
  const shown = (n: Node, depth: number, whole: boolean) =>
    !searching || whole || matchesSearch(n, depth, leaf, q, matchCase, nests);
  const walk = (nodes: Node[], depth: number, whole = false) => {
    for (const n of nodes) {
      if (!shown(n, depth, whole)) continue;
      const wholeNow = whole || (searching && showsWholeSubtree(n, q, matchCase, nests));
      if (depth >= leaf - 1) {
        let row: NavCell[] = [{ id: n.id, col: 0 }];
        if (searching || !isFolded(n.id)) {
          let col = 1;
          let inRow = 0;
          for (const c of n.children) {
            if (c.hidden) continue; // tucked behind a stack: not on screen
            if (searching && !wholeNow && !hit(searchTitle(c, nests), q, matchCase)) continue; // filtered out
            if (inRow >= cap) {
              rows.push(row);
              row = [];
              col = 1;
              inRow = 0;
            }
            row.push({ id: c.id, col });
            col++;
            inRow++;
            if (c.breakAfter) {
              rows.push(row);
              row = [];
              col = 1;
              inRow = 0;
            }
          }
        }
        if (row.length) rows.push(row);
      } else {
        rows.push([{ id: n.id, col: 0 }]);
        if (searching || !isFolded(n.id)) walk(n.children, depth + 1, wholeNow);
      }
    }
  };
  walk(board.roots, 0);
  return rows;
}

/* The node an arrow moves to, or null for "stay put" (top/bottom edge).
 * Caret-through-text rules: Left/Right walk the line and WRAP at its
 * ends -- a scene's Right steps into its first beat, the end of one beat
 * row flows into the next -- so Right reads the whole board in order.
 * Up/Down move one VISUAL line keeping the column: straight down when a
 * cell sits there, else leftward to the nearest cell (a shorter line
 * below, a header's single cell). From nothing selected (or a selection
 * this board doesn't hold), any arrow starts at the first cell: the
 * keyboard has to be able to pick the board up cold. */
export function keyTarget(
  board: Board,
  currentId: string | null,
  dir: NavDir,
  isFolded?: (id: string) => boolean,
  q = "",
  matchCase = false,
  /* A NESTING CARD IS WALKED BY THE NAME IT SHOWS (state/nesting.ts
   * `searchTitle`), so the cursor visits exactly the cards the board
   * drew -- the invariant this whole file exists to keep. */
  nests?: Map<string, NestInfo>,
): string | null {
  const rows = navRows(board, isFolded, q, matchCase, nests);
  if (rows.length === 0) return null;
  let ri = -1;
  let ci = -1;
  if (currentId) {
    for (let i = 0; i < rows.length && ri < 0; i++) {
      const j = rows[i].findIndex((c) => c.id === currentId);
      if (j >= 0) {
        ri = i;
        ci = j;
      }
    }
  }
  if (ri < 0) return rows[0][0].id;

  /* the cell at-or-left-of `col`, else the line's leftmost cell */
  const atColumn = (row: NavCell[], col: number): string => {
    let best = row[0];
    for (const c of row) if (c.col <= col && c.col > best.col) best = c;
    return best.id;
  };

  switch (dir) {
    case "right":
      return rows[ri][ci + 1]?.id ?? rows[ri + 1]?.[0].id ?? null;
    case "left": {
      if (ci > 0) return rows[ri][ci - 1].id;
      const prev = rows[ri - 1];
      return prev ? prev[prev.length - 1].id : null;
    }
    case "down": {
      const next = rows[ri + 1];
      return next ? atColumn(next, rows[ri][ci].col) : null;
    }
    case "up": {
      const prev = rows[ri - 1];
      return prev ? atColumn(prev, rows[ri][ci].col) : null;
    }
  }
}

/* The ends of the cursor's own line (Home / End). Null when the cursor
 * isn't on the board -- there's no line to go to the end of. */
export function rowEnd(
  board: Board,
  currentId: string | null,
  end: "start" | "end",
  isFolded?: (id: string) => boolean,
  q = "",
  matchCase = false,
  /* A NESTING CARD IS WALKED BY THE NAME IT SHOWS (state/nesting.ts
   * `searchTitle`), so the cursor visits exactly the cards the board
   * drew -- the invariant this whole file exists to keep. */
  nests?: Map<string, NestInfo>,
): string | null {
  if (!currentId) return null;
  const row = navRows(board, isFolded, q, matchCase, nests).find((r) => r.some((c) => c.id === currentId));
  if (!row) return null;
  const target = end === "start" ? row[0].id : row[row.length - 1].id;
  return target === currentId ? null : target;
}

/* Where the cursor lands after deleting `ids`: the first cell AFTER the
 * last selected one in reading order (the card that visually slides into
 * the gap), else the nearest cell BEFORE the first, else nothing -- the
 * board may now be empty. Computed from the grid BEFORE the deletion, so
 * it must never return a deleted id. */
export function deleteSurvivor(
  board: Board,
  ids: string[],
  isFolded?: (id: string) => boolean,
  q = "",
  matchCase = false,
  /* A NESTING CARD IS WALKED BY THE NAME IT SHOWS (state/nesting.ts
   * `searchTitle`), so the cursor visits exactly the cards the board
   * drew -- the invariant this whole file exists to keep. */
  nests?: Map<string, NestInfo>,
): string | null {
  const dying = new Set(ids);
  // everything inside a dying subtree dies with it -- deleting a scene
  // must not pick one of its own beats as the survivor
  const walk = (nodes: Node[], doomed: boolean) => {
    for (const n of nodes) {
      const d = doomed || dying.has(n.id);
      if (d) dying.add(n.id);
      walk(n.children, d);
    }
  };
  walk(board.roots, false);
  const cells = navRows(board, isFolded, q, matchCase, nests).flat();
  let first = -1;
  let last = -1;
  cells.forEach((c, i) => {
    if (dying.has(c.id)) {
      if (first < 0) first = i;
      last = i;
    }
  });
  if (first < 0) return null;
  for (let i = last + 1; i < cells.length; i++) if (!dying.has(cells[i].id)) return cells[i].id;
  for (let i = first - 1; i >= 0; i--) if (!dying.has(cells[i].id)) return cells[i].id;
  return null;
}

/* Where a node sits, in the terms every mouse-driven opener already
 * passes around: the panels want its tier, the card menu wants its whole
 * address (parent, index, tier) plus the cards stacked behind it. The
 * renderers get all of this from the row they're drawing; the keyboard
 * has only an id, so it re-derives it from the same snapshot.
 *
 * `stacked` mirrors the render rule (flatten.ts / CardsLane): a hidden
 * node tucks behind the visible sibling before it, so a card's stack is
 * the run of hidden siblings that follows it. */
export interface Cell {
  node: Node;
  parentId: string | null;
  index: number;
  depth: number;
  stacked: string[];
}

export function locateCell(board: Board, id: string): Cell | null {
  const walk = (nodes: Node[], parentId: string | null, depth: number): Cell | null => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.id === id) {
        const stacked: string[] = [];
        for (let j = i + 1; j < nodes.length && nodes[j].hidden; j++) stacked.push(nodes[j].id);
        return { node: n, parentId, index: i, depth, stacked };
      }
      const hit = walk(n.children, n.id, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(board.roots, null, 0);
}

const cardBox = (id: string): DOMRect | undefined =>
  document.querySelector(`[data-node="${CSS.escape(id)}"]`)?.getBoundingClientRect();

/* Where a keyboard-opened card menu appears: the card's bottom-left
 * corner, so it drops out of the card the way a right-click's menu drops
 * out of the pointer. The menu clamps itself to the window, so an
 * off-screen card (never revealed) degrades to a corner rather than
 * nothing. */
function menuSpotFor(id: string): { x: number; y: number } {
  const r = cardBox(id);
  return r ? { x: r.left + 4, y: r.bottom - 2 } : { x: 120, y: 120 };
}

/* Open a per-card panel beside the card's on-screen box. The card may not
 * be mounted (virtualized row off screen) -- the caller reveals it first;
 * if it still isn't, fall back to a fixed spot rather than not opening. */
function panelSpotFor(id: string, panelW: number): { x: number; y: number } {
  const r = cardBox(id);
  if (!r) return { x: 120, y: 120 };
  const x = r.right + 10 + panelW <= window.innerWidth - 8 ? r.right + 10 : Math.max(8, r.left - panelW - 10);
  return { x, y: Math.max(60, Math.min(r.top, window.innerHeight - 300)) };
}

const DIRS: Record<string, NavDir> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/* True while some overlay owns the keyboard -- see the header comment.
 * A PASSIVE float panel (ui/FloatPanel.tsx `passive`: the shortcut
 * legend, whose whole point is to sit open while you try the keys it
 * lists, and since 2026-09-12 the timecode calculator, by his report)
 * is deliberately not an overlay here: the panel declares it, so this
 * keeps no list of class names.
 *
 * `.options-panel:not(.float-panel)`, because every float panel ALSO
 * wears `options-panel` (it borrows the dropdown panels' chrome), and
 * the bare term matched the legend regardless of its exemption -- so
 * the keys were dead under the legend too, which is what the
 * calculator report turned up (2026-09-12). The float-panel term is
 * the only one that speaks for float panels now. */
const OVERLAYS = ".ctx-menu, .legend-add-menu, .tp-backdrop, .options-panel:not(.float-panel), .confirm-backdrop";
function overlayOpen(): boolean {
  return Boolean(document.querySelector(`.float-panel:not([data-passive]), ${OVERLAYS}`));
}
/* Escape is owned more widely: by every float panel that CLOSES on it
 * (passive or not, the legend excepted as it always was), since the
 * selection must not vanish in the press that closes a panel. */
function escapeOwned(): boolean {
  return Boolean(document.querySelector(`.float-panel:not(.keys-panel), ${OVERLAYS}`));
}

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

/* Enter and Space are how a focused BUTTON is pressed. A card isn't
 * focusable, so a keydown reaching us from one of the app's own controls
 * (a legend chip, a toolbar button) means the user is working that
 * control -- pressing it must not also fire the board's shortcut. */
const onControl = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && Boolean(t.closest("button, a, [role='button']"));

/* The keyboard's own position. The ANCHOR can't serve: Shift+Right
 * extends a range and deliberately keeps the anchor where it started, so
 * a second Shift+Right computed from the anchor would extend to the same
 * card forever. Falls back to the anchor whenever the mouse has replaced
 * the selection out from under it. */
let cursor: string | null = null;

/* Where the keyboard just LANDED, published for anything that wants to
 * follow the cursor rather than the pointer. Today that's the Overview's
 * preview card (OverviewView): hovering a proxy pops a readable card, and
 * arrowing onto one has to do the same or the keyboard is a second-class
 * way to read the board. `n` ticks so landing on the same cell twice
 * re-fires; null means the cursor is gone (Escape). */
export interface KeyCursor {
  id: string;
  n: number;
}
let landed: KeyCursor | null = null;
const cursorListeners = new Set<() => void>();

export const keyCursor = {
  get: (): KeyCursor | null => landed,
  moved(id: string) {
    landed = { id, n: (landed?.n ?? 0) + 1 };
    cursorListeners.forEach((l) => l());
  },
  clear() {
    if (!landed) return;
    landed = null;
    cursorListeners.forEach((l) => l());
  },
  subscribe(l: () => void): () => void {
    cursorListeners.add(l);
    return () => cursorListeners.delete(l);
  },
};

const NO_CURSOR = () => null;
export const useKeyCursor = (): KeyCursor | null =>
  useSyncExternalStore(keyCursor.subscribe, keyCursor.get, NO_CURSOR);

/* WHERE A KEYBOARD PASTE LANDS.
 *
 * The card menu's paste needs no rule -- you right-clicked the card it
 * goes beside. Cmd-V has to decide, and the answer differs by type:
 *
 *   FREE GRID   the last point you right-clicked (owner's call). On a
 *               spatial board a position is the only meaningful answer,
 *               and the right-click point is one you chose and can
 *               remember. Falls back to beside the selection, then to
 *               the board's own parking.
 *   EVERYTHING  after the selected card, at its own tier -- the
 *   ELSE        selection is already how the keyboard addresses things.
 *               With nothing selected there is nowhere to aim, so the
 *               paste is declined rather than guessed at.
 *
 * Returns whether it acted, so the caller only swallows the keystroke
 * when something happened.
 */
function pasteHere(board: Board): boolean {
  const leaf = board.levels.length - 1;
  const sel = selection.ids();

  if (board.type === "grid") {
    /* A grid ships a ONE-rung ladder, so its cards are at role height 0. */
    const before = new Set(board.roots.map((n) => n.id));
    const at =
      lastPoint(board.id) ??
      (sel.length ? board.roots.find((n) => n.id === sel[0])?.cell : undefined);
    clipboard.paste(null, board.roots.length, 0, board.id);
    const fresh = (getSnapshot().boards.find((b) => b.id === board.id)?.roots ?? []).filter(
      (n: Node) => !before.has(n.id),
    );
    if (!fresh.length) return false;
    if (at) {
      const cells: Record<string, { x: number; y: number }> = {};
      /* Stepped, not stacked -- a run pasted onto one cell would look
       * like a single card. Same shape as the canvas menu's paste. */
      fresh.forEach(
        (n: Node, i: number) =>
          (cells[n.id] = { x: at.x + (i % 4) * 7, y: at.y + Math.floor(i / 4) * 5 }),
      );
      ops.setNodeCells(cells);
    }
    return true;
  }

  if (!sel.length) return false;
  const cell = locateCell(board, sel[0]);
  if (!cell) return false;
  const height = leaf - cell.depth;
  if (!clipboard.fitsAt(height)) return false; // nothing that fits this rung
  /* After the selected card, and after any hidden run stacked behind it
   * -- the same "trailing stack" rule the seam's append follows. */
  clipboard.paste(cell.parentId, cell.index + 1 + cell.stacked.length, height, board.id);
  return true;
}

export function useKeyNav(board: Board | null, pane: () => BoardPaneHandle | null) {
  /* Read through a ref, like the panel's query: `boardIndex` is
   * identity-stable until a board is added, removed, RENAMED or re-typed,
   * but the key listener has no reason to re-register even then. */
  const nests = useBoardIndex();
  const nestsRef = useRef(nests);
  nestsRef.current = nests;
  useEffect(() => {
    if (!board) return;
    const onKey = (e: KeyboardEvent) => {
      /* THE CLIPBOARD KEYS, before the modifier bail below -- they are
       * the only shortcuts in the app that WANT a modifier.
       *
       * `isTyping` first and without exception: Cmd-C/X/V in a text
       * field belong to the browser, and stealing them would break
       * copying a word out of a card title. That is also why nothing
       * here calls preventDefault unless it actually acts. */
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !isTyping(e.target) && !overlayOpen()) {
        const k = e.key.toLowerCase();
        if (k === "c" || k === "x" || k === "v") {
          const ids = selection.ids();
          if (k === "v") {
            if (pasteHere(board)) e.preventDefault();
            return;
          }
          if (!ids.length) return; // nothing selected: let the browser have it
          e.preventDefault();
          if (k === "c") clipboard.copy(ids);
          else {
            clipboard.cut(ids);
            selection.clear();
          }
          return;
        }
      }
      /* OPTION+ARROWS NUDGE the selection one cell on a Free Grid
       * (owner-approved 2026-08-29). Option rather than Cmd -- Cmd+Left
       * is the browser's own Back outside a text field -- and before
       * the modifier bail below for the clipboard keys' reason: it is a
       * shortcut that WANTS its modifier. Goes through landCells, so a
       * nudge off the top-left edge expands the board exactly as a drag
       * released there does. */
      if (e.altKey && !e.metaKey && !e.ctrlKey && board.type === "grid" && !isTyping(e.target) && !overlayOpen()) {
        const step = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }[
          e.key as "ArrowLeft"
        ];
        if (step) {
          const ids = selection.ids();
          if (ids.length) {
            e.preventDefault();
            const cards = gridCards(board);
            const moved = new Map(
              cards
                .filter((c) => ids.includes(c.node.id))
                .map((c) => [c.node.id, { x: c.cell.x + step.x, y: c.cell.y + step.y }]),
            );
            if (moved.size) ops.setNodeCells(landCells(cards, moved).cells);
          }
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;

      if (e.key === "Escape") {
        if (escapeOwned()) return; // the overlay's own Escape
        // the latch's -- but not the notes column's spotlight, which rides
        // the same attribute with a "note:" key and must not eat Escape
        if (document.querySelector('[data-legend-hover]:not([data-legend-hover^="note:"])')) return;
        selection.clear();
        keyCursor.clear(); // ...and the preview the cursor was showing
        return;
      }
      // the legend's own toggle works even while other overlays are up --
      // you may well be asking "what closes this?"
      if (e.key === "?") {
        e.preventDefault();
        keysPanel.toggle();
        return;
      }
      if (overlayOpen()) return;
      /* THE NOTES COLUMN HOLDS THE ARROWS while it is driving (owner,
       * 2026-09-08): a click in it took them, and it walks note to note
       * itself (NotesPanel), selecting each card here as it goes. */
      if (notesDrive.get()) return;

      /* The Overview ignores fold (it always shows everything), so its
       * keyboard must too -- and its cards are proxies, scrolled by their
       * own viewport rather than the detail pane's virtualized list. */
      const inOverview = pane()?.view === "overview";
      /* A KANBAN BOARD IS A SURFACE TOO, for the same reason the Overview
       * is: its columns put document-later content to the RIGHT, so the
       * visual-line model -- correct wherever tree order and screen order
       * agree -- would send Right down a column and Down across to the
       * next one. The exploration's own conclusion: a sideways type wants
       * spatialNav, not the line walker. */
      /* Any type whose cards are ARRANGED rather than listed takes the
       * nearest-box arrows: on those surfaces document order and screen
       * order genuinely differ, which is what the line walker assumes.
       * A Free Grid is the extreme case -- position is the whole point. */
      const spatial = inOverview || Boolean(board.type);
      /* This PANEL's search, lowercased, read per keypress rather than
       * closed over: search went per pane (board/PaneBar.tsx), and the
       * cursor must walk only the cards the panel is actually SHOWING --
       * with a filter on, the row model happily stepped to cards the
       * filter had removed, so Down looked broken. */
      const query = pane()?.query ?? "";
      const matchCase = pane()?.matchCase ?? false;
      const goTo = (id: string) => {
        if (!spatial) {
          pane()?.scrollToNode(id);
          return;
        }
        document
          .querySelector(`[data-node="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: "nearest", inline: "nearest" });
        // linked panels: a Detail pane on this board follows the cursor,
        // exactly as it follows a single click in the Overview
        pane()?.followSelect(id);
      };

      /* Every cursor MOVE goes through here: select, scroll it into view,
       * then publish where we landed so the Overview's preview can follow
       * the keyboard the way it follows the pointer. Deliberately not on
       * the Space/N/M paths -- those open something over the card, and a
       * preview card under a menu is just noise. */
      const land = (id: string, extend: boolean) => {
        select(id, extend ? "range" : "single");
        cursor = id;
        goTo(id);
        keyCursor.moved(id);
      };

      const dir = DIRS[e.key];
      if (dir) {
        e.preventDefault(); // arrows must not scroll the page out from under the cursor
        const at = cursor && selection.has(cursor) ? cursor : selection.anchor();

        /* THE OVERVIEW IS A SURFACE, NOT A PAGE OF TEXT (owner's call,
         * 2026-08-03). Its columns put document-later content up and to
         * the RIGHT, so the row model -- which is correct in the detail
         * view, where tree order and screen order agree -- sent Right
         * from the bottom of one column to the top of the next. Here the
         * arrows go to the nearest card ON SCREEN in that direction, so
         * a scene's Left lands in the column beside it and a wrapped
         * beat row's Down is the row below.
         *
         * Falls through to the row walk if the cursor isn't on screen
         * (nothing measured to move from) -- that's how a cold Overview
         * still picks up the first cell. */
        if (spatial) {
          /* EVERY SPATIAL SURFACE MUST REGISTER HERE. The list is
           * explicit rather than a bare `[data-kbd]` because the PANE
           * carries that attribute too, and querySelector would return
           * the ancestor. A new board type whose renderer forgets this
           * line gets a keyboard that selects and then never moves --
           * which is exactly how the Free Grid's arrows failed until it
           * was added. */
          const viewport = document.querySelector(
            ".ov-viewport[data-kbd], .kanban[data-kbd], .grid-surface[data-kbd]",
          );
          const here = at ? viewport?.querySelector(`[data-node="${CSS.escape(at)}"]`) : null;
          if (viewport && here) {
            const r = here.getBoundingClientRect();
            const next = pickSpatial(
              dir,
              { id: at!, x: r.left, y: r.top, w: r.width, h: r.height },
              readCells(viewport),
            );
            if (next) land(next, e.shiftKey);
            return; // at the surface's edge: stay put, don't wrap
          }
        }


        /* DETAIL only: on a lane card, Left FOLDS and Right UNFOLDS before
         * either of them moves -- the outliner idiom, and the one thing
         * the keyboard couldn't reach (collapse was a chevron click).
         * Only when there's something to do: an expanded lane's Right and
         * a folded lane's Left still travel, so a run of Rights still
         * reads the board in order. The Overview ignores fold entirely,
         * so it keeps the plain walk. Shift is the selection's, never
         * the fold's. */
        /* ...and `spatial`, not `inOverview`: a kanban column would
         * otherwise FOLD on Left. Fold is a detail-view rendering rule
         * that this type ignores, so the keypress would write per-user
         * fold state, draw nothing, and read as a dead key. */
        if (!spatial && !e.shiftKey && at && (dir === "left" || dir === "right")) {
          const cell = locateCell(board, at);
          const lane = cell && cell.depth < board.levels.length - 1 && cell.node.children.length > 0;
          if (lane && (dir === "left") !== fold.isCollapsed(at)) {
            fold.toggle(at);
            return;
          }
        }

        const next = keyTarget(
          board,
          at,
          dir,
          inOverview ? undefined : fold.isCollapsed,
          query,
          matchCase,
          nestsRef.current,
        );
        if (!next) return;
        /* Shift extends to wherever the arrow lands, in every direction:
         * Up/Down on a wrapped beat strip take a whole row at a time,
         * which is what a spreadsheet caret does and the reason the grid
         * is modelled as lines in the first place. `select`'s range is
         * sibling-bound, so an extension that crosses a tier (a beat's
         * Down into the next scene) resets to that one card -- the same
         * rule Shift+Left/Right has always followed. */
        land(next, e.shiftKey);
        return;
      }

      const anchor = cursor && selection.has(cursor) ? cursor : selection.anchor();
      /* `m` WITH NOTHING SELECTED opens the metadata panel EMPTY (owner,
       * 2026-09-10) -- the "No card loaded" face it already wears when a
       * pinned panel's card is deselected. So the panel can be summoned
       * first and pointed at a card second, which is the order you work
       * in with the Player open. An empty id is the store's word for it;
       * panelSpotFor with no card to anchor to gives its fallback spot. */
      if (!anchor && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        const { x, y } = panelSpotFor("", META_W);
        metaPanel.open("", board.id, 0, x, y);
        return;
      }
      if (!anchor) return;
      /* Home / End are the line's ends, as they are in a spreadsheet --
       * for a scene's beat strip, its first and last beat. */
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const next = rowEnd(
          board,
          anchor,
          e.key === "Home" ? "start" : "end",
          inOverview ? undefined : fold.isCollapsed,
          query,
          matchCase,
          nestsRef.current,
        );
        if (!next) return;
        land(next, e.shiftKey);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const ids = selection.ids();
        // pick the landing spot from the grid BEFORE the doc changes
        const next = deleteSurvivor(
          board,
          ids,
          inOverview ? undefined : fold.isCollapsed,
          query,
          matchCase,
          nestsRef.current,
        );
        ops.delNodes(ids);
        if (next) {
          land(next, false);
        } else {
          selection.clear();
          keyCursor.clear();
        }
        return;
      }
      if (e.key === "Enter") {
        if (onControl(e.target)) return; // Enter is that button's own press
        e.preventDefault();
        /* A NESTING CARD has no title of its own to open and nothing
         * below it to jump into, so Enter means what its double-click
         * means in both views: open the board it stands in for. It is
         * anchored to the card's own box, since there is no pointer. */
        const ref = locateCell(board, anchor)?.node.boardRef;
        if (ref) {
          // anchored to the card's own box -- there is no pointer here,
          // which is what menuSpotFor already exists to answer
          const at = menuSpotFor(anchor);
          openNested.ask(ref, at.x, at.y);
          return;
        }
        // in the Overview there is nothing to type into -- Enter IS the
        // double-click, down to preferring a linked Detail panel on this
        // board over turning this one into the detail view
        if (inOverview) pane()?.jumpToNode(anchor);
        else editCard(anchor); // Editable takes the keyboard from here
        return;
      }
      /* The card menu on the cursor. Everything the mouse reaches by
       * right-clicking -- recolor, cut/paste, promote/demote, stowed
       * content -- is behind this one key, rather than a shortcut per
       * item; the menu takes the keyboard from here (arrow through it,
       * Enter to pick, Escape to leave). */
      /* SPACE FIRES ON KEY UP, not here (board/spacePan.ts). Holding it
       * arms canvas panning, so the menu belongs to a TAP -- a press and
       * release with no drag in between. `keyup` runs the identical
       * block below; for a tap the delay is imperceptible. ContextMenu
       * and Shift+F10 have no such conflict and still act on press. */
      if (e.key === " ") return;
      if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
        if (onControl(e.target)) return; // Space is that button's own press
        const cell = locateCell(board, anchor);
        if (!cell) return;
        e.preventDefault();
        goTo(anchor); // anchor the menu to a card that's actually on screen
        const { x, y } = menuSpotFor(anchor);
        cardMenu.open(cell.node, x, y, {
          boardId: board.id,
          parentId: cell.parentId,
          index: cell.index,
          depth: cell.depth,
          colorable: true,
          stackedIds: cell.stacked,
          keyed: true, // show the focus ring from the first frame
        });
        return;
      }
      if (e.key === "n" || e.key === "N" || e.key === "m" || e.key === "M") {
        const cell = locateCell(board, anchor);
        if (!cell) return;
        e.preventDefault();
        goTo(anchor); // make sure it's on screen to anchor to
        const meta = e.key === "m" || e.key === "M";
        const { x, y } = panelSpotFor(anchor, meta ? META_W : NOTE_W);
        /* `m` on a selection of many opens the panel ON THE SELECTION
         * (board/groupEdit.ts, 2026-09-12), the anchor as its card; a
         * note stays the anchor's own, notes being per card by nature */
        const ids = selection.size() > 1 ? selection.ids() : [anchor];
        if (meta) metaPanel.open(anchor, board.id, cell.depth, x, y, { ids });
        else openNoteFor(anchor, board.id, cell.depth, x, y);
      }
    };
    /* THE CARD MENU'S SPACE, on RELEASE (board/spacePan.ts says why).
     * A tap opens it; a hold that panned does not, so the two gestures
     * share the key without either having to know about the other's
     * internals -- this asks one question and spacePan answers it. */
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== " " || spacePan.panned()) return;
      if (playerDrive.get()) return; // the player's play / pause
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || onControl(e.target)) return;
      if (overlayOpen()) return;
      const at = cursor && selection.has(cursor) ? cursor : selection.anchor();
      if (!at || !board) return;
      const cell = locateCell(board, at);
      if (!cell) return;
      e.preventDefault();
      pane()?.scrollToNode(at);
      const { x, y } = menuSpotFor(at);
      cardMenu.open(cell.node, x, y, {
        boardId: board.id,
        parentId: cell.parentId,
        index: cell.index,
        depth: cell.depth,
        colorable: true,
        stackedIds: cell.stacked,
        keyed: true, // show the focus ring from the first frame
      });
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [board, pane]);
}
