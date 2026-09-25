import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Columns2, PanelRight } from "lucide-react";
import {
  getSnapshot,
  ops,
  useProject,
  useReady,
  useTags,
  useSplitAxis,
} from "./state/useBoard";
import { connectSync, useSynced, useSyncStatus } from "./state/sync";
import { useSettings } from "./state/settings";
import { lookAttrs } from "./board/lookScope";
import type { Board } from "./state/types";
import { CorkoMark } from "./ui/CorkoMark";
import { BoardPane, type BoardPaneHandle, type PaneView } from "./board/BoardPane";
import { useKeyNav } from "./board/keyNav";
import { useSpacePan } from "./board/spacePan";
import { useTipGuard } from "./ui/tipGuard";
import { paneFocus, usePaneFocus } from "./board/paneFocus";
import { driverSlot, type DrivingInfo } from "./board/DrivingWheel";
import { BarMenu, ThemeToggle } from "./board/PaneBar";
import { UsageMenu } from "./board/UsageMenu";
import { ProjectsMenu } from "./board/ProjectsMenu";
import { useTopbarShed } from "./board/topbarShed";
import { takeStashedTitle } from "./state/project";
import { ViewPlayerIcon, ViewSingleIcon } from "./board/viewIcons";
import { CardContextMenu } from "./board/CardContextMenu";
import { TagPanelPopover } from "./board/TagPanelPopover";
import { LegendPanelPopover } from "./board/LegendPanelPopover";
import { NotePanelPopover } from "./board/NotePanelPopover";
import { MetaPanelPopover } from "./board/MetaPanelPopover";
import { ImagePanelPopover } from "./board/ImagePanelPopover";
import { TextPanelPopover } from "./board/TextPanelPopover";
import { PasteValuesPopover } from "./board/PasteValuesPopover";
import { KeysPanelPopover } from "./board/KeysPanelPopover";
import { ConfirmDialogPopover } from "./ui/ConfirmDialogPopover";
import { GammaBar } from "./ui/GammaBar";
import { PinboardDesigner } from "./ui/PinboardDesigner";
import { EdlImportPopover } from "./board/EdlImportPopover";
import { DemotePopover } from "./board/DemotePopover";
import { PromotePopover } from "./board/PromotePopover";
import { FindReplacePopover } from "./board/FindReplacePopover";
import { BulkTagPopover } from "./board/BulkTagPopover";
import { InsertMenuPopover } from "./board/InsertMenuPopover";
import { OpenNestedPopover, type OpenNestedActions } from "./board/OpenNestedPopover";
import { NestPickerPopover } from "./board/NestPickerPopover";
import { YarnMenuPopover } from "./board/grid/YarnMenuPopover";
import { CanvasMenuPopover } from "./board/grid/CanvasMenuPopover";
import { FramePopover } from "./board/FramePopover";
import { pinboardDesigner } from "./ui/designerDoor";
import { PresenceBar, SyncStatusNote } from "./board/PresenceBar";
import {
  TemplatePicker,
  useTemplatePickerMode,
  useTemplatePickerOpen,
} from "./board/TemplatePicker";
import { LandingPicker } from "./board/LandingPicker";
import { BuildStatus } from "./board/BuildStatus";
import { TcCalcButton, TcCalcPopover } from "./board/TcCalcPopover";
import { OpenBoardDoor } from "./board/OpenBoardDoor";
import { useIsDragging } from "./board/drag";
import { SPLIT_AXIS_CSS } from "./board/tagSplit";
import {
  loadPanes,
  loadSplitAt,
  savePanes,
  saveSplitAt,
  singleFrom,
  splitFrom,
  type PanesPref,
  type ProjectView,
  type DriverMode,
} from "./state/panes";
import { NotesPanel } from "./board/NotesPanel";
import { PlayerPanel } from "./board/PlayerPanel";
import { select, useSelectionIds } from "./board/selection";
import { useUnreadMarks } from "./board/noteMarks";
import { notesRead } from "./state/notesRead";
import { fold } from "./state/fold";
import { seenBoards } from "./state/seenBoards";
import { lastSeen } from "./state/lastSeen";

/* Each mode drawn as the shape of the window it makes -- see viewIcons. */
const PROJECT_VIEWS = [
  { key: "single", name: "Single", icon: <ViewSingleIcon /> },
  { key: "split", name: "Split", icon: <Columns2 size={14} /> },
  { key: "notes", name: "Notes", icon: <PanelRight size={14} /> },
  { key: "player", name: "Player", icon: <ViewPlayerIcon /> },
];

