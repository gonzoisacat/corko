import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { DEFAULT_CARD_SPACING } from "../state/types";
import type { Board } from "../state/types";
import { fold } from "../state/fold";
import type { Match } from "../state/search";
import { keyCursor } from "./keyNav";
import { select, selection } from "./selection";
import { pasteValues } from "./cardPanels";
import { bulkTag, findReplace } from "./bulkSearch";
import { useSettings } from "../state/settings";
import { ops, useBoardIndex } from "../state/useBoard";
import { clearImageTarget, draggingImage, imageTargetAt, markImageTarget } from "./imageDrop";
import { imageFrom, toCardImage, pictureOn, sitNewPicture } from "./cardImage";
import { confirmDialog } from "../ui/confirmDialog";
import { lookAttrs } from "./lookScope";
import { BoardUIContext } from "./context";
import { paneFocus, usePaneFocus, type PaneSlot } from "./paneFocus";
import { BoardView } from "./BoardView";
import { matchesSearch } from "./flatten";
import { KanbanZoom } from "./kanban/KanbanView";
import { ZoomControls } from "./PaneBar";
import { GridZoom } from "./grid/GridScale";
import { LegendBar } from "./LegendBar";
import type { DrivingInfo } from "./DrivingWheel";
import { PaneBar } from "./PaneBar";
import { OverviewView } from "./overview/OverviewView";

export type PaneView = "detail" | "overview";

/* What a sibling pane (or App) can ask of a pane. */
export interface BoardPaneHandle {
  boardId: string | null;
  view: PaneView;
  /* This panel's search, lowercased -- a live getter, not a snapshot, so
   * the keyboard can read it per keypress without the handle (and the
   * effect that registers the key listener) re-making itself on every
   * character typed. The cursor must walk only the cards the panel is
   * SHOWING, and each panel filters itself now. */
  readonly query: string;
  readonly matchCase: boolean; // the search bar's Aa toggle, same reasoning
  /* Reveal + scroll to a node, without changing which view is showing
   * -- in EITHER view. Returns whether it acted, so a caller can fall
   * back to its own pane. */
  scrollToNode(id: string): boolean;
  /* Switch to detail, reveal the node's ancestors and scroll to it. */
  showNode(id: string): boolean;
  /* Overview only: mirror a cursor move into a linked Detail pane on the
   * same board, exactly as a single click does. The keyboard is a way of
   * selecting, so the panels stay linked however you select. */
  followSelect(id: string): void;
  /* What a DOUBLE-click does, for the keyboard's Enter: prefer a linked
   * Detail panel on this board, else turn this pane into the detail
   * view. Distinct from showNode, which is how a SIBLING is steered. */
  jumpToNode(id: string): void;
}

/* ------------------------------------------------------------------ *
 *  One board pane: a board + how this panel is looking at it. All the
 *  view state that used to sit in App lives here -- which board, detail
 *  vs Overview, the Overview's zoom + column tier, and the scroll-to-node
 *  command -- so App can render one pane or two (the split view) without
 *  either panel reaching into the other's state.
 *
 *  Panes talk to each other only through App, via the imperative handle
 *  (scroll me here) and the `onOverviewSelect` / `onOverviewJump`
 *  callbacks (an Overview panel driving a Detail panel). Everything
 *  else they share is already global: the Yjs doc, the fold set, the
 *  selection, the clipboard.
 * ------------------------------------------------------------------ */
