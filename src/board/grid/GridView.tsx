import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as RMouseEvent, PointerEvent as RPointerEvent } from "react";
import type { Board, Cell } from "../../state/types";
import {
  CELL,
  DEFAULT_SPAN,
  SPAN_MAX,
  SPAN_MIN,
  clampCell,
  clampSpan,
  gridCards,
  gridExtent,
  landCells,
  liveEdges,
  overlappedBy,
  pinOf,
  roundCell,
  spanOf, NO_MARGIN, VIEW_MARGIN_SPAN } from "../../state/gridBoard";
import { ops } from "../../state/useBoard";
import { acceptsOne, dragStore } from "../drag";
import { matchesSearch } from "../flatten";
import { useBoardUI } from "../context";
import { select, selection, useSelectionIds } from "../selection";
import { openNew } from "../autoEdit";
import { confirmDialog } from "../../ui/confirmDialog";
import { GridCard, dragSet } from "./GridCard";
import { Yarn, type YarnLine } from "./Yarn";
import { Pins } from "./Pins";
import { gridDrag, ownGesture, useGridDrag } from "./gridDrag";
import { gridBounds, viewOrigin } from "../../state/gridBoard";
import { imageFrom, toCardImage, pictureOn, sitNewPicture } from "../cardImage";
import { yarnMenu } from "./yarnMenu";
import { canvasMenu, rememberPoint } from "./canvasMenu";
import { clampZoomFactor, useWheelZoom } from "../useWheelZoom";
import { useSettings } from "../../state/settings";
import { frameMenu } from "../frameMenu";
import { spacePan } from "../spacePan";


/* ------------------------------------------------------------------ *
 *  THE FREE GRID -- a corkboard with an anchor lattice, yarn between the
 *  pins, and pictures on the cards.
 *
 *  Read state/gridBoard.ts first: it holds the model and the reasoning
 *  (why cells rather than pixels, why overlap is allowed, why yarn is
 *  not a Node). This file is the surface -- placement, the three pointer
 *  gestures, and the drawing.
 *
 *  NOT VIRTUALIZED, for the same reason the Columns type is not: this
 *  board is for a wall of ideas, not for a 30-hour cut. The weight of a
 *  project lives in the boards nested off it.
 * ------------------------------------------------------------------ */

/* How far the pointer must travel before a press becomes a drag. Below
 * it, a press is a click that selects -- so you can pick a card up
 * without accidentally nudging it a cell. */
const DRAG_SLOP = 4;

/* Pointer capture is an OPTIMISATION here, not the mechanism: the move
 * and up listeners live on the window, so a gesture works whether or not
 * the element holds the pointer. Capture only keeps events flowing if
 * the cursor leaves the page.
 *
 * So a failure to capture must never abort the gesture -- and it can
 * fail: `setPointerCapture` throws InvalidPointerId for an id the
 * browser does not consider active, which is exactly what happens to
 * anything driving this surface synthetically. Calling it unguarded
 * before `gridDrag.start` meant the whole drag silently never began. */
function capture(el: Element, pointerId: number) {
  try {
    (el as HTMLElement).setPointerCapture?.(pointerId);
  } catch {
    /* not capturable -- the window listeners carry the gesture anyway */
  }
}