export default function App() {
  const project = useProject();
  const ready = useReady();
  const dragging = useIsDragging();
  const focusedSlot = usePaneFocus();
  const pickerOpen = useTemplatePickerOpen();
  const pickerMode = useTemplatePickerMode();
  const synced = useSynced();
  const status = useSyncStatus();

  // Which board each pane shows, and which PROJECT VIEW is on (single /
  // split / notes). Local per browser (like fold state): how you arrange
  // your panels is your own view of the project.
  const [panes, setPanes] = useState<PanesPref>(loadPanes);
  useEffect(() => savePanes(panes), [panes]);

  // Resolve each pane's board, falling back to the first board when the
  // remembered one was deleted or hasn't synced yet.
  const boardFor = (id: string | null): Board | null =>
    project.boards.find((b) => b.id === id) ?? project.boards[0] ?? null;
  const boardA = boardFor(panes.a);
  const boardB = panes.view === "split" ? boardFor(panes.b) : null;

  /* Opening a board in a panel lands you in the view that board's TYPE
   * opens in (owner's call, 2026-08-03; the kanban exception 2026-08-16).
   *
   * A CUT board opens in DETAIL: picking a board is picking something to
   * read, and its Overview is a place you go from there -- arriving in
   * it means the board you just chose is a wall of color chips. The
   * other half of that reasoning was scale: switching a 2.5k-beat board
   * into a panel already in Overview mounted the whole unvirtualized
   * thing and wedged the tab.
   *
   * EVERY TYPED BOARD opens in FIT, and neither reason carries over to
   * either type. Both draw the identical cards in both modes -- the
   * same DOM under one transform -- so there is nothing to mount and
   * nothing to degrade. A kanban of five acts is meant to be taken in
   * at a glance; a FREE GRID even more so (owner-reported 2026-08-29:
   * opening one in Fixed showed bare cork -- Fixed starts at the
   * top-left corner, and a wall's cards can live nowhere near it).
   *
   * Only the panel you opened it in; a sibling keeps whatever it was
   * doing. (Fold is NOT reset here -- see the first-sight effect below.
   * Furl a board, leave, come back, and it's still furled.) */
  /* READ THE LIVE PROJECT, not this render's copy (owner-reported
   * 2026-09-01: loading a project that lands on a Free Grid opened it in
   * Fixed). "Load project..." calls `importProject` and then `onSelect`
   * in the SAME TICK, so React has not re-rendered and `project.boards`
   * does not contain the board being opened yet. `boardFor` then made it
   * worse than a miss: its `?? project.boards[0]` fallback answered with
   * a DIFFERENT board and read that one's type, so a grid opened in
   * whatever the first board's type implied.
   *
   * No fallback here on purpose -- an id that resolves to nothing means
   * "I cannot tell", and detail is the safe answer for that. */
  const openingView = useCallback(
    (id: string): PaneView =>
      getSnapshot().boards.find((b) => b.id === id)?.type ? "overview" : "detail",
    [],
  );
  const selectBoard = useCallback(
    (slot: "a" | "b", id: string) => {
      const v = openingView(id);
      setPanes((p) => ({ ...p, [slot]: id, [slot === "a" ? "viewA" : "viewB"]: v }));
    },
    [openingView],
  );
  const selectA = useCallback((id: string) => selectBoard("a", id), [selectBoard]);
  const selectB = useCallback((id: string) => selectBoard("b", id), [selectBoard]);
  const viewA = useCallback((v: PaneView) => setPanes((p) => ({ ...p, viewA: v })), []);
  const viewB = useCallback((v: PaneView) => setPanes((p) => ({ ...p, viewB: v })), []);

  /* The FIRST time this browser ever shows a board, it opens fully
   * unfurled -- and only that once (owner's call, 2026-08-03): after
   * that your fold is yours, so furling a board, stepping away and
   * coming back leaves it furled. Detail is handled by selectBoard
   * above; this also sets it, for the board a reload restores rather
   * than one you picked.
   *
   * Scoped per BOARD (fold.unfurlBoard, not foldToTier) so meeting one
   * board can't drop the folds you set up in another. Keyed on ids, not
   * the board objects, or every edit would re-run it. */
  useEffect(() => {
    const fresh: ("a" | "b")[] = [];
    for (const [slot, board] of [["a", boardA], ["b", boardB]] as const) {
      if (!board || !seenBoards.mark(board.id)) continue;
      fold.unfurlBoard(board);
      fresh.push(slot);
    }
    if (fresh.length) {
      setPanes((p) => ({
        ...p,
        // the board's own opening view, not a flat "detail" -- a kanban
        // board met for the first time opens in Fit like any other time
        ...(fresh.includes("a") && boardA ? { viewA: openingView(boardA.id) } : {}),
        ...(fresh.includes("b") && boardB ? { viewB: openingView(boardB.id) } : {}),
      }));
    }
  }, [boardA?.id, boardB?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the stored ids honest once boards resolve
  useEffect(() => {
    setPanes((p) => {
      const a = boardA?.id ?? p.a;
      const b = boardB?.id ?? p.b;
      return a === p.a && b === p.b ? p : { ...p, a, b };
    });
  }, [boardA?.id, boardB?.id]);

  const paneA = useRef<BoardPaneHandle>(null);
  const paneB = useRef<BoardPaneHandle>(null);

  const setDriving = useCallback((on: boolean) => setPanes((p) => ({ ...p, driving: on })), []);
  const setDriver = useCallback(
    (m: DriverMode) => setPanes((p) => ({ ...p, driver: m })),
    [],
  );
  /* Everything the wheel needs, in one prop rather than five threaded
   * through two components. `sameBoard` is why it lives here: only App
   * knows what BOTH panels are showing. */
  const drivingInfo: DrivingInfo = useMemo(
    () => ({
      twoUp: panes.view === "split",
      sameBoard: Boolean(boardA?.id && boardB?.id && boardA.id === boardB.id),
      on: panes.driving,
      driver: panes.driver,
      setOn: setDriving,
      setDriver,
    }),
    [panes.view, panes.driving, panes.driver, boardA?.id, boardB?.id, setDriving, setDriver],
  );

  /* Linked panels: an Overview click in one pane steers a DETAIL pane
   * showing the same board. Returns whether a sibling took the command,
   * so the calling pane knows to fall back to navigating itself --
   * DRIVING OFF (or refused) makes the panels independent, and returning
   * false is the whole mechanism: an Overview double-click then flips
   * its OWN panel to detail instead of throwing the other one about.
   *
   * The gate IS driverSlot, the same rule the wheel lights on, fed the
   * panel that PRODUCED the gesture -- `from` is the acting panel, so
   * "active panel drives" needs no focus lookup and cannot lag a
   * mousedown (see driverSlot's own header). The handle check below
   * stays as the live guard: drivingInfo's `sameBoard` is a snapshot,
   * and the handles are what the steering actually lands on. */
  const steerSibling = useCallback(
    (from: "a" | "b", id: string, jump: boolean): boolean => {
      if (driverSlot(drivingInfo, from) !== from) return false;
      const self = from === "a" ? paneA.current : paneB.current;
      const other = from === "a" ? paneB.current : paneA.current;
      // steering means "take the OTHER panel to this card", which a panel
      // on a different board cannot do -- the wheel reads inactive too
      if (!other || !self || other.boardId !== self.boardId) return false;
      return jump ? other.showNode(id) : other.scrollToNode(id);
    },
    [drivingInfo],
  );
  const selectFromA = useCallback((id: string) => steerSibling("a", id, false), [steerSibling]);
  const selectFromB = useCallback((id: string) => steerSibling("b", id, false), [steerSibling]);
  const jumpFromA = useCallback((id: string) => steerSibling("a", id, true), [steerSibling]);
  const jumpFromB = useCallback((id: string) => steerSibling("b", id, true), [steerSibling]);

  /* Project view. Split opens its second panel on a DIFFERENT board when
   * the project has one (the master-to-section workflow); Notes puts the
   * cut's notes beside the one board. */
  const setProjectView = useCallback(
    (v: ProjectView) => {
      setPanes((p) => {
        /* Leaving Split keeps the panel you were working in (owner,
         * 2026-09-04) -- state/panes.ts singleFrom. */
        if (v !== "split") return singleFrom(p, paneFocus.get(), v);
        /* Split mirrors the board you are on, in the other view if it
         * is a Beat Map (owner, 2026-09-04) -- state/panes.ts splitFrom.
         * It used to open the next board along, or the remembered one. */
        return splitFrom(p, boardA?.id ?? null, !boardA?.type);
      });
    },
    [boardA?.id, boardA?.type],
  );
  /* OPENING A NESTED BOARD (docs/explorations/board-shapes.md). The
   * split view is the traversal, so "beside" is the interesting one: it
   * puts the target in the OTHER panel and opens a split if there isn't
   * one -- which from Notes view means trading the notes panel for a
   * second board, and the popover says so before you choose.
   *
   * Here rather than in the popover because only App knows what both
   * panels are showing, the same reason drivingInfo lives here. */
  const nestActions: OpenNestedActions = useMemo(
    () => ({
      twoUp: panes.view === "split",
      siblingBoardId: (from) => (panes.view === "split" ? (from === "a" ? panes.b : panes.a) : null),
      beside: (from, boardId) => {
        const other = from === "a" ? "b" : "a";
        selectBoard(other, boardId);
        setPanes((p) => (p.view === "split" ? p : { ...p, view: "split" }));
        paneFocus.set(other); // you asked to go there, so the keyboard goes too
      },
      here: (from, boardId) => {
        selectBoard(from, boardId);
        paneFocus.set(from);
      },
    }),
    [panes.view, panes.a, panes.b, selectBoard],
  );
  /* CONVERT BOARD TYPE opens its copy BESIDE the source (owner,
   * 2026-09-11: "if it's already in split pane, then open it in
   * whichever pane is not the active converting board. if it's in
   * another mode, open it in split with the new board on the right
   * pane") -- which is `beside` above, word for word, so each pane hands
   * its Overview that rule bound to its own slot. From Notes or the
   * Player the split trades that side panel for the new board, as it
   * does for a nested board. */
  const openBesideA = useCallback((id: string) => nestActions.beside("a", id), [nestActions]);
  const openBesideB = useCallback((id: string) => nestActions.beside("b", id), [nestActions]);

  // Panel widths: drag the divider. Fraction of the width pane A takes.
  // Split and Notes remember their own -- a second board wants half the
  // window, a panel of notes wants a third.
  const twoUp = panes.view !== "single";
  const [splitAt, setSplitAt] = useState(() => loadSplitAt(panes.view));
  useEffect(() => setSplitAt(loadSplitAt(panes.view)), [panes.view]);
  const panesRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  useTopbarShed(topbarRef);
  const onDividerDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = panesRef.current;
    if (!el) return;
    // track the fraction in a local too: `up` can fire before React has
    // re-rendered the last `move`, so state isn't a reliable read here
    let last = splitAt;
    const move = (ev: MouseEvent) => {
      const r = el.getBoundingClientRect();
      last = Math.max(0.15, Math.min(0.85, (ev.clientX - r.left) / r.width));
      setSplitAt(last);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("col-resizing");
      saveSplitAt(panes.view, last);
    };
    document.body.classList.add("col-resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // A joining collaborator's IndexedDB is "ready" (empty) BEFORE the shared
  // project arrives over the network -- `ready` gates on local persistence,
  // not sync. Only treat an empty doc as a genuine first run once we've
  // either received the server's state (`synced`) or waited out a grace
  // period while not connected (offline / solo -- nothing to miss).
  const [settleElapsed, setSettleElapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettleElapsed(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const settled = synced || (settleElapsed && status !== "connected");

  // First run: no boards -> the template picker seeds the first one.
  const firstRun = ready && project.boards.length === 0 && settled;
  /* The FIRST board of a brand-new project lands in single view. Pane
   * arrangement is per browser, not per project, so someone who left a
   * split open and then started a fresh project would otherwise meet
   * their first board beside an empty second panel. Narrow on purpose:
   * a board created later goes wherever you asked for it, split
   * included (`firstRun` is read from the render that made this
   * callback, i.e. before the board existed). */
  const onBoardCreated = useCallback(
    (id: string) => {
      selectBoard("a", id);
      if (firstRun) setPanes((p) => ({ ...p, view: "single", viewA: "detail" }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectBoard, firstRun],
  );

  const showPicker = firstRun || pickerOpen;
  const waitingForSync = ready && !settled && project.boards.length === 0;

  /* THE OPEN BOARD DOOR (board/OpenBoardDoor.tsx, owner 2026-09-10).
   *
   * ASKED ONCE, AT BOOT, AND HELD. `wasHereRecently` is read before the
   * heartbeat starts, because starting the heartbeat is itself a stamp:
   * ask a moment later and the answer is always yes. `useState`'s
   * initializer is what makes that ordering a fact rather than a
   * convention -- it runs on the first render, ahead of every effect.
   *
   * The heartbeat runs for as long as the app is up, so a tab left open
   * counts as being here (his call). */
  /* What the timecode calculator's "take from the selected card" reads. */
  const selectionIds = useSelectionIds();
  const [wasRecent] = useState(() => lastSeen.wasHereRecently());
  useEffect(() => lastSeen.beat(), []);
  /* DISMISSED, once, for this tab: Escape, the scrim, or picking a
   * board. Separate from `wasRecent` so the door cannot come back from a
   * re-render, and so nothing else can put it up again either -- it is a
   * boot question, not a mode.
   *
   * WAITS FOR `settled`, like the first-run picker and for the same
   * reason: a joining peer's IndexedDB is ready and EMPTY before the
   * shared project arrives, and a door over an empty shelf is worse than
   * no door. Once the boards are there it draws, behind the splash. */
  const [doorDone, setDoorDone] = useState(false);
  const dismissDoor = useCallback(() => setDoorDone(true), []);
  const askBoard =
    !wasRecent && !doorDone && ready && settled && project.boards.length > 0 && !showPicker;
  /* SINGLE VIEW, in the left pane (his call). selectBoard already lands
   * you in the view that board's type opens in. */
  const openFromDoor = useCallback(
    (id: string) => {
      selectBoard("a", id);
      setPanes((p) => (p.view === "single" ? p : { ...p, view: "single" }));
    },
    [selectBoard],
  );

  // Join the shared room once for the tab's lifetime (StrictMode-safe;
  // the connection deliberately outlives component churn).
  useEffect(() => {
    connectSync();
  }, []);

  // Upgrade a board's legend to have its Defaults row when it becomes
  // visible (idempotent; older data may predate tier-bound entries).
  useEffect(() => {
    if (!ready) return;
    if (boardA) ops.ensureTierDefaults(boardA.id);
    if (boardB) ops.ensureTierDefaults(boardB.id);
  }, [ready, boardA, boardB]);

  /* Note read state (state/notesRead, local per browser). Gated on
   * `settled` for the same reason the first-run picker is: a joining
   * peer's IndexedDB is "ready" and EMPTY before the shared project
   * arrives, so baselining early would mark nothing read and then present
   * every note that syncs in as new. */
  /* A project set up from the Projects menu was named in the dialog,
   * before its room existed; the name rides across the reload and lands
   * here, once, the moment the empty doc is known to be empty. */
  useEffect(() => {
    if (!ready || !settled) return;
    const stashed = takeStashedTitle();
    if (stashed && !project.title) ops.setProjectTitle(stashed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settled]);
  useEffect(() => {
    if (!ready || !settled) return;
    notesRead.baseline(project.boards);
    notesRead.prune(project.boards);
  }, [ready, settled, project.boards]);
  /* The unread ring on the dots of whichever boards are on screen. One
   * injected rule, never a React pass over the cards -- see noteMarks.ts. */
  useUnreadMarks([boardA, boardB]);

  // Undo/redo shortcuts. Ignored while typing in a field so the browser's
  // native text undo still works there -- and while the PINBOARD DESIGNER
  // is open, whose sketch has its own history (ui/designHistory.ts) and
  // takes these keys itself; the board's stack must not move underneath.
  /* THE IMAGE GAMMA KNOB, behind Cmd+G and nothing else (owner,
   * 2026-09-09). Unlisted on purpose: it is a per-person screen
   * adjustment, not a board setting, and it left the Options menu when
   * it got this key. Cmd+G is otherwise unbound here, and the browser's
   * own Find Next only means anything while a find bar is open. */
  const [gammaOpen, setGammaOpen] = useState(false);
  /* THE USAGE METER, behind Cmd+U and nothing else (owner, 2026-09-10:
   * "lets also hide the usage meter. make it command+U"). It is a
   * deployer's gauge rather than a working control, so it left the
   * topbar the way the gamma knob left the Options menu. Unlisted for
   * the same reason, and by the same rule: not in the keys legend. */
  const [usageOpen, setUsageOpen] = useState(false);
  /* The board the key acts on: whichever pane the keyboard is driving,
   * falling back to the left one when only it is open. */
  const gammaBoard = focusedSlot === "b" && boardB ? boardB : boardA;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!(e.metaKey || e.ctrlKey) || (k !== "g" && k !== "u")) return;
      /* Stand aside while somebody is TYPING -- but a range slider is not
       * typing, and the bar's own slider takes the focus when it opens,
       * so the blunt "is it an input" test made the key one-way: it
       * opened the bar and then could not close it. */
      const el = document.activeElement;
      const typing =
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement)?.isContentEditable ||
        (el instanceof HTMLInputElement && el.type !== "range" && el.type !== "checkbox" && el.type !== "radio");
      if (typing) return;
      e.preventDefault();
      if (k === "g") setGammaOpen((v) => !v);
      else setUsageOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if (pinboardDesigner.isOpen()) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable)
        return;
      e.preventDefault();
      if (e.shiftKey) ops.redo();
      else ops.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Arrow-key board navigation + Enter/Space/N/M (board/keyNav.ts). One
   * keyboard, one cursor -- but either panel can hold it: focus follows
   * mouse-down into a pane, and only the split view has a second BOARD
   * pane to give it to (the notes panel steers pane A). */
  const kbdSlot = panes.view === "split" ? focusedSlot : "a";
  /* The overlays' look: the FOCUSED panel's board, since that is the one
   * you are working on and the one a card menu or metadata preview was
   * opened from. */
  const overlayBoard = kbdSlot === "b" ? boardB : boardA;
  const overlayLook = lookAttrs(useSettings(overlayBoard?.id ?? ""), overlayBoard?.look);
  useEffect(() => {
    if (panes.view !== "split") paneFocus.set("a");
  }, [panes.view]);
  const kbdPane = useCallback(
    () => (kbdSlot === "b" ? paneB.current : paneA.current),
    [kbdSlot],
  );
  /* Search moved INTO each panel (owner's call, 2026-08-03) -- it was
   * never project-wide, just one query applied to whatever was on screen,
   * and find is used as a flexible tag filter, so a split view wants two
   * of them. keyNav reads the focused panel's through the pane handle. */
  useKeyNav(kbdSlot === "b" ? boardB : boardA, kbdPane);
  /* Hold Space and drag to pan, on every surface that scrolls. */
  useSpacePan();
  useTipGuard();

  /* How far the furthest-sticking-out tag hangs past a card's edge. The beat
   * strip scrolls horizontally, and a scroll container can't leave the other
   * axis visible -- so it reserves this much room (and takes it straight back
   * with a negative margin, see .beats). A fixed reserve silently cropped any
   * tag bigger than it; tracking the actual tags means the room is always
   * enough without ever moving a card. */
  const tags = useTags();
  const splitAxis = useSplitAxis(); // ADR 0005: project-wide, one CSS var
  /* Dark chrome is a GLOBAL setting, so any board id resolves it -- and
     it belongs on `.app` rather than on a pane's look scope, because the
     menus and panels it dresses render outside every pane. */
  const { uiTheme, tooltips, notesWide } = useSettings("");
  /* NOTES AT FULL WIDTH (owner, 2026-09-06): the board pane is SHELVED --
   * still mounted at zero width, so a click on a note still selects and
   * scrolls its card, and giving the width back finds the board where
   * the note is -- and the divider goes with it. */
  const notesFull = panes.view === "notes" && notesWide;
  const tagBleed = useMemo(() => {
    let max = 0;
    for (const t of tags) if (t.visible) max = Math.max(max, t.reach / 2 + t.offset);
    return max <= 0 ? 0 : Math.min(96, Math.ceil(max) + 2);
  }, [tags]);

  const notice = !ready
    ? "Loading board..."
    : waitingForSync
      ? "Waiting for the shared board..."
      : firstRun
        ? "Choose a template to begin."
        : null;

  const paneStyle = useMemo(
    () => (twoUp ? ({ flex: `${splitAt} 1 0` } as CSSProperties) : undefined),
    [twoUp, splitAt],
  );
  const paneStyleB = useMemo(
    () => (twoUp ? ({ flex: `${1 - splitAt} 1 0` } as CSSProperties) : undefined),
    [twoUp, splitAt],
  );

  /* Notes view: clicking or stepping to a note LIGHTS its card where it
   * already is (owner, 2026-09-01: "not zoom into a card").
   *
   * It used to call `showNode`, which switches the pane to DETAIL --
   * so reading a note yanked you out of the Overview and changed how
   * you were looking at the board, which is a decision the reader had
   * already made. Now it selects the card, which is the app's own "this
   * is the one you want" mark and is drawn in every view, and scrolls
   * only as far as it must: `block: "nearest"` moves nothing when the
   * card is already fully on screen. The view and the zoom are never
   * touched, in any mode. */
  const goToNote = useCallback((id: string) => {
    select(id, "single");
    return paneA.current?.scrollToNode(id) ?? false;
  }, []);
  /* THE SAME MOVE, ROUTED BY BOARD (owner, 2026-09-10): the metadata
   * panel's tier chevrons carry the SELECTION with them, so the panel
   * doubles as a way of walking the board -- his reason being the Player
   * beside it: "keep continuously populating metadata to the right card
   * when i hit 'capture frame to selected card'". Selecting is what
   * makes those two panels agree on which card is being worked on.
   *
   * `goToNote` above always steers panel A, which is right for the notes
   * and player views (they ARE panel A plus a side panel). This panel
   * floats over both and knows which board it is about, so it steers the
   * panel showing THAT board -- and prefers A when both do, which is the
   * older behavior rather than a new rule. */
  const goToCard = useCallback(
    (id: string, boardId: string) => {
      select(id, "single");
      const inB = panes.view === "split" && panes.b === boardId && panes.a !== boardId;
      return (inB ? paneB : paneA).current?.scrollToNode(id) ?? false;
    },
    [panes.view, panes.a, panes.b],
  );

  return (
    <div
      className={"app" + (dragging ? " dragging" : "")}
      /* `data-drag-dup` (Option-drag) is written here by board/drag.ts
         directly, NOT rendered: a re-render per modifier press during a
         drag swaps the row under the cursor and loses the drop. */
      /* The look attributes used to live here. They moved DOWN to each
         pane when looks went per board -- and `.app` must not keep a copy,
         or a nested scope ties with the pane's on specificity and source
         order silently paints one panel with the other's backdrop. See
         board/lookScope.tsx. `--tag-bleed` stays: tags are project-level,
         so their overhang is the same in every panel. */
      /* ONE variable for the whole board rather than a prop on every
         card -- see board/tagSplit.ts. Every split gradient on screen
         re-resolves when this changes, at no render cost. */
      data-ui={uiTheme}
      data-tips={tooltips ? undefined : "off"}
      style={{ "--tag-bleed": `${tagBleed}px`, "--split-axis": SPLIT_AXIS_CSS[splitAxis] } as CSSProperties}
    >
      {/* top bar -- project-wide only; per-board controls live in each pane */}
      <header className="topbar" ref={topbarRef}>
        {/* THE CORNER (owner, 2026-09-04): the mark and the wordmark at
            1.5x, standing as tall as BOTH bars -- out of the topbar's
            flow and pinned to the app's corner, with the topbar and the
            first pane's bar padded past it so "PROJECT NAME:" and
            "BOARD NAME:" start on one line. */}
        <div className="brand">
          <CorkoMark size={51} /> Corko
        </div>
        {/* TWO HALVES AROUND A FIXED CENTER (owner, 2026-09-04): the left
            half (name) and the right half (usage, sync, presence) share
            the bar's width equally, so Project View sits at the WINDOW's
            center -- under a split's divider -- for as long as both fit.
            When one half outgrows its share, the free space in the other
            gives way first and the center slides; only when both halves
            are at their minimum does the bar start shedding, by
            measuring itself (board/topbarShed.ts). */}
        <div className="topbar-half topbar-left">
          <span className="topbar-label mono">Project name:</span>
          {/* The name IS the switcher (owner, 2026-09-02): one dropdown
              holding the current project's name, the other projects, and
              the project options. Renaming lives inside it. */}
          <ProjectsMenu title={project.title} />
        </div>
        {/* Undo, redo and the shortcut legend LEFT this bar (owner,
            2026-09-04): undo and redo are the keys alone now, and the
            legend's button lives in the pane bar beside Stats. */}
        {/* Project-level arrangement, as a dropdown in the pane bar's idiom
            (which now says "Board View" for detail-vs-Overview). Names the
            mode you ARE in. */}
        <span className="topbar-center">
          <span className="topbar-label mono">Project View:</span>
          <BarMenu
            className="project-view"
            label={PROJECT_VIEWS.find((v) => v.key === panes.view)!.name}
            icon={PROJECT_VIEWS.find((v) => v.key === panes.view)!.icon}
            items={PROJECT_VIEWS}
            active={panes.view}
            onPick={(key) => setProjectView(key as ProjectView)}
          />
        </span>
        <div className="topbar-half topbar-right">
          {/* Usage and limits, up from the pane bar (owner, 2026-09-04):
              it is deployment-wide, so it sits with the other project-wide
              things, right-justified with the sync note and presence.
              The ellipsis stands where it was once a narrow window sheds
              it (the pane bar's mark). */}
          {/* the light/dark switch, up from the pane bar (owner,
              2026-09-06): global, so it sits with the project-wide
              things, and reachable when Notes has shelved the pane bar */}
          {/* the tool cluster, left of appearance and status (his
              placement, "next to the dark mode UI") */}
          <TcCalcButton />
          <ThemeToggle boardId="" />
          {/* is this tab running the deployed build (owner, 2026-09-10);
              his order -- theme switch, reload, light, label, divider,
              then the sync note that was already here */}
          <BuildStatus />
          <span className="pane-bar-more topbar-more" aria-hidden="true">
            &#8943;
          </span>
          <span className="topbar-sync">
            <SyncStatusNote />
          </span>
          <PresenceBar />
        </div>
      </header>

      {notice ? (
        <main className="board-scroll">
          <div className="empty">{notice}</div>
        </main>
      ) : (
        <div className="panes" ref={panesRef}>
          <div className={"pane-slot" + (notesFull ? " shelved" : "")} style={notesFull ? undefined : paneStyle}>
            <BoardPane
              ref={paneA}
              board={boardA}
              slot="a"
              twoUp={panes.view === "split"}
              view={panes.viewA}
              onView={viewA}
              onSelectBoard={selectA}
              onOpenBeside={openBesideA}
              driving={drivingInfo}
              onOverviewSelect={selectFromA}
              onOverviewJump={jumpFromA}
            />
          </div>
          {twoUp && (
            <>
              {!notesFull && (
                <div
                  className="pane-divider"
                  onMouseDown={onDividerDown}
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize the panels"
                />
              )}
              <div className="pane-slot" style={notesFull ? { flex: "1 1 0" } : paneStyleB}>
                {panes.view === "split" ? (
                  <BoardPane
                    ref={paneB}
                    board={boardB}
                    slot="b"
                    twoUp
                    view={panes.viewB}
                    onView={viewB}
                    onSelectBoard={selectB}
                    onOpenBeside={openBesideB}
                    driving={drivingInfo}
                    onOverviewSelect={selectFromB}
                    onOverviewJump={jumpFromB}
                  />
                ) : panes.view === "player" ? (
                  <PlayerPanel board={boardA} onGoTo={goToNote} onOpenBoard={selectA} />
                ) : (
                  <NotesPanel board={boardA} onGoTo={goToNote} />
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* One shared set of overlays for every pane + view -- so they render
          ABOVE the panes and are inside none of them. Several draw real
          cards (the metadata panel's preview, the Overview's hover card),
          which need a look to hang off; they take the FOCUSED panel's,
          since that is the board you are working on. A sibling scope, never
          a nested one -- see board/lookScope.tsx. */}
      <div {...overlayLook} className={"overlay-scope " + overlayLook.className}>
        <CardContextMenu />
        <InsertMenuPopover />
        <OpenNestedPopover actions={nestActions} />
        <NestPickerPopover />
        <YarnMenuPopover />
        <CanvasMenuPopover />
        <FramePopover />
        <TagPanelPopover />
        <LegendPanelPopover />
        <NotePanelPopover />
        <MetaPanelPopover onGoTo={goToCard} />
        <TcCalcPopover boardId={boardA?.id ?? ""} selected={selectionIds} />
        <ImagePanelPopover />
        <TextPanelPopover />
        <PasteValuesPopover />
        <KeysPanelPopover />
        <ConfirmDialogPopover />
        <UsageMenu open={usageOpen} onClose={() => setUsageOpen(false)} />
        {gammaOpen && gammaBoard && (
          <GammaBar
            boardId={gammaBoard.id}
            gamma={gammaBoard.gamma ?? 1}
            name={gammaBoard.title}
            onClose={() => setGammaOpen(false)}
          />
        )}
        <PinboardDesigner />
        <EdlImportPopover />
        <DemotePopover />
        <PromotePopover />
        <FindReplacePopover />
        <BulkTagPopover />
      </div>
      {/* The landing screen is the door; the full shelf of templates is a
          drill-down behind `m` (see TemplatePicker's store). Both are
          rendered here so neither has to know about the other. */}
      {showPicker &&
        (pickerMode === "full" ? (
          <TemplatePicker onCreated={onBoardCreated} />
        ) : (
          <LandingPicker firstRun={firstRun} onCreated={onBoardCreated} />
        ))}
      {/* ...and the door onto the boards that already exist, which is
          the other half of the same question: this one only ever stands
          in front of a project that HAS boards, so the two can never be
          up at once. */}
      {askBoard && (
        <OpenBoardDoor
          activeBoardId={boardA?.id ?? null}
          onOpen={openFromDoor}
          onDismiss={dismissDoor}
        />
      )}
    </div>
  );
}