export const BoardPane = forwardRef<BoardPaneHandle, {
  board: Board | null;
  /* Which panel this is. Whether it holds the keyboard is read here
   * (paneFocus.ts, follows mouse-down) rather than passed: the pane needs
   * it for more than a mark now -- the Overview's preview follows the
   * keyboard cursor, and only the focused panel's should. `twoUp` gates
   * the MARK alone: with one panel there's nothing to disambiguate. */
  slot: PaneSlot;
  twoUp?: boolean;
  /* Everything the steering wheel needs. Shared arrangement state
   * (state/panes.ts) rather than this panel's, because "do these two
   * affect each other" is a fact about the PAIR. */
  driving?: DrivingInfo;
  /* Detail vs Overview is controlled by App -- it belongs to the pane, but
   * App persists the whole panel arrangement (state/panes.ts) so a reload
   * brings your panels back the way you left them. */
  view: PaneView;
  onView: (v: PaneView) => void;
  onSelectBoard: (id: string) => void;
  /* OPEN A BOARD BESIDE THIS ONE (owner, 2026-09-11, for Convert board
   * type): in the OTHER pane when the view is already split, else in a
   * new split with this pane's board on the left and the new one on
   * the right. App's `nestActions.beside` is that rule already -- the
   * nested-board popover's "beside" answer -- so this is the same
   * function handed down, never a second statement of it. */
  onOpenBeside: (id: string) => void;
  /* Overview single-click: give a sibling Detail pane on the same board a
   * chance to scroll there instead (returns true if one did). */
  onOverviewSelect?: (id: string) => boolean;
  /* Overview double-click: same, but the fallback is this pane switching
   * to detail itself. */
  onOverviewJump?: (id: string) => boolean;
}>(function BoardPane(
  { board, slot, twoUp, driving, view, onView, onSelectBoard, onOpenBeside, onOverviewSelect, onOverviewJump },
  ref,
) {
  const hasKeyboard = usePaneFocus() === slot;
  /* PER PANEL (owner's call, 2026-08-03): find is used as a flexible tag
   * filter, so a split view wants two different ones at once. Deliberately
   * NOT persisted -- a filter is what you're doing right now, unlike which
   * board a panel shows (state/panes.ts). */
  const [rawQuery, setRawQuery] = useState("");
  /* CONNECTIONS MODE (Free Grid) -- the legend's toggle. Per pane and
   * per session like the query: a way of reading the board right now. */
  const [connections, setConnections] = useState(false);
  /* NOT lowercased any more -- the Aa toggle needs the query as typed, and
   * `hit` folds case itself when the toggle is off. */
  const query = rawQuery.trim();
  const [matchCase, setMatchCase] = useState(false);
  const [columnDepth, setColumnDepth] = useState(0); // which tier is an Overview column
  // ...and how deep it draws inside one (null = all the way to the leaf)
  const [detailDepth, setDetailDepth] = useState<number | null>(null);
  // Overview zoom lives here so it survives a detour through the detail
  // view (and stays this panel's own in the split view). `manual` marks
  // the user having overridden fit-to-screen.
  const [zoom, setZoom] = useState(1);
  const [manual, setManual] = useState(false);
  /* The FIXED view's zoom, on a board type that has one (Columns). Its
   * own number rather than the Overview's: that one carries
   * fit-to-screen state (`manual`) and gets recomputed on mount, which
   * would fight a scale you set by hand in the other mode. */
  /* A typed board's zoom is a FACTOR over its fit (useWheelZoom.ts):
   * 1 means the whole board, whatever the pane's size. Per pane and per
   * session. */
  const [zoomFactor, setZoomFactor] = useState(1);
  // scroll-to-node command; `n` re-fires a repeat jump to the same node
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);

  // stable refs so the callbacks below never change identity (they feed
  // memoized proxies + the imperative handle)
  const boardRef = useRef(board);
  boardRef.current = board;
  const viewRef = useRef(view);
  viewRef.current = view;
  const queryRef = useRef(query);
  queryRef.current = query;
  const caseRef = useRef(matchCase);
  caseRef.current = matchCase;
  // read through a ref: the handle must not re-make itself every time App
  // hands down a new callback identity
  const selectCb = useRef(onOverviewSelect);
  selectCb.current = onOverviewSelect;
  // the double-click path, hoisted out of render order for the same reason
  const jumpRef = useRef<(id: string) => void>(() => {});

  /* This panel's own root, so "scroll to that card" finds THIS panel's
   * copy of it. `document.querySelector` returns the first in DOM order,
   * which in a split showing one board in both panels is always panel A
   * -- so stepping a search in B scrolled A. */
  const paneRef = useRef<HTMLElement>(null);
  /* Scroll a card into view in a renderer that is NOT virtualized: find
   * the element and ask it. Every board type but the Beat Map mounts all
   * of its cards, and so does the Overview. */
  const scrollHere = useCallback((id: string) => {
    paneRef.current
      ?.querySelector(`[data-node="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);

  const reveal = useCallback((id: string) => {
    // unfold the target's ancestors first, or its row won't exist to scroll to
    if (boardRef.current) fold.reveal(boardRef.current, id);
    setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  }, []);

  /* CLEARING THE FILTER KEEPS YOUR PLACE (owner, 2026-09-04: "select a
   * card, then if you close the find a card entry (hit x) [I'd like]
   * the focus [to remain] on the card that had been selected once the
   * full board comes back"). The selection itself survives -- it is a
   * store, not the list -- but the full board's rows come back around
   * it and the card lands wherever the scroll happens to be. So when
   * the query goes from something to nothing, the selected card is
   * revealed once the rows have been rebuilt: same route a search step
   * takes, one render later. */
  const revealOnClear = useRef<string | null>(null);
  const onQuery = useCallback((q: string) => {
    if (!q.trim() && queryRef.current) revealOnClear.current = selection.anchor() ?? selection.ids()[0] ?? null;
    setRawQuery(q);
  }, []);
  useEffect(() => {
    if (query) return;
    const id = revealOnClear.current;
    if (!id) return;
    revealOnClear.current = null;
    reveal(id);
  }, [query, reveal]);

  /* ...AND THE TYPED BOARDS ACT ON IT, which they did not.
   *
   * `focus` is BoardView's command -- it maps a node to a virtualized ROW
   * INDEX -- and it was passed to BoardView alone. A Free Grid or a
   * Columns board in Fixed mode is also `view === "detail"`, so every
   * route that means "take me to that card" went through `reveal`, wrote
   * a focus nothing was listening to, and scrolled nowhere: a Notes-view
   * click, a search step, a driven sibling panel. `scrollToNode` still
   * answered TRUE, so the caller believed it had happened -- the same
   * shape of lie `steerSibling` returns false to avoid.
   *
   * These renderers mount every card, so there is no row index to find
   * and nothing to unfold; the element is simply there to be asked. */
  useEffect(() => {
    if (!focus || !boardRef.current?.type || viewRef.current !== "detail") return;
    scrollHere(focus.id);
  }, [focus, scrollHere]);

  useImperativeHandle(
    ref,
    (): BoardPaneHandle => ({
      boardId: board?.id ?? null,
      view,
      get query() {
        return queryRef.current;
      },
      get matchCase() {
        return caseRef.current;
      },
      /* WORKS IN THE OVERVIEW TOO (owner, 2026-09-01). It used to bail
       * there -- "nothing to scroll to" -- which was true of the very
       * first Overview and stopped being true once it got its own
       * scrolling viewport. Every proxy is mounted, so the element is
       * simply there to be asked, exactly as it is on a grid or a
       * Columns board.
       *
       * It never changes the VIEW, which is the whole point of it
       * existing beside `showNode`: taking somebody to a card should not
       * decide for them how they are looking at the board. */
      scrollToNode(id) {
        if (!boardRef.current) return false;
        if (viewRef.current === "detail") {
          reveal(id);
          return true;
        }
        scrollHere(id);
        return true;
      },
      showNode(id) {
        if (!boardRef.current) return false;
        onView("detail");
        reveal(id);
        return true;
      },
      followSelect(id) {
        if (viewRef.current === "overview") selectCb.current?.(id);
      },
      jumpToNode(id) {
        jumpRef.current(id);
      },
    }),
    [board?.id, view, reveal, onView, scrollHere],
  );

  // Overview -> detail navigation. Single click: let a sibling detail pane
  // on this board follow along (the linked panels). Double click: jump,
  // preferring the sibling, else turn this pane into the detail view.
  const onOvSelect = useCallback(
    (id: string) => {
      onOverviewSelect?.(id);
    },
    [onOverviewSelect],
  );
  const onOvJump = useCallback(
    (id: string) => {
      if (onOverviewJump?.(id)) return;
      if (boardRef.current) fold.reveal(boardRef.current, id);
      onView("detail");
      setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
    },
    [onOverviewJump, onView],
  );
  jumpRef.current = onOvJump;

  /* This panel's look. ONE subscription per pane, handed to the whole row
   * tree through context -- see board/context.ts for why it isn't read
   * per card. `settingsFor` is identity-stable, so this memo only makes a
   * new object when the look actually changed. */
  const settings = useSettings(board?.id ?? "");
  /* THE BOARD'S OWN gamma (types.ts Board.gamma), shared -- everyone
   * looking at this board sees the same curve. Absent is 1, which is
   * off, and off draws no filter at all (see index.css). */
  const gamma = board?.gamma ?? 1;
  /* What the pane's NESTING CARDS read to draw. One subscription per
   * pane, handed down through context -- never read per card, which in
   * the unvirtualized Overview would be thousands of them. */
  const nests = useBoardIndex();
  const ui = useMemo(
    () => ({ boardId: board?.id ?? "", query, matchCase, connections, settings, slot, nests }),
    [board?.id, query, matchCase, connections, settings, slot, nests],
  );
  const look = lookAttrs(settings, board?.look);

  /* Stepping the matches selects and reveals, in whichever view this
   * panel is showing -- the Overview scrolls its own viewport, detail
   * unfolds the ancestors first (its row won't exist otherwise). */
  const goToMatch = useCallback(
    (id: string) => {
      select(id, "single");
      if (viewRef.current === "overview") {
        /* THIS panel's copy: the query used to be document-wide, so with
         * one board open in both panels of a split, stepping a match in B
         * scrolled A -- the first [data-node] in DOM order is always the
         * left-hand panel's. */
        scrollHere(id);
        /* ...AND PUT THE KEYBOARD CURSOR THERE, which is what makes the
         * Overview draw its preview card for the match (owner,
         * 2026-09-02: "see the preview hover card as we click through").
         * The Overview already previews the cursor's cell on every
         * keypress (OverviewView's keyAt effect); stepping a match is a
         * keypress in all but name, and the cursor IS the selection, so
         * moving it here is the same thing select() just did, said to
         * the other store. */
        keyCursor.moved(id);
        /* ...and drag a linked Detail panel along, exactly as a single
         * click or an arrow key in the Overview already does
         * (`followSelect`). Stepping the matches IS selecting, so it has
         * to steer the same way -- without this, walking a search in the
         * Overview left the detail panel parked wherever it was, which
         * is the one thing the split view is for. Reading the callback
         * off the ref keeps this identity-stable, like the handle does. */
        selectCb.current?.(id);
      } else {
        reveal(id);
      }
    },
    [reveal, scrollHere],
  );

  /* Every bulk popover wants the same envelope: which board, what matched,
   * and the query that found it, so it can say so. */
  const openBulk = useCallback(
    (
      target: { open: (v: never) => void },
      matches: Match[],
      x = 140,
      y = 140,
      extra: Record<string, unknown> = {},
    ) => {
      target.open({
        boardId: board?.id ?? "",
        matches,
        query: queryRef.current,
        matchCase: caseRef.current,
        x,
        y,
        ...extra,
      } as never);
    },
    [board?.id],
  );

  /* DOES ANYTHING ON THIS BOARD MATCH? Asked with `matchesSearch`, the
   * SAME function the view itself filters by (flatten.ts) -- this used
   * to be a second walk written here, and the two had drifted:
   * the copy only ever tested LEAF cards, so a board whose only hit was
   * a Scene or a Day name said "No cards match" while the Overview
   * showed it and the search box counted it (owner-reported 2026-09-10,
   * hunting a card on a real cut). The board could always DRAW it; this
   * guard was refusing to let it try.
   *
   * The same shape of bug as the drop-target arithmetic that lives in
   * dropPlan.ts for exactly this reason: two statements of one question
   * drift, and the one nobody is looking at is the one that goes wrong. */
  const leaf = board ? board.levels.length - 1 : 0;
  const anyMatch = useMemo(() => {
    if (!query || !board) return true;
    return board.roots.some((r) => matchesSearch(r, 0, leaf, query, matchCase, nests));
  }, [board, query, matchCase, leaf, nests]);

  const onImageOver = useCallback(
    (e: React.DragEvent) => {
      if (e.defaultPrevented || !draggingImage(e.dataTransfer)) return;
      const t = imageTargetAt(boardRef.current, e.target as Element);
      markImageTarget(t?.el ?? null);
      /* Only accept over a card that can actually wear one. Left
         unaccepted elsewhere, the cursor keeps saying no -- which is the
         honest answer, since dropping there would do nothing. */
      if (!t) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [],
  );

  const onImageDrop = useCallback(
    async (e: React.DragEvent) => {
      if (e.defaultPrevented) return; // the grid's surface already took it
      const t = imageTargetAt(boardRef.current, e.target as Element);
      clearImageTarget();
      if (!t) return;
      const file = imageFrom(e.dataTransfer);
      if (!file) return;
      e.preventDefault();
      const r = await toCardImage(file);
      if (!r.ok) {
        await confirmDialog.tell("That image could not be used", r.reason);
        return;
      }
      const had = pictureOn(t.id);
      ops.setNodeImage(t.id, r.dataUri);
      if (!had) sitNewPicture(t.id); // the remembered default, for a first picture
    },
    [],
  );

  return (
    <BoardUIContext.Provider value={ui}>
      {/* THE CURVE ITSELF. CSS has brightness and contrast but no power
          function, and gamma is a power function -- so it is an SVG
          filter, which is the only way to say it in a browser. One per
          PANE, since the setting is the board's and two panes can show
          two boards; the id carries the slot so they cannot collide.
          Rendered only when the knob is off 1, for the reason above. */}
      {gamma !== 1 && (
        <svg className="gamma-def" aria-hidden focusable="false">
          <filter id={`corko-gamma-${slot}`} colorInterpolationFilters="sRGB">
            <feComponentTransfer>
              {/* the exponent is 1/value: "gamma 2.2" BRIGHTENS, which is
                  the photographer's convention and the direction the
                  slider moves */}
              <feFuncR type="gamma" exponent={1 / gamma} />
              <feFuncG type="gamma" exponent={1 / gamma} />
              <feFuncB type="gamma" exponent={1 / gamma} />
            </feComponentTransfer>
          </filter>
        </svg>
      )}
      <section
        {...look}
        ref={paneRef}
        className={"pane " + look.className}
        /* the legend highlight scopes its injected CSS to this (per pane, so
         * one panel's filter can't dim the other) */
        data-slot={slot}
        /* the board's images switch (settings.cardImages): one attribute,
           one CSS rule hides every picture in the pane -- never a prop
           threaded to eight hosts */
        data-images={settings.cardImages}
        /* THE GAMMA KNOB's one wire (settings.imageGamma). A CSS var
           rather than a class, so index.css can hand it to every picture
           element in one rule -- and UNSET at 1, because `filter: none`
           and no filter are not the same thing: an SVG `url()` filter is
           the slow kind and would be paid on every picture on the board
           for an identity curve. */
        data-gamma={gamma === 1 ? undefined : "on"}
        data-kbd={twoUp && hasKeyboard ? "on" : undefined}
        /* Clicking anywhere in a panel hands it the keyboard. Capture, so
         * a card's own mousedown (drag start, selection) can't stop it
         * from reaching us -- picking the cursor and picking the panel
         * are the same gesture. */
        onMouseDownCapture={() => paneFocus.set(slot)}
        style={
          {
            ...look.style,
            // per-board shared spacing (the panes can show different boards)
            "--card-space": `${board?.cardSpacing ?? DEFAULT_CARD_SPACING}px`,
          } as CSSProperties
        }
      >
        <PaneBar
          board={board}
          view={view}
          onView={onView}
          onSelectBoard={onSelectBoard}
          search={{
            query: rawQuery,
            onQuery,
            matchCase,
            onMatchCase: setMatchCase,
            inOverview: view === "overview",
            onGoTo: goToMatch,
            onFindReplace: (m) => openBulk(findReplace, m),
            onApplyTag: (m, x, y) => openBulk(bulkTag, m, x, y, { mode: "apply" }),
            onRemoveTag: (m, x, y) => openBulk(bulkTag, m, x, y, { mode: "remove" }),
            onPasteValues: (m, x, y) => pasteValues.open(m.map((i) => i.id), x, y),
          }}
        />
        {board && (
          <LegendBar
            board={board}
            driving={driving}
            /* Only a grid board has strings to follow, so only a grid
               board offers the mode -- the pane-bar's one-control-per-
               type rule (Furl vs zoom), not a vanished control. */
            connections={
              board.type === "grid" ? { on: connections, onToggle: setConnections } : null
            }
          />
        )}
        <main
          className="board-scroll"
          /* A PICTURE DROPPED FROM FINDER lands on the card under the
             pointer (board/imageDrop.ts). Handled here rather than on
             every card: a file drop carries a DataTransfer no card drag
             produces, so it needs nothing from the drag machinery, and
             the four card renderers stay untouched. The Free Grid's own
             surface handler runs first and calls preventDefault -- it
             can also MINT a card on bare cork, which needs a position
             only it has -- so this stands down whenever it acted. */
          onDragOver={onImageOver}
          onDrop={onImageDrop}
          onDragLeave={(e) => {
            // only when the pointer really left the panel, not on the
            // dragleave every child boundary fires
            if (!e.currentTarget.contains(e.relatedTarget as Node)) clearImageTarget();
          }}
        >
          {!board ? (
            <div className="empty">No board selected.</div>
          ) : board.type === "grid" ? (
            /* THE FREE GRID IS ONE SURFACE WITH A ZOOM LEVEL (owner,
               2026-09-04): 1.0x is the whole board, so a separate Fit
               view was redundant and its Board View menu is gone for
               this type. Whatever view a pane remembers, a grid draws
               this. */
            /* THE GRID'S CONTROLS SIT ON THE ROW CLOSEST TO THE BOARD
               (owner, 2026-09-11: "the controls for zoom and frame
               should live down where the sliders live in beat map's
               overview mode (closest row to the board). so move those
               down from the board name row in Free Grid") -- ONE
               ZoomControls, in a toolbar row that wears the Overview
               toolbar's look. Columns wears the same row since
               2026-09-21 (his: "the columns bar should match"), so a
               typed board's zoom is in one place on both types. */
            <div className="typed-stage">
              <div className="ov-toolbar typed-toolbar">
                <ZoomControls board={board} zoom={zoomFactor} onZoom={setZoomFactor} />
              </div>
              <GridZoom board={board} hasKeyboard={hasKeyboard} zoom={zoomFactor} onZoom={setZoomFactor} />
            </div>
          ) : board.type === "kanban" ? (
            /* COLUMNS, like the grid: one surface with a zoom level
               (owner, 2026-09-04), whatever view the pane remembers --
               and the same toolbar row above it. */
            <div className="typed-stage">
              <div className="ov-toolbar typed-toolbar">
                <ZoomControls board={board} zoom={zoomFactor} onZoom={setZoomFactor} />
              </div>
              <KanbanZoom board={board} hasKeyboard={hasKeyboard} zoom={zoomFactor} onZoom={setZoomFactor} />
            </div>
          ) : view === "overview" ? (
            <OverviewView
              board={board}
              query={query}
              columnDepth={columnDepth}
              onColumnDepth={setColumnDepth}
              onJump={onOvJump}
              onSelect={onOvSelect}
              hasKeyboard={hasKeyboard}
              detailDepth={detailDepth}
              onDetailDepth={setDetailDepth}
              zoom={zoom}
              manual={manual}
              onZoom={setZoom}
              onManual={setManual}
              onOpenBoard={onOpenBeside}
            />
          ) : query && !anyMatch ? (
            <div className="empty">No cards match "{query}".</div>
          ) : (
            <BoardView board={board} query={query} focus={focus} />
          )}
        </main>
      </section>
    </BoardUIContext.Provider>
  );
});