export function GridView({
  board,
  hasKeyboard,
  fitted,
  onZoom,
}: {
  board: Board;
  hasKeyboard: boolean;
  /* Only the UNSCALED view gets this: at 100% there is no zoom wrapper,
     so this element is the scroller and takes the ctrl-wheel listener
     itself (board/grid/GridScale.tsx says why no wrapper is added). */
  onZoom?: (z: number) => void;
  /* Laid out for a scaler (GridScale.tsx): content-sized instead of
     filling and scrolling its pane, so it can be measured and shrunk. */
  fitted?: boolean;
  /* The FIT view proper (GridScale.tsx GridFit); the zoomed Fixed view
   * is `fitted` (laid out for a scaler) but not `fit`. Nothing reads it
   * since the Fit governor went (2026-09-04); kept so the scaler can
   * still say which it is. */
  fit?: boolean;
}) {
  const { boardId, query, matchCase, connections, nests, settings, slot } = useBoardUI();
  const sheet = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  /* The MARQUEE, in cells -- drawn while a drag on bare cork is rubber-
   * banding a selection. Local state: it is paint, not a gesture the
   * cards need to know about. */
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  /* Only when this IS the scroller -- i.e. the unscaled Fixed view.
     Inside a zoom wrapper the wrapper owns it, and a second live
     instance would fight it (useWheelZoom says how). */
  useWheelZoom(surface, 1, onZoom ?? null, clampZoomFactor);
  const gesture = useGridDrag(slot);
  const [pickedYarn, setPickedYarn] = useState<string | null>(null);

  const level = board.levels[board.levels.length - 1];
  const all = useMemo(() => gridCards(board), [board]);
  /* Search DIMS here rather than filtering, the Overview's rule: this
   * surface is a spatial arrangement, and hiding half of it would move
   * nothing but would destroy the picture you are looking at. */
  const hit = useMemo(() => {
    if (!query) return null;
    const s = new Set<string>();
    for (const c of all) {
      if (matchesSearch(c.node, 0, 0, query, matchCase, nests)) s.add(c.node.id);
    }
    return s;
  }, [all, query, matchCase, nests]);

  /* CONNECTIONS MODE -- follow the string. With the legend's toggle on
   * and something selected, the selection, its strings, and the cards
   * those strings join stay at full strength; everything else dims,
   * exactly the legend-highlight gesture pointed at yarn. Composes with
   * search below: a card dims if EITHER lens says so. */
  const selIds = useSelectionIds();
  const conn = useMemo(() => {
    if (!connections || !selIds.length) return null;
    const sel = new Set(selIds);
    const lit = new Set(selIds);
    const litEdges = new Set<string>();
    for (const e of liveEdges(board)) {
      if (sel.has(e.from) || sel.has(e.to)) {
        lit.add(e.from);
        lit.add(e.to);
        litEdges.add(e.id);
      }
    }
    return { lit, litEdges };
  }, [connections, selIds, board]);

  /* INSIDE A FRAME THE SHEET HUGS THE CARDS (owner, 2026-09-04: the
   * right-click "brings up the corkboard options in an area that
   * spills off into the corkboard by a bit. Probably it should err the
   * other way into the padding bringing up the frame popup"). The
   * view's usual slack -- eight cells of dotted cork right and left,
   * six above and below -- IS the sheet, so it answered as cork; framed,
   * the slack is the frame's own padding (board/frame.ts, the Padding
   * slider) and the cork box draws the lattice across it seamlessly, so
   * nothing looks different and everything outside the cards is the
   * frame's. */
  const framed = useSettings(boardId).frame;
  const margin = framed ? NO_MARGIN : VIEW_MARGIN_SPAN;
  const extent = useMemo(() => gridExtent(all, margin), [all, margin]);
  /* The view's window starts at the content, not the sheet's origin
   * (state/gridBoard.ts viewOrigin). FROZEN while a gesture is live:
   * the origin moving under a drag would move the very thing being
   * dragged. */
  const bounds = useMemo(() => gridBounds(all), [all]);
  const originRef = useRef(viewOrigin(bounds, margin));
  if (!gesture) originRef.current = viewOrigin(bounds, margin);
  const origin = originRef.current;

  const byId = useMemo(() => new Map(all.map((c) => [c.node.id, c])), [all]);

  /* Yarn, in cells: both ends are a card's pin.
   *
   * IT FOLLOWS A CARD WHILE THE CARD IS STILL MOVING, which is most of
   * what makes the board feel like string rather than like a diagram --
   * pinned things drag their connections with them. The doc has not been
   * written yet at that point (a write per pointermove would be a sync
   * broadcast per frame), so the live offset is added HERE, on top of
   * the committed cells. Recomputing ~80 curves a frame is nothing; the
   * cards themselves are memoized and skip. */
  const moving =
    gesture?.kind === "move" && gesture.moved
      ? { ids: new Set(gesture.ids), dx: gesture.cell.x - gesture.from.x, dy: gesture.cell.y - gesture.from.y }
      : null;
  /* A RESIZE moves the pin too: it sits at the card's top CENTRE, so
   * widening the card slides its knot sideways. Without this the string
   * detaches from the pin for the length of the gesture and snaps back on
   * release, which is exactly the "meets the cork just above its own pin"
   * fault PIN_INSET was introduced to fix -- wearing a different hat. */
  const sizing =
    gesture?.kind === "resize" ? { id: gesture.id, w: gesture.span.w } : null;

  /* THE SHEET DOES NOT GROW UNDER A GESTURE (owner, 2026-09-04: "do
   * away with the live expanding feature while dragging... i don't
   * want the thing to be zooming out while dragging"). It did, from
   * 2026-08-29 to today: the extent followed the live drag so a card
   * carried past the edge grew the sheet under it -- and since the fit
   * watches the content, the whole board rescaled under your hand,
   * which is the zooming out he means. Now the sheet is the COMMITTED
   * extent alone; a card can still be carried as far as the pointer
   * reaches (the gesture is unclamped, below), it simply rides outside
   * the sheet until the release writes its cell, and the extent grows
   * then. The one-time rescale on release is the price he chose over
   * a board that moves while you aim. */
  const sheetW = Math.max(extent.w, 8) * CELL;
  const sheetH = Math.max(extent.h, 6) * CELL;
  const windowW = sheetW - origin.x * CELL;
  const windowH = sheetH - origin.y * CELL;
  const lines: YarnLine[] = useMemo(() => {
    const pin = (c: NonNullable<ReturnType<typeof byId.get>>) => {
      const p = pinOf(c);
      if (sizing?.id === c.node.id) return { x: c.cell.x + sizing.w / 2, y: p.y };
      if (!moving?.ids.has(c.node.id)) return p;
      return { x: p.x + moving.dx, y: p.y + moving.dy };
    };
    return liveEdges(board).flatMap((e) => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) return [];
      const p = pin(a);
      const q = pin(b);
      return [
        {
          id: e.id,
          color: e.color,
          width: e.width,
          x1: p.x,
          y1: p.y,
          x2: q.x,
          y2: q.y,
          dim: conn ? !conn.litEdges.has(e.id) : false,
        },
      ];
    });
  }, [board, byId, moving?.ids, moving?.dx, moving?.dy, sizing?.id, sizing?.w, conn]);

  /* The pointer, in CELLS on the sheet. Every gesture below needs this
   * and none of them should each do the arithmetic. */
  const cellAt = useCallback((clientX: number, clientY: number) => {
    const r = sheet.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    /* The sheet may be inside a scaled wrapper, so divide by the RATIO
     * of painted size to layout size rather than reading a zoom from
     * somewhere -- the measurement is true whatever put it there. */
    const k = r.width / (sheet.current?.offsetWidth || r.width);
    return { x: (clientX - r.left) / k / CELL, y: (clientY - r.top) / k / CELL };
  }, []);

  const cardUnder = useCallback(
    (clientX: number, clientY: number): string | null => {
      const p = cellAt(clientX, clientY);
      // topmost first: document order is paint order, so walk it backwards
      for (let i = all.length - 1; i >= 0; i--) {
        const c = all[i];
        if (
          p.x >= c.cell.x &&
          p.x <= c.cell.x + c.span.w &&
          p.y >= c.cell.y &&
          p.y <= c.cell.y + c.span.h
        ) {
          return c.node.id;
        }
      }
      return null;
    },
    [all, cellAt],
  );

  /* The nearest scrollable ancestor of the sheet -- the surface itself
   * in unscaled Fixed, the zoom wrapper when scaled, nothing in Fit
   * (which is the correct answer there: a fitted board has no slack to
   * pan and no scroll to compensate). */
  const scrollerOf = useCallback((el: HTMLElement | null): HTMLElement | null => {
    let p = el?.parentElement ?? null;
    while (p) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowX + s.overflowY)) return p;
      p = p.parentElement;
    }
    return null;
  }, []);

  /* After an expansion shifted every cell, move the scroll by the same
   * amount (in painted px -- the sheet may be inside a scaled wrapper)
   * so the board does not appear to jump: the origin moved, the eye
   * should not. */
  const compensate = useCallback(
    (shift: { x: number; y: number }) => {
      if (!shift.x && !shift.y) return;
      const sc = scrollerOf(sheet.current);
      if (!sc || !sheet.current) return;
      const k = sheet.current.getBoundingClientRect().width / (sheet.current.offsetWidth || 1);
      sc.scrollLeft += shift.x * CELL * k;
      sc.scrollTop += shift.y * CELL * k;
    },
    [scrollerOf],
  );

  /* ---- the three gestures ---------------------------------------- */

  const onMoveStart = useCallback(
    (e: RPointerEvent, id: string) => {
      const c = byId.get(id);
      if (!c) return;
      const p = cellAt(e.clientX, e.clientY);
      const ids = dragSet(id);
      capture(e.currentTarget as Element, e.pointerId);
      gridDrag.start({
        kind: "move",
        owner: slot,
        ids,
        offX: p.x - c.cell.x,
        offY: p.y - c.cell.y,
        cell: c.cell,
        from: c.cell,
        moved: false,
        dup: e.altKey,
      });
    },
    [byId, cellAt],
  );

  const onResizeStart = useCallback(
    (e: RPointerEvent, id: string) => {
      const c = byId.get(id);
      if (!c) return;
      capture(e.currentTarget as Element, e.pointerId);
      gridDrag.start({ kind: "resize", owner: slot, id, span: c.span });
    },
    [byId],
  );

  const onYarnStart = useCallback(
    (e: RPointerEvent, id: string) => {
      const c = byId.get(id);
      if (!c) return;
      const p = cellAt(e.clientX, e.clientY);
      capture(e.currentTarget as Element, e.pointerId);
      gridDrag.start({ kind: "yarn", owner: slot, from: id, x: p.x, y: p.y, over: null });
    },
    [byId, cellAt],
  );

  /* One move/up pair on the WINDOW rather than per gesture: the pointer
   * leaves the card almost immediately in all three, and capture alone
   * does not help the yarn gesture, which has to notice what it is over. */
  /* The last pointer position, for the edge auto-pan below: scrolling
   * moves the sheet under a stationary pointer, and no pointermove fires
   * for that -- the pan loop re-applies the gesture at the remembered
   * position after each scroll step. A REF, not an effect local, and the
   * difference was a shipped-for-an-hour bug: the gesture effect re-runs
   * on every gridDrag.update (each pointermove mints a new gesture
   * object), so an effect-local reset `seen` to false every frame -- and
   * a pointer PARKED at the edge, the exact case auto-pan exists for,
   * sends no further moves to set it back. */
  const lastPointer = useRef({ x: 0, y: 0, alt: false, seen: false });
  useEffect(() => {
    if (!gesture) {
      lastPointer.current.seen = false;
      return;
    }
    const last = lastPointer.current;
    const applyAt = (clientX: number, clientY: number, altKey: boolean) => {
      const g = ownGesture(slot);
      if (!g) return;
      const p = cellAt(clientX, clientY);
      if (g.kind === "move") {
        /* UNCLAMPED, in Fit as in Fixed: past the top-left edge is how
         * you ask the board to grow that way (state/gridBoard.ts
         * landCells), and past any edge in Fit the drop grows the sheet
         * and Fit re-fits (owner, 2026-09-04: "as far as our mouse can
         * carry us"). A governor that held a Fit drag to a step was
         * tried the same day and taken out. The release decides what is
         * written; the doc never sees a negative. */
        const next = roundCell({ x: p.x - g.offX, y: p.y - g.offY });
        const moved =
          g.moved ||
          Math.abs(next.x - g.from.x) * CELL > DRAG_SLOP ||
          Math.abs(next.y - g.from.y) * CELL > DRAG_SLOP;
        /* The drag is real from here. NOW apply the app's rule that
         * dragging an unselected card drops any group -- doing it on
         * pointerdown would wipe a selection a Cmd-click is about to
         * extend (see dragSet). */
        if (moved && !g.moved && g.ids.length === 1) select(g.ids[0], "single");
        if (next.x !== g.cell.x || next.y !== g.cell.y || moved !== g.moved || altKey !== g.dup) {
          gridDrag.update({ cell: next, moved, dup: altKey });
        }
      } else if (g.kind === "resize") {
        const c = byId.get(g.id);
        if (!c) return;
        const span = clampSpan({ w: p.x - c.cell.x, h: p.y - c.cell.y });
        if (span.w !== g.span.w || span.h !== g.span.h) gridDrag.update({ span });
      } else {
        const over = cardUnder(clientX, clientY);
        gridDrag.update({ x: p.x, y: p.y, over: over === g.from ? null : over });
      }
    };
    const onMove = (ev: PointerEvent) => {
      last.x = ev.clientX;
      last.y = ev.clientY;
      last.alt = ev.altKey;
      last.seen = true;
      applyAt(ev.clientX, ev.clientY, ev.altKey);
    };
    /* ESCAPE ABANDONS THE GESTURE (owner, 2026-08-29) -- the card snaps
     * home, the string vanishes, nothing is written. Capture phase and
     * stopped, so keyNav's Escape does not ALSO clear the selection you
     * were dragging. The yarn menu made this promise first. */
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (!ownGesture(slot)) return;
      ev.stopPropagation();
      gridDrag.end();
    };
    /* EDGE AUTO-PAN, the Beat Map's drag auto-scroll arriving here: a
     * card held near the pane's edge scrolls the board under it. rAF
     * rather than relying on pointermove, which goes quiet the moment
     * the pointer stops at the edge -- exactly when panning should
     * continue. */
    let raf = 0;
    const EDGE = 32;
    const PAN_MAX = 14;
    const pan = () => {
      raf = requestAnimationFrame(pan);
      if (!last.seen) return;
      const sc = scrollerOf(sheet.current);
      if (!sc) return;
      const r = sc.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (last.x < r.left + EDGE) dx = -Math.min(PAN_MAX, (r.left + EDGE - last.x) / 2);
      else if (last.x > r.right - EDGE) dx = Math.min(PAN_MAX, (last.x - (r.right - EDGE)) / 2);
      if (last.y < r.top + EDGE) dy = -Math.min(PAN_MAX, (r.top + EDGE - last.y) / 2);
      else if (last.y > r.bottom - EDGE) dy = Math.min(PAN_MAX, (last.y - (r.bottom - EDGE)) / 2);
      if (!dx && !dy) return;
      const beforeL = sc.scrollLeft;
      const beforeT = sc.scrollTop;
      sc.scrollLeft += dx;
      sc.scrollTop += dy;
      // the sheet moved under the pointer; re-run the gesture there
      if (sc.scrollLeft !== beforeL || sc.scrollTop !== beforeT) applyAt(last.x, last.y, last.alt);
    };
    raf = requestAnimationFrame(pan);
    const onUp = (up: PointerEvent) => {
      if (!ownGesture(slot)) return; // another column's drag is not ours to end
      const g = gridDrag.end();
      if (!g) return;
      /* THE DOC IS WRITTEN ONCE, HERE. Everything above is live paint --
       * a write per pointermove would be a sync broadcast per frame, and
       * would make one drag a hundred undo steps. */
      if (g.kind === "move") {
        if (!g.moved) return; // a click, not a drag
        const dx = g.cell.x - g.from.x;
        const dy = g.cell.y - g.from.y;
        /* THE BOARD EXPANDS IN ANY DIRECTION (owner, 2026-08-29): a
         * release past the top-left goes through landCells, which shifts
         * EVERY card so the newcomer lands at zero -- the doc's cells
         * stay non-negative -- and the scroll compensates by the same
         * amount so nothing appears to move. Right and down always
         * worked (the sheet just grows); this is the other two ways. */
        /* OPTION-DRAG DUPLICATES (owner, 2026-08-27), the same gesture the
         * Beat Map has had since the split view -- and the same op, so it
         * is one undo step. THE MODIFIER IS READ AT RELEASE (`up.altKey`
         * over the tracked flag): you can decide either way mid-drag,
         * which is the rule board/drag.ts already states. */
        if (up.altKey || g.dup) {
          /* copyNodes hands back the ids it minted, in the order it took
           * them, so the copies can be placed without diffing the board. */
          /* IN DOCUMENT ORDER, because that is the order copyNodes hands
           * the new ids back in -- it walks the board, not the selection.
           * Pairing against Cmd-click order put each copy at another
           * card's target whenever the selection was built out of order
           * (found in the 2026-09-01 audit). */
          const picked = new Set(g.ids);
          const inOrder = all.filter((c) => picked.has(c.node.id)).map((c) => c.node.id);
          const made = ops.copyNodes(inOrder, null, board.roots.length, boardId);
          /* The copies land where the drag ENDED and the originals stay
           * exactly where they were -- which is the whole point of the
           * gesture, and why nothing here hides the source. */
          const targets = new Map<string, { x: number; y: number }>();
          made.forEach((id, i) => {
            const src = byId.get(inOrder[i]);
            if (src) targets.set(id, { x: src.cell.x + dx, y: src.cell.y + dy });
          });
          if (targets.size) {
            const landed = landCells(all, targets);
            ops.setNodeCells(landed.cells);
            compensate(landed.shift);
          }
          return;
        }
        const targets = new Map<string, { x: number; y: number }>();
        for (const id of g.ids) {
          const c = byId.get(id);
          if (c) targets.set(id, { x: c.cell.x + dx, y: c.cell.y + dy });
        }
        const land = landCells(all, targets);
        ops.setNodeCells(land.cells);
        compensate(land.shift);
        /* A CARD DRAGGED ONTO ANOTHER ONE ENDS UP ON TOP, like a physical
         * card (owner, 2026-08-26). Paint order is document order, so
         * that is a reorder to the end -- see gridBoard.ts `cardsOverlap`.
         *
         * ONLY WHEN IT ACTUALLY LANDS ON SOMETHING (his call): document
         * order is also the order Notes view and search walk the board,
         * so a drag into empty cork must not churn it. The moved cards
         * keep their own relative order, which is what passing them in
         * document order to moveNodes does. */
        const moved = new Set(g.ids);
        const landed = all.map((c) =>
          moved.has(c.node.id)
            ? { ...c, cell: { x: c.cell.x + dx, y: c.cell.y + dy } }
            : c,
        );
        if (overlappedBy(landed, moved).length) {
          const inOrder = all.filter((c) => moved.has(c.node.id)).map((c) => c.node.id);
          ops.moveNodes(inOrder, null, board.roots.length, boardId);
        }
      } else if (g.kind === "resize") {
        ops.setNodeSpan(g.id, g.span);
      } else if (g.over) {
        ops.addEdge(boardId, g.from, g.over);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
    };
    /* KEYED ON THE GESTURE'S KIND, NOT ITS IDENTITY, and this is the
     * auto-pan's second real bug (owner: "isn't working on my end"): a
     * real mouse streams pointermove faster than frames, every move
     * mints a new gesture object via gridDrag.update, and an effect
     * keyed on the object tore down and re-armed the rAF loop on every
     * one -- cancelled before it ever fired, for the whole drag. The
     * kind is constant for a gesture's lifetime, and every handler here
     * reads the live gesture from the store, not from this closure. The
     * synthetic verification never caught it because it dispatched ONE
     * move and went quiet -- the exact rhythm a real hand never has. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gesture?.kind, byId, cellAt, cardUnder, boardId, all, board, compensate, scrollerOf, slot]);

  /* ---- MARQUEE: drag on bare cork rubber-bands a selection --------- *
   * The gesture every spatial tool trains, and it was free: a plain
   * press on cork was only ever a click (clear), and hold-space already
   * owns panning. Shift (or Cmd/Ctrl) held at the START adds to the
   * selection instead of replacing it; Escape abandons the band and
   * puts the prior selection back. Selection updates LIVE so the cards
   * light as the band crosses them.
   *
   * IT STARTS ANYWHERE IN THE PANE THAT IS NOT A THING (owner,
   * 2026-09-11: "we have to be able to lasso drag from off the board
   * more. especially when it looks like an infinite canvas but really
   * anywhere in the canvas part of the pane should be able to create a
   * box"). It used to start on the SHEET only -- and zoomed out, or
   * framed, the sheet is a box with the pane's own surface showing
   * around it, which looks like more cork and took nothing. So the
   * handler listens at the ZOOM VIEWPORT (GridScale's `.grid-zoom`, the
   * pane-level box the scaled board sits inside, whose background is the
   * wall) -- found from here as an ancestor, so nothing has to be
   * threaded through the frame and the scaler -- and what decides
   * whether a press begins a band is not which layer it landed on but
   * whether it landed on anything interactive: a card, a pin, a string,
   * a control. The band's cells can go negative or past the sheet; the
   * hit test does not care, and the drawn box paints past the sheet
   * (nothing between it and the viewport clips), which is fine. A
   * native listener, since the viewport is not this component's
   * element. SPACE HELD IS A PAN, NEVER A BAND (2026-09-11): spacePan
   * takes the press first only when something under the pointer
   * actually scrolls, and a board that fits its pane has no such thing,
   * so without this check a Space-drag from the wall drew a lasso. */
  const startMarquee = useCallback(
    (e: PointerEvent) => {
      if (e.button !== 0 || spacePan.armed()) return;
      const t = e.target as Element;
      if (t.closest('[data-node], .grid-pin, .yarn-hit, button, input, textarea, select, [contenteditable="true"], .float-panel, .options-panel')) return;
      setPickedYarn(null);
      const start = cellAt(e.clientX, e.clientY);
      const startClient = { x: e.clientX, y: e.clientY };
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      const prior = selection.ids();
      let began = false;
      const move = (ev: PointerEvent) => {
        if (
          !began &&
          Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) < DRAG_SLOP
        ) {
          return;
        }
        began = true;
        const now = cellAt(ev.clientX, ev.clientY);
        const x = Math.min(start.x, now.x);
        const y = Math.min(start.y, now.y);
        const w = Math.abs(now.x - start.x);
        const h = Math.abs(now.y - start.y);
        setMarquee({ x, y, w, h });
        const hits = all
          .filter(
            (c) =>
              c.cell.x < x + w &&
              x < c.cell.x + c.span.w &&
              c.cell.y < y + h &&
              y < c.cell.y + c.span.h,
          )
          .map((c) => c.node.id);
        const ids = additive ? [...new Set([...prior, ...hits])] : hits;
        /* THE LASSO ANCHORS (owner-reported 2026-09-11: "when i lasso
         * cards in Free Grid, and then i hit delete, they do not delete,
         * even if it's just one card"). keyNav bails on every key when
         * the selection has no anchor -- it is where the cursor stands
         * -- and this used to set none, so Delete, n, m, Space and the
         * arrows all waited for a click. The last card the band caught
         * is the anchor, the way the last card clicked would be. */
        if (ids.length) selection.set(ids, ids[ids.length - 1], 0);
        else if (!additive) selection.clear();
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("keydown", key, true);
        setMarquee(null);
      };
      const up = () => {
        finish();
        /* Never crossed the slop: this was the plain click on cork it
         * has always been -- clear the selection. */
        if (!began && !additive) selection.clear();
      };
      const key = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.stopPropagation();
        began = true; // the up must not then clear as a click
        selection.set(prior, prior.length ? prior[prior.length - 1] : null, prior.length ? 0 : null);
        finish();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("keydown", key, true);
    },
    [all, cellAt],
  );

  useEffect(() => {
    const host: HTMLElement | null = surface.current?.closest(".grid-zoom") ?? surface.current;
    if (!host) return;
    host.addEventListener("pointerdown", startMarquee);
    return () => host.removeEventListener("pointerdown", startMarquee);
  }, [startMarquee]);

  /* ---- adding, and pictures --------------------------------------- */

  const addAt = useCallback(
    (cell: { x: number; y: number }, image?: string) => {
      const id = ops.addRoot(boardId);
      if (!id) return "";
      const c = clampCell({
        x: cell.x - DEFAULT_SPAN.w / 2,
        y: cell.y - DEFAULT_SPAN.h / 2,
      });
      ops.setNodeCells({ [id]: c });
      /* NO SPAN. An absent one already means "the default" (spanOf), and
       * leaving it absent is what makes `span` mean something: SOMEBODY
       * CHOSE THIS SIZE. Writing the default here made that test useless
       * -- every card had a span, so dropping a photo onto one could
       * never tell a deliberate size from an untouched one, and portrait
       * pictures kept getting cropped into a landscape box. */
      if (image) {
        ops.setNodeImage(id, image);
        sitNewPicture(id);
      } else openNew(id);
      return id;
    },
    [boardId],
  );

  const takeImage = useCallback(
    async (file: File, cell: { x: number; y: number }, onto: string | null) => {
      const r = await toCardImage(file);
      if (!r.ok) {
        await confirmDialog.tell("That image could not be pinned", r.reason);
        return;
      }
      if (onto) {
        const had = pictureOn(onto);
        ops.setNodeImage(onto, r.dataUri);
        if (!had) sitNewPicture(onto);
        /* A picture wants the card's SHAPE, or a portrait photo sits in
         * a landscape box with bars either side. Only on a card that has
         * not been given a size by hand -- resizing is a decision, and
         * this must not undo one. */
        /* Reshape to the picture's own aspect -- but only when nobody
         * has sized this card by hand. Resizing is a decision and a
         * pasted photo must not undo one. */
        const node = byId.get(onto)?.node;
        if (node && !node.span) {
          const long = DEFAULT_SPAN.w + 1;
          const ratio = r.w / r.h;
          const span =
            ratio >= 1
              ? { w: long, h: Math.round(long / ratio) }
              : { w: Math.round(long * ratio), h: long };
          ops.setNodeSpan(onto, clampSpan(span));
        }
      } else {
        const id = addAt(cell, r.dataUri);
        if (id) {
          const long = DEFAULT_SPAN.w + 1;
          const ratio = r.w / r.h;
          ops.setNodeSpan(
            id,
            clampSpan(
              ratio >= 1
                ? { w: long, h: Math.round(long / ratio) }
                : { w: Math.round(long * ratio), h: long },
            ),
          );
        }
      }
    },
    [addAt, byId],
  );

  /* Paste a picture onto the selected card, or onto the board. Scoped to
   * this panel having the keyboard, so a paste in the other pane is not
   * stolen. */
  useEffect(() => {
    if (!hasKeyboard) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const file = imageFrom(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      const sel = selection.ids();
      const onto = sel.length === 1 && byId.has(sel[0]) ? sel[0] : null;
      void takeImage(file, { x: 2, y: 2 }, onto);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [hasKeyboard, byId, takeImage]);

  /* HOW A CARD GETS MADE HERE: right-click the bare cork
   * (board/grid/canvasMenu.ts), or double-click it for the fast path.
   *
   * A hover GHOST used to answer this -- a dashed card outline with a
   * `+` that followed the cursor round the lattice -- and the owner cut
   * it (2026-08-26: "I don't like the + signs being gridded out. I think
   * it's a right click menu. anywhere on the blank canvas."). The menu
   * carries the CELL as well as the point, because by the time an item
   * is picked the board may have scrolled under it. */
  /* WHERE CMD-V WILL PASTE (canvasMenu.ts `rememberPoint`). Recorded in
   * the CAPTURE phase on purpose: a card's own contextmenu calls
   * stopPropagation, so a bubble-phase listener here would only ever see
   * right-clicks on bare cork -- and pointing at a card is still
   * pointing at a spot. */
  const notePoint = useCallback(
    (e: RMouseEvent) => {
      const p = cellAt(e.clientX, e.clientY);
      rememberPoint(
        boardId,
        clampCell({ x: p.x - DEFAULT_SPAN.w / 2, y: p.y - DEFAULT_SPAN.h / 2 }),
      );
    },
    [boardId, cellAt],
  );

  /* BARE CORK IS THE WINDOW'S OWN SURFACE OR THE SHEET'S (2026-09-11):
   * the double-click and the right-click menu listen on `.grid-window`,
   * not the sheet, because the sheet no longer covers the window. With
   * a negative view origin (gridBoard.ts viewOrigin, the margin before
   * cell zero) the sheet sits INSET in the window, and the strip of
   * margin on the left and top is window with no sheet under it -- a
   * press there used to reach no handler at all: no card from a
   * double-click, and no menu of any kind from a right-click (the audit
   * of 2026-09-11 found it on the first converted board). A press on a
   * card still stops at the card; this only asks whether the press hit
   * nothing but cork, whichever of the two boxes drew it. */
  const bareCork = (e: RMouseEvent): boolean => e.target === e.currentTarget || e.target === sheet.current;
  /* THE SHEET CAN ALSO REACH PAST THE WINDOW on the left and top (its
   * box starts at cell 0, and framed the window hugs the content), so a
   * point outside the window's box is over the frame's padding, its band
   * or the wall -- the frame's business when there is one, nobody's
   * otherwise. */
  const outsideWindow = (e: RMouseEvent): boolean => {
    const w = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX < w.left || e.clientX > w.right || e.clientY < w.top || e.clientY > w.bottom;
  };
  const openCanvasMenu = useCallback(
    (e: RMouseEvent) => {
      if (!bareCork(e)) return; // a card's own menu, not this
      e.preventDefault();
      if (outsideWindow(e)) {
        if (framed) frameMenu.open({ boardId, x: e.clientX, y: e.clientY });
        return;
      }
      const p = cellAt(e.clientX, e.clientY);
      canvasMenu.open({
        boardId,
        // centered on the click, which is where the eye expects the card
        cell: clampCell({ x: p.x - DEFAULT_SPAN.w / 2, y: p.y - DEFAULT_SPAN.h / 2 }),
        x: e.clientX,
        y: e.clientY,
      });
    },
    [boardId, cellAt, framed],
  );

  const yarnLine: YarnLine | null =
    gesture?.kind === "yarn"
      ? (() => {
          const a = byId.get(gesture.from);
          if (!a) return null;
          const p = pinOf(a);
          const target = gesture.over ? byId.get(gesture.over) : null;
          const q = target ? pinOf(target) : { x: gesture.x, y: gesture.y };
          return { id: "pulling", color: "#c0392b", x1: p.x, y1: p.y, x2: q.x, y2: q.y };
        })()
      : null;

  return (
    <div
      ref={surface}
      className={"grid-surface" + (fitted ? " grid-fitted" : "")}
      data-kbd={hasKeyboard ? "on" : undefined}
      /* A CARD FROM ANOTHER BOARD CAN BE DROPPED HERE (owner,
         2026-09-01). This type had no card drop at all -- its only
         handler was for image FILES -- so a grid board was cut out of
         the split view's master-to-section workflow, which is the thing
         the whole team uses daily.
         Only INBOUND: a grid card has no HTML5 drag source, because it
         moves with pointer events, and giving it one would put two drag
         systems on one element. Dragging OUT stays cut-and-paste, which
         is the owner's call and the honest route.
         `acceptsOne` at depth 0 is the shared rule -- the grid's only
         rung -- so height matching, the nesting-card exception and the
         overtops case all come for free rather than being restated. */
      onDragOver={(e) => {
        if (imageFrom(e.dataTransfer)) {
          e.preventDefault();
          return;
        }
        const item = dragStore.get();
        if (!item || item.boardId === boardId || !acceptsOne(item, boardId, 0)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        const file = imageFrom(e.dataTransfer);
        if (file) {
          e.preventDefault();
          void takeImage(file, cellAt(e.clientX, e.clientY), cardUnder(e.clientX, e.clientY));
          return;
        }
        const item = dragStore.get();
        if (!item || item.boardId === boardId || !acceptsOne(item, boardId, 0)) return;
        e.preventDefault();
        /* Selection-aware, the same rule dropMove keeps: a drag carries
           the whole selection when the grabbed card is part of it. */
        const ids =
          selection.has(item.id) && selection.size() > 1 ? selection.ids() : [item.id];
        const made = ops.copyNodes(ids, null, board.roots.length, boardId);
        if (!made.length) return;
        /* Land them AT the pointer, walking right -- a grid has a
           position under every pixel, so there is no insertion point to
           publish and nothing to draw. CLAMPED FIRST (the 2026-09-11
           audit): the view keeps a margin before cell zero, and a drop
           there handed the sink cells at -20, -13, -6, ... which it
           clamped one by one to column zero, so every card of a
           multi-card drop stacked on the first. The walk starts from
           the clamped cell instead, the way every other placement path
           already asks clampCell at its own call site. */
        const at = clampCell(cellAt(e.clientX, e.clientY));
        const cells: Record<string, Cell> = {};
        made.forEach((id, i) => {
          cells[id] = { x: at.x + i * (DEFAULT_SPAN.w + 1), y: at.y };
        });
        ops.setNodeCells(cells);
        dragStore.end();
      }}
    >
      {/* THE WINDOW: what the scroller (or the Fit scaler) sees. The
          sheet keeps its absolute size from cell (0,0) so every cell
          coordinate stays true, and sits inside this box offset by the
          view origin, so the box starts at the content. `min-width` on
          the sheet reaches past the offset so the cork's dots fill a
          window wider than the sheet. */}
      <div
        className="grid-window"
        style={{ width: windowW, height: windowH, "--cell": `${CELL}px` } as CSSProperties}
        /* on the WINDOW, not the sheet -- see bareCork above */
        onContextMenuCapture={notePoint}
        onContextMenu={openCanvasMenu}
        onDoubleClick={(e) => {
          if (!bareCork(e) || outsideWindow(e)) return;
          addAt(cellAt(e.clientX, e.clientY));
        }}
      >
      <div
        className="grid-sheet"
        ref={sheet}
        style={
          {
            width: sheetW,
            height: sheetH,
            left: -origin.x * CELL,
            top: -origin.y * CELL,
            minWidth: `calc(100% + ${origin.x * CELL}px)`,
            minHeight: `calc(100% + ${origin.y * CELL}px)`,
            "--cell": `${CELL}px`,
          } as CSSProperties
        }
      >
        <Yarn
          lines={lines}
          pulling={yarnLine}
          selected={pickedYarn}
          width={sheetW}
          height={sheetH}
          onPick={(id, x, y) => {
            setPickedYarn(id);
            yarnMenu.open({ boardId, edgeId: id, x, y });
          }}
        />
        {all.map((c) => (
          <div
            key={c.node.id}
            className={
              "grid-slot" +
              ((hit && !hit.has(c.node.id)) || (conn && !conn.lit.has(c.node.id)) ? " dim" : "")
            }
          >
            <GridCard
              card={c.node}
              level={level}
              x={c.cell.x}
              y={c.cell.y}
              onMoveStart={onMoveStart}
              onResizeStart={onResizeStart}
              yarnTarget={gesture?.kind === "yarn" && gesture.over === c.node.id}
            />
          </div>
        ))}
        {/* THE PINS ARE THEIR OWN LAYER, above the yarn (Pins.tsx says
            why a card cannot deliver that from the inside). Rendered
            after the cards so it is last in DOM order too, though the
            z-index is what actually decides. */}
        <Pins cards={all} random={settings.pushpinColor === "random"} onYarnStart={onYarnStart} />
        {marquee && (
          /* THE DRAWN BAND STOPS AT THE SHEET (the 2026-09-11 audit).
             The marquee can begin anywhere in the zoom viewport -- the
             margin, the frame's band, the wall -- and nothing between
             the sheet and `.grid-zoom` clips (`.grid-fitted` is
             `overflow: visible` on purpose, and the sheet reaches past
             the window in the framed case), so the band painted over
             the frame and the wall. The RECT is clamped here, to the
             sheet's box where it lies inside the window (the sheet's
             edge unframed; the window's, framed, since a sheet whose
             content starts past cell zero reaches left of and above
             the window there). The HIT TEST above keeps the unclamped
             cells: a band begun in the margin must still catch the
             cards it crosses. */
          (() => {
            const x0 = Math.max(0, origin.x);
            const y0 = Math.max(0, origin.y);
            const x1 = sheetW / CELL;
            const y1 = sheetH / CELL;
            const left = Math.min(Math.max(marquee.x, x0), x1);
            const top = Math.min(Math.max(marquee.y, y0), y1);
            const right = Math.min(Math.max(marquee.x + marquee.w, x0), x1);
            const bottom = Math.min(Math.max(marquee.y + marquee.h, y0), y1);
            return (
              <div
                className="grid-marquee"
                style={{
                  left: left * CELL,
                  top: top * CELL,
                  width: (right - left) * CELL,
                  height: (bottom - top) * CELL,
                }}
              />
            );
          })()
        )}
        {all.length === 0 && (
          <div className="grid-empty">
            Right-click the board to pin a card.
            <span>Or double-click it. Drop an image on it to pin one with a photo.</span>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

export { SPAN_MIN, SPAN_MAX, spanOf };
