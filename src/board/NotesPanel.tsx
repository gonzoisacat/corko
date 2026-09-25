import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  Download,
  GripVertical,
  ChevronRight,
  ChevronUp,
  CornerDownRight,
  MailOpen,
  Maximize2,
  Minimize2,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { ops, useFields, useTags } from "../state/useBoard";
import { useSelectionIds } from "./selection";
import {
  noteDraft,
  noteEditing,
  notesColumn,
  notesDrive,
  releaseEditing,
  useNoteDraft,
  useNotesDrive,
} from "./cardPanels";
import { focusNote } from "./legendHighlight";
import { setSetting, useSettings } from "../state/settings";
import { messageCount, notesRead, useNotesReadVersion } from "../state/notesRead";
import {
  arrangeColumns,
  availableColumns,
  downloadText,
  exportName,
  isMetaColumn,
  notesCsv,
  notesOutline,
} from "./notesExport";
import { NOTE_STATES, isClosed, noteStateDef } from "../state/noteStates";
import type { Board, Node as CorkoNode, Note, NoteState } from "../state/types";
import { DraftInput } from "../ui/DraftInput";
import {
  ALL_STATES,
  CLOSED_STATES,
  OPEN_STATES,
  authorCounts,
  authorFilterLabel,
  authorName,
  collectNotes,
  draftIndex,
  focusPlan,
  lastMessage,
  matchNote,
  readingCards,
  noteAuthors,
  pruneAuthors,
  relTime,
  sameStates,
  setAuthorIn,
  setStateIn,
  stateCounts,
  stateFilterLabel,
  statesInOrder,
  toggleAuthor,
  toggleState,
  type CardRef,
  type NoteFilter,
  type NoteRow,
} from "./notesFeed";
import { confirmDialog } from "../ui/confirmDialog";
import { resolveNodeColor } from "../colors";
import { cardFill } from "./tagSplit";
import { useClampToViewport } from "../ui/useClampToViewport";

/* ------------------------------------------------------------------ *
 *  Notes view's panel: every note in the board, in cut order.
 *
 *  The point of the mode is that notes are given and cleared across a
 *  whole cut, not one card at a time -- so this is a worklist. Filter it
 *  to an author (whose notes am I answering?), to a state or half the
 *  legend, to what is new to you, or to the words you remember, then
 *  walk it: clicking a note takes the board to its card, and prev/next
 *  step through the filtered list dragging the board with them.
 *
 *  TWO SHAPES OF THE SAME LIST (owner, 2026-09-06). Beside the board it
 *  is a column of cards. At full width (the Maximize button; the board
 *  pane is shelved, not unmounted) it is his spreadsheet: a row per
 *  note, columns for the card, the author, the note, the implementation
 *  note and the state -- "more rows of notes visible and things can
 *  still expand for reply threads". Same rows, same filters, same
 *  controls; only the layout changes, so nothing has to be learned
 *  twice.
 *
 *  THE STATE IS THE COLOR (state/noteStates.ts): six, his legend, and
 *  the implementation note wears it -- that column is what he scans.
 *
 *  A MESSAGE IS TEXT, NOT A FIELD (2026-08-06). Every note and every
 *  reply used to render as a live textarea -- eleven of them in one
 *  panel -- so a thread read as a form to fill in rather than a
 *  conversation to read. Messages are text with the author ABOVE them,
 *  a long one clamps with a "more", and the editor appears only when
 *  you double-click -- the same rule as a card on the board.
 * ------------------------------------------------------------------ */

export function NotesPanel({
  board,
  onGoTo,
}: {
  board: Board | null;
  /* Take the board pane to a card. Returns false when it couldn't (the
   * pane is in Overview, say), so the row can stay quiet about it. */
  onGoTo: (nodeId: string) => boolean;
}) {
  const [filter, setFilter] = useState<NoteFilter>({
    authors: null,
    replies: true,
    state: ALL_STATES,
    unread: false,
    q: "",
  });
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null); // the stepped-to note
  const listRef = useRef<HTMLDivElement>(null);
  const readV = useNotesReadVersion();
  const { notesWide: wide, notesFiltered } = useSettings("");
  const { notesColumns: colOrder, notesColumnsOff: colOff } = useSettings(board?.id ?? "");

  const all = useMemo(() => collectNotes(board), [board]);
  const cards = useMemo(() => readingCards(board), [board]);
  const authors = useMemo(() => noteAuthors(all), [all]);
  const panelRef = useRef<HTMLDivElement>(null);

  /* THE COLUMN ANNOUNCES ITSELF (2026-09-08): while it shows this board,
     the card menu's "Notes..." and keyNav's `n` write here instead of
     opening the popover (board/cardPanels.ts openNoteFor). */
  useEffect(() => {
    notesColumn.set(board?.id ?? null);
    return () => notesColumn.set(null);
  }, [board?.id]);

  /* THE ARROWS FOLLOW A CLICK (owner, 2026-09-08: "if you click on the
     notes pane, the arrow keys should now be driving that"). A mousedown
     inside takes them, one anywhere else gives them back; while held,
     Up/Down walk the picked notes exactly as the prev/next buttons do,
     and keyNav's own arrows stand aside. */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      notesDrive.set(!!panelRef.current?.contains(e.target as Node));
    };
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      notesDrive.set(false);
    };
  }, []);
  /* WHAT THE FILTERS PICK OUT (owner, 2026-09-07: "we still have the
     other notes visible in some cases, but the treatment changes"). The
     filters no longer decide what is in the list; they decide what is
     FULL. The rest stays, in cut order, folded to one dimmed line each
     -- or, with notesFiltered = hide, leaves as filters used to. */
  const matches = useMemo(
    () => new Set(all.filter((r) => matchNote(r, filter, (n) => notesRead.isUnread(n))).map((r) => r.note.id)),
    // readV: the unread filter and the per-row mark both read the store,
    // which is not part of `all` -- without it, marking one note read
    // leaves the list showing it as new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, filter, readV],
  );
  const hide = notesFiltered === "hide";
  const rows = useMemo(() => (hide ? all.filter((r) => matches.has(r.note.id)) : all), [all, matches, hide]);
  /* the notes the filters picked, in order -- what prev/next walk and
     what Mark all read clears */
  const picked = useMemo(() => all.filter((r) => matches.has(r.note.id)), [all, matches]);
  /* THE EXPORT MENU (owner, 2026-09-09). What it writes is what the
   * panel is SHOWING -- `picked`, the rows that pass the filters, not
   * `all` -- since filtering to a person or a state and then exporting
   * the lot would make the filters a lie. The menu says the count so
   * that is visible before the click. */
  const [exportOpen, setExportOpen] = useState(false);
  /* THE SPREADSHEET'S SECOND PANE (his ask, 2026-09-09: "it should be an
   * export submenu ... we'd be able to rearrange the order of the
   * columns"). The formats sit on the first pane; the CSV is the one
   * that needs a choice made, so it is the one with a pane behind it. */
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [dragCol, setDragCol] = useState<{ id: string | null; over: string | null; side: "before" | "after" }>({
    id: null,
    over: null,
    side: "before",
  });
  const fields = useFields();
  /* A card's metadata VALUES, which `readingCards` does not carry (it is
   * about drawing a row, not about exporting one). One walk, memoized
   * on the board like every other. */
  const valuesById = useMemo(() => {
    const m = new Map<string, Record<string, string>>();
    const walk = (nodes: CorkoNode[]) => {
      for (const n of nodes) {
        if (n.values) m.set(n.id, n.values);
        if (n.children?.length) walk(n.children);
      }
    };
    if (board) walk(board.roots);
    return m;
  }, [board]);
  const valuesOf = useCallback((nodeId: string) => valuesById.get(nodeId), [valuesById]);
  const columns = useMemo(
    () => availableColumns(picked, fields, valuesOf),
    [picked, fields, valuesOf],
  );
  const arranged = useMemo(
    () => arrangeColumns(columns, colOrder),
    [columns, colOrder],
  );
  const chosen = useMemo(() => arranged.filter((c) => !colOff.includes(c.id)), [arranged, colOff]);
  /* The arrangement is stored WHOLE once it is touched, so a later
     reorder has a list to move things within rather than an implicit
     natural order to reconcile against. */
  const moveColumn = (id: string | null, onto: string, side: "before" | "after") => {
    if (!id || id === onto) return;
    const ids = arranged.map((c) => c.id).filter((x) => x !== id);
    const at = ids.indexOf(onto);
    if (at < 0) return;
    ids.splice(side === "before" ? at : at + 1, 0, id);
    setSetting(board?.id ?? "", "notesColumns", ids);
  };
  useEffect(() => {
    if (!exportOpen) return;
    const shut = () => {
      setExportOpen(false);
      setColumnsOpen(false);
    };
    // a frame late, or the click that opened it closes it again
    const t = window.setTimeout(() => document.addEventListener("mousedown", shut), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", shut);
    };
  }, [exportOpen]);
  /* FOLDS BY HAND: a note the filters folded that you opened (it shows
     half-dimmed), or a full note you folded. They last until the next
     change to any filter, which starts the list fresh. */
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  useEffect(() => setFolds({}), [filter, notesFiltered]);

  // an author who no longer has notes shouldn't leave the list looking empty
  useEffect(() => {
    setFilter((f) => {
      const pruned = pruneAuthors(f.authors, authors);
      return pruned === f.authors ? f : { ...f, authors: pruned };
    });
  }, [authors]);

  const at = picked.findIndex((r) => r.note.id === cursor);
  const step = (dir: -1 | 1) => {
    if (!picked.length) return;
    // from nowhere, stepping forward starts at the top and back at the end
    const next = at < 0 ? (dir === 1 ? 0 : picked.length - 1) : (at + dir + picked.length) % picked.length;
    const row = picked[next];
    setCursor(row.note.id);
    notesRead.mark(row.note); // stepping onto a note is reading it
    onGoTo(row.nodeId);
    listRef.current
      ?.querySelector(`[data-note="${CSS.escape(row.note.id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const stepRef = useRef(step);
  stepRef.current = step;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  /* ENTER while the column drives (owner, 2026-09-08): open the cursor's
     thread and start a reply, caret in the box -- "you can begin typing
     in there immediately if desired". A counter, so pressing it again
     on the same note re-opens a composer you walked off. */
  const [compose, setCompose] = useState<{ noteId: string; n: number } | null>(null);
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    const onKey = (e: KeyboardEvent) => {
      if (!notesDrive.get() || typing(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter") {
        const id = cursorRef.current;
        if (!id) return;
        e.preventDefault();
        setOpenThread(id);
        setCompose((c) => ({ noteId: id, n: (c?.n ?? 0) + 1 }));
        return;
      }
      /* LEFT folds the cursor's note to its one line, RIGHT opens it
         (owner, 2026-09-08) -- the same fold the chevron toggles, held
         until the next filter change like a chevron's */
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const id = cursorRef.current;
        if (!id) return;
        e.preventDefault();
        const fold = e.key === "ArrowLeft";
        setFolds((f) => (f[id] === fold ? f : { ...f, [id]: fold }));
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      stepRef.current(e.key === "ArrowDown" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);


  /* THE DRAFT: a new parent note being written here, for a card, at the
     card's place in cut order (his: "you're taken to a new entry on the
     Notes list"). */
  const draftState = useNoteDraft();
  const draftCard = draftState && board && draftState.boardId === board.id ? cards.get(draftState.nodeId) : undefined;
  const draftAt = draftCard ? draftIndex(rows, draftCard.order) : -1;
  /* THE REVERSE SPOTLIGHT (owner, 2026-09-08: "the panel for the note
     you're making stays at full opacity and other notes in the list dim
     a bit. only while editing the note"): while the draft is open, or a
     row has a body, reply or composer open, every OTHER row takes the
     half veil. Rows report their own under-edit state up. */
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const writing = !!draftCard || !!busyNote;

  /* THE FOCUS EFFECT (his, 2026-09-08): the board's single selected card,
     from the keyboard or a click alike. Its notes ring; a noteless card
     puts a thin bar between the two nearest notes. */
  const selected = useSelectionIds();
  const focusId = selected.length === 1 ? selected[0] : null;
  /* THE SPOTLIGHT (owner, 2026-09-08): while the column shows this board,
     its single SELECTED card is left alone and every other card dims to
     0.61, half the legend's dimming (board/legendHighlight.ts focusNote)
     -- but only WHILE THE COLUMN IS DRIVING (a row click or its arrows
     took the keyboard; a click into the board pane gives it back and
     the dim goes, though the card stays selected). Selection, not
     hover, by his call after the first cut: a hover held the spotlight
     and the keyboard could not take it back while the pointer sat on a
     row; and not the selection alone, by his second: the board's own
     keyboard dimmed the board he was working in. Slot "a" because the
     column shows pane A's board (App renders it so). */
  const driving = useNotesDrive();
  const spotlight = driving && focusId && cards.has(focusId) ? focusId : null;
  useEffect(() => {
    focusNote("a", spotlight);
  }, [spotlight]);
  useEffect(() => () => focusNote("a", null), []);
  const plan = useMemo(
    () => focusPlan(rows, focusId, focusId ? cards.get(focusId)?.order : undefined),
    [rows, focusId, cards],
  );
  const barBefore = plan && "barBefore" in plan ? plan.barBefore : -1;
  const ringed = plan && "ring" in plan ? plan.ring : null;
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(".notes-focus-bar, [data-note].focus");
    el?.scrollIntoView({ block: "nearest" });
  }, [focusId, barBefore, ringed]);

  const openCount = all.filter((r) => !isClosed(r.note.state)).length;
  const counts = useMemo(() => stateCounts(all), [all]);
  const byAuthor = useMemo(() => authorCounts(all), [all]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const unreadCount = useMemo(() => all.filter((r) => notesRead.isUnread(r.note)).length, [all, readV]);

  const filtered = matches.size !== all.length;

  return (
    <div className={"notes-panel" + (wide ? " wide" : "")} ref={panelRef}>
      <div className="notes-bar">
        <span className="notes-title mono">NOTES</span>
        <span className="notes-count mono">
          {unreadCount > 0 && <b className="notes-new">{unreadCount} new</b>}
          {unreadCount > 0 && " · "}
          {openCount} open / {all.length}
          {filtered && ` · ${matches.size} match`}
        </span>
        <span className="pane-bar-spacer" />
        {/* Only while there IS something to clear, like the legend's
            "clear highlight" -- a permanently present button for a state
            you are usually not in is just noise in an 8px-padded bar. */}
        {/* tip-left on the bar's buttons: the notes panel is the
            window's right column, so centered tips clip at its edge */}
        {unreadCount > 0 && (
          <button
            className="pane-btn icon-only tip-left"
            aria-label={
              rows.length === all.length ? "Mark all read" : `Mark these ${rows.length} read`
            } data-tip={
              rows.length === all.length ? "Mark all read" : `Mark these ${rows.length} read`
            }
            onClick={() => notesRead.markAll(picked.map((r) => r.note))}
          >
            <MailOpen size={14} />
          </button>
        )}
        <button
          className="pane-btn icon-only tip-left"
          aria-label="Previous note" data-tip="Previous note"
          disabled={!rows.length}
          onClick={() => step(-1)}
        >
          <ChevronUp size={15} />
        </button>
        <button
          className="pane-btn icon-only tip-left"
          aria-label="Next note" data-tip="Next note"
          disabled={!rows.length}
          onClick={() => step(1)}
        >
          <ChevronDown size={15} />
        </button>
        {/* EXPORT (owner, 2026-09-09), beside the up/down pair he named.
            One symbol opening the three shapes, since a bar this busy
            cannot take three buttons. */}
        <span className="notes-export">
          <button
            className={"pane-btn icon-only tip-left" + (exportOpen ? " active" : "")}
            aria-label="Export notes" data-tip="Export notes"
            aria-expanded={exportOpen}
            disabled={!picked.length}
            onClick={(e) => {
              e.stopPropagation();
              setExportOpen((v) => !v);
            }}
          >
            <Download size={14} />
          </button>
          {exportOpen && columnsOpen && (
            /* THE COLUMNS, arranged. Drag a row onto another to move it,
               the same before/after-the-midpoint gesture the legend's
               chips use; the checkbox drops a column without losing its
               place, so switching one back on puts it where it was. */
            <div className="ctx-menu notes-export-menu notes-cols" onMouseDown={(e) => e.stopPropagation()}>
              <div className="notes-export-head mono">
                <button className="notes-cols-back" onClick={() => setColumnsOpen(false)} aria-label="Back">
                  <ChevronLeft size={12} />
                </button>
                Columns
              </div>
              <div className="notes-cols-list">
                {arranged.map((c) => (
                  <label
                    key={c.id}
                    className={"notes-col-row" + (dragCol.over === c.id ? " over-" + dragCol.side : "")}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDragCol({ id: c.id, over: null, side: "before" });
                    }}
                    onDragOver={(e) => {
                      if (!dragCol.id || dragCol.id === c.id) return;
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      setDragCol((d) => ({ ...d, over: c.id, side: e.clientY < r.top + r.height / 2 ? "before" : "after" }));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      moveColumn(dragCol.id, c.id, dragCol.side);
                      setDragCol({ id: null, over: null, side: "before" });
                    }}
                    onDragEnd={() => setDragCol({ id: null, over: null, side: "before" })}
                  >
                    <GripVertical size={11} className="notes-col-grip" />
                    <input
                      type="checkbox"
                      checked={!colOff.includes(c.id)}
                      onChange={(e) => {
                        const off = e.target.checked ? colOff.filter((x) => x !== c.id) : [...colOff, c.id];
                        setSetting(board?.id ?? "", "notesColumnsOff", off);
                      }}
                    />
                    <span className="notes-col-name">{c.name}</span>
                    {isMetaColumn(c.id) && <span className="notes-col-meta mono">meta</span>}
                  </label>
                ))}
              </div>
              <button
                className="ctx-item notes-cols-go"
                disabled={!chosen.length}
                onClick={() => {
                  setExportOpen(false);
                  setColumnsOpen(false);
                  downloadText(
                    notesCsv(picked, chosen, valuesOf),
                    exportName(board?.title ?? "", "csv"),
                    "text/csv",
                  );
                }}
              >
                Export {picked.length} note{picked.length === 1 ? "" : "s"} x {chosen.length} column
                {chosen.length === 1 ? "" : "s"}
              </button>
            </div>
          )}
          {exportOpen && !columnsOpen && (
            <div className="ctx-menu notes-export-menu" onMouseDown={(e) => e.stopPropagation()}>
              <div className="notes-export-head mono">
                {picked.length} note{picked.length === 1 ? "" : "s"}
                {picked.length === all.length ? "" : " (filtered)"}
              </div>
              <button
                className="ctx-item"
                onClick={() => {
                  setExportOpen(false);
                  downloadText(
                    notesOutline(picked, board?.title ?? ""),
                    exportName(board?.title ?? "", "txt"),
                    "text/plain",
                  );
                }}
              >
                Outline (.txt)
              </button>
              <button className="ctx-item has-sub" onClick={() => setColumnsOpen(true)}>
                Spreadsheet (.csv)
                <ChevronRight size={12} />
              </button>
              {/* PDF WITHOUT A LIBRARY: the browser's own print, against a
                  print stylesheet that keeps this panel and drops the
                  rest of the app. "Save as PDF" is in every print dialog
                  and the output is the sheet you are looking at. */}
              <button
                className="ctx-item"
                onClick={() => {
                  setExportOpen(false);
                  window.setTimeout(() => window.print(), 0);
                }}
              >
                Print / PDF...
              </button>
            </div>
          )}
        </span>

        {/* THE SPREADSHEET SWITCH: the column takes the window and the
            list lays out as rows and columns; back, the board returns
            where the current note is. */}
        <button
          className={"pane-btn icon-only tip-left" + (wide ? " active" : "")}
          aria-label={wide ? "Notes beside the board" : "Notes at full width"}
          data-tip={wide ? "Beside the board" : "Full width"}
          aria-pressed={wide}
          onClick={() => setSetting("", "notesWide", !wide)}
        >
          {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      <div className="notes-filters">
        {/* NOTES-ONLY SEARCH (owner, 2026-09-06): the words of a note,
            its implementation note, its replies and their names -- and
            never a card title, which is Find a card's job. A plain
            controlled input, not a DraftInput: it filters as you type
            and commits nothing. */}
        <label className="notes-search">
          <Search size={12} />
          <input
            value={filter.q}
            aria-label="Search notes"
            placeholder="Search notes"
            onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
          />
          {filter.q && (
            <button
              className="notes-search-clear"
              aria-label="Clear the search"
              onClick={() => setFilter((f) => ({ ...f, q: "" }))}
            >
              <X size={11} />
            </button>
          )}
        </label>
        {/* "Filters:" names the pickers (his, 2026-09-07; moved after the
            search 2026-09-08: "the text field is technically a filter,
            but it doesn't work visually and the other filter fields
            share more in common"). */}
        <span className="notes-filters-label mono">Filters:</span>
        {/* AUTHORS as a set of neutral pills (his, 2026-09-06), one per
            name on the board, note or reply; "All authors" at rest. The
            foot's switch is whether a thread you only ANSWERED in comes
            along -- on by default, which is what the filter always did. */}
        <PillSetPicker
          ariaLabel="Filter notes by author"
          groupLabel="Authors to show"
          trigger={authorFilterLabel(filter.authors)}
          items={authors.map((a) => ({ id: a, label: authorName(a), count: byAuthor.get(a) ?? 0 }))}
          value={filter.authors ?? new Set(authors)}
          presets={[
            { label: "All", on: filter.authors === null, apply: () => setFilter((f) => ({ ...f, authors: null })) },
          ]}
          paint={(id, on) => setFilter((f) => ({ ...f, authors: setAuthorIn(f.authors, id, on, authors) }))}
          toggle={(id) => setFilter((f) => ({ ...f, authors: toggleAuthor(f.authors, id, authors) }))}
          foot={
            <label className="notes-pick-foot">
              <input
                type="checkbox"
                checked={filter.replies}
                onChange={(e) => setFilter((f) => ({ ...f, replies: e.target.checked }))}
              />
              Include reply threads
            </label>
          }
        />
        {/* The states as a SET, picked from pills in their own colors
            (owner, 2026-09-06); the halves are presets on the popover's
            first line, since "what is still mine to do" is the question
            the list gets asked most. */}
        <PillSetPicker
          ariaLabel="Filter notes by state"
          groupLabel="States to show"
          trigger={stateFilterLabel(filter.state)}
          items={NOTE_STATES.map((st) => ({ id: st.id, label: st.label, count: counts.get(st.id) ?? 0, tone: st.id }))}
          value={filter.state}
          dots={filter.state.size < ALL_STATES.size ? statesInOrder(filter.state) : []}
          presets={[
            { label: "All", set: ALL_STATES },
            { label: "Any open", set: OPEN_STATES },
            { label: "Any closed", set: CLOSED_STATES },
          ].map((p) => ({
            label: p.label,
            on: sameStates(filter.state, p.set),
            apply: () => setFilter((f) => ({ ...f, state: p.set })),
          }))}
          paint={(id, on) => setFilter((f) => ({ ...f, state: setStateIn(f.state, id, on) }))}
          toggle={(id) => setFilter((f) => ({ ...f, state: toggleState(f.state, id) }))}
        />
        {/* Unread is ORTHOGONAL to the state -- a closed note can be new
            to you (someone answered and closed it while you were out) --
            so it is its own switch rather than an option in that select,
            which would have made them look mutually exclusive. */}
        <button
          className={"notes-unread-btn tip-left" + (filter.unread ? " on" : "")}
          aria-pressed={filter.unread}
          data-tip="Unread only"
          onClick={() => setFilter((f) => ({ ...f, unread: !f.unread }))}
        >
          New
        </button>
        {/* FILTERED NOTES: Collapse | Hide (his, 2026-09-07: "another
            toggle, or drop down, perhaps? Filtered notes: Collapse/Hide?
            and then either applies to all?"). A segmented pair, so both
            answers show at rest; one setting for every filter. */}
        <span className="notes-seg-wrap">
          <span className="notes-filters-label mono">Filtered notes:</span>
          <span className="notes-seg" role="group" aria-label="Filtered notes">
            {(["collapse", "hide"] as const).map((m) => (
              <button
                key={m}
                className={"notes-seg-btn" + (notesFiltered === m ? " on" : "")}
                aria-pressed={notesFiltered === m}
                onClick={() => setSetting("", "notesFiltered", m)}
              >
                {m === "collapse" ? "Collapse" : "Hide"}
              </button>
            ))}
          </span>
        </span>
      </div>

      <div className="notes-list" ref={listRef}>
        {wide && rows.length > 0 && (
          <div className="note-grid-head mono" aria-hidden>
            <span>Card</span>
            <span>Author</span>
            <span>Note</span>
            <span>Implementation notes</span>
            <span>Status</span>
            <span />
          </div>
        )}
        {all.length === 0 && (
          <div className="info-empty-row">No notes on this board yet. Right-click a card and leave one.</div>
        )}
        {all.length > 0 && matches.size === 0 && <div className="info-empty-row">No notes match these filters.</div>}
        {rows.map((row, i) => {
          const match = matches.has(row.note.id);
          const folded = folds[row.note.id] ?? !match;
          return (
            <Fragment key={row.note.id}>
            {barBefore === i && <div className="notes-focus-bar" aria-hidden />}
            {draftAt === i && draftCard && <NoteDraftCard card={draftCard} board={board} />}
            <NoteCard
              row={row}
              board={board}
              wide={wide}
              current={row.note.id === cursor}
              unread={notesRead.isUnread(row.note)}
              expanded={openThread === row.note.id}
              focus={!!ringed?.has(row.note.id)}
              compose={compose?.noteId === row.note.id ? compose.n : 0}
              onBusy={(on) => setBusyNote((b) => (on ? row.note.id : b === row.note.id ? null : b))}
              folded={folded}
              dim={!match ? (folded ? "hard" : "half") : writing && busyNote !== row.note.id ? "half" : ""}
              onFold={() => setFolds((f) => ({ ...f, [row.note.id]: !folded }))}
              onToggle={() => setOpenThread((v) => (v === row.note.id ? null : row.note.id))}
              onGoTo={() => {
                setCursor(row.note.id);
                notesRead.mark(row.note);
                onGoTo(row.nodeId);
              }}
            />
            </Fragment>
          );
        })}
        {barBefore === rows.length && rows.length > 0 && <div className="notes-focus-bar" aria-hidden />}
        {draftAt === rows.length && draftCard && <NoteDraftCard card={draftCard} board={board} />}
      </div>
    </div>
  );
}

function NoteCard({
  row,
  board,
  wide,
  current,
  unread,
  expanded,
  focus,
  compose,
  onBusy,
  folded,
  dim,
  onFold,
  onToggle,
  onGoTo,
}: {
  row: NoteRow;
  board: Board | null;
  wide: boolean;
  current: boolean;
  unread: boolean;
  expanded: boolean;
  /* the board's selected card is this note's: the thin gray ring */
  focus: boolean;
  /* > 0: open the composer now (Enter from the column's arrows); each
     press is a new number */
  compose: number;
  /* this row's under-edit state, up to the list (the reverse spotlight) */
  onBusy: (on: boolean) => void;
  /* FOLDED is one line: the chevron and the card's title (owner,
     2026-09-07). DIM is how far the filters passed it over: "hard"
     folded, "half" once you open it by hand, "" a match. */
  folded: boolean;
  dim: "" | "half" | "hard";
  onFold: () => void;
  onToggle: () => void;
  onGoTo: () => void;
}) {
  const { noteAuthor } = useSettings();
  const [replying, setReplying] = useState(false);
  const { note, nodeId, title, depth, path } = row;
  /* UNDER EDIT: a body or reply open for editing, or the composer open.
     The card's dot pulses on the board (board/noteMarks.ts) and the
     row's swatch dot pulses here (owner, 2026-09-08). */
  const [editingCount, setEditingCount] = useState(0);
  const onEditing = (on: boolean) => setEditingCount((n) => Math.max(0, n + (on ? 1 : -1)));
  const busy = replying || editingCount > 0;
  useEffect(() => {
    if (!busy) return;
    noteEditing.set(nodeId);
    return () => releaseEditing(nodeId);
  }, [busy, nodeId]);
  const onBusyRef = useRef(onBusy);
  onBusyRef.current = onBusy;
  useEffect(() => {
    onBusyRef.current(busy);
    return () => {
      if (busy) onBusyRef.current(false);
    };
  }, [busy]);
  useEffect(() => {
    if (compose > 0) setReplying(true);
  }, [compose]);
  const replies = note.replies ?? [];
  const tier = board?.levels[depth]?.name ?? "";
  const closed = isClosed(note.state);
  const last = lastMessage(note);
  const when = relTime(note.createdAt);

  /* whether the composer's blur carried a reply, read by walkedOff */
  const sent = useRef(false);
  const reply = (v: string) => {
    const body = v.trim();
    setReplying(false);
    if (!body) return;
    sent.current = true;
    ops.addReply(nodeId, note.id, { body, author: noteAuthor });
    // your own answer isn't news to you -- count it before it lands
    notesRead.markSeen(note.id, messageCount(note) + 1);
  };
  /* Clicking away from an empty reply puts the composer away, and when
     the thread has nothing else in it, shuts the dropdown too (owner,
     2026-09-07: "if you click away from a reply without typing anything,
     it *should* go back to its collapsed state"). With replies to read,
     only the composer goes: you opened the thread to see them. */
  const walkedOff = () => {
    const wasSent = sent.current;
    sent.current = false;
    if (wasSent) return;
    setReplying(false);
    if (responses === 0) onToggle();
  };

  const classes =
    (wide ? "note-row" : "note-card") +
    (closed ? " closed" : "") +
    (current ? " current" : "") +
    (focus ? " focus" : "") +
    (dim ? ` dim-${dim}` : "") +
    (folded ? " folded" : "");

  /* the chevron: every note folds, filters or not */
  const foldBtn = (
    <button
      className="note-fold-btn"
      aria-label={folded ? "Unfold this note" : "Fold this note"}
      aria-expanded={!folded}
      onClick={(e) => {
        e.stopPropagation();
        onFold();
      }}
    >
      {folded ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
    </button>
  );

  /* A click on the row selects the card where it is; a DOUBLE click on
     the card's name brings the board back if the table has the window
     (owner, 2026-09-06: "double clicking it bring the split back if it's
     not already in that mode") and goes there. The go-to waits a tick so
     the pane has its width back before it scrolls. */
  /* THE SWATCH: a little card in the card's own fill, tier color or
     override, nesting fill for a nesting card (owner, 2026-09-07: "so
     you can tell at a glance if it's a scene or beat note"). It took
     the crosshair's place. */
  const projectTags = useTags();
  const swatchStyle = swatchStyleFor(board, row, projectTags);
  /* the green dot ON THE SWATCH says "new to you" (his, 2026-09-08),
     always -- the board's dots switch is about the board -- in place
     of the green bar down the row's left edge */
  const swatch = (
    <span className="note-card-swatch" aria-hidden style={swatchStyle}>
      {(unread || busy) && <i className={"note-card-swatch-dot" + (busy ? " pulse" : "")} />}
    </span>
  );
  const where = (
    <button
      className="note-card-where"
      aria-label="Go to card"
      data-tip={wide ? "Double-click: show on the board" : "Go to card"}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (wide) {
          setSetting("", "notesWide", false);
          setTimeout(onGoTo, 0);
        } else onGoTo();
      }}
    >
      {swatch}
      <span className="note-card-title">{title || `Untitled ${tier.toLowerCase()}`}</span>
    </button>
  );

  const del = (
    <button
      className="note-del"
      aria-label="Delete this note" data-tip="Delete this note"
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog.ask({
          title: "Delete this note?",
          body: "(This removes all record of the note's existence)."
        });
        if (ok) ops.removeNote(nodeId, note.id);
      }}
    >
      <Trash2 size={12} />
    </button>
  );

  /* "Status:" before the pill in the column (owner, 2026-09-06); the
     table's column head says it there. */
  const statePick = (
    <StatePicker
      state={note.state}
      label={wide ? undefined : "Status:"}
      onPick={(state) => {
        notesRead.mark(note);
        ops.setNote(nodeId, note.id, { state });
      }}
    />
  );

  /* THE IMPLEMENTATION NOTES are the thread (owner, 2026-09-07: "kill
     the text field in implementation notes entirely. it becomes a header
     with a dropdown. the Reply button becomes the first place to make a
     response"). A stored `impl` from the field's one day reads as the
     thread's first message, editable in place and deletable, so nothing
     written then is lost; nothing writes a new one. */
  const implMsg: Note | null = note.impl
    ? { id: note.id + ":impl", body: note.impl, author: note.implBy ?? "", state: "open", createdAt: note.implAt ?? 0 }
    : null;
  const responses = (implMsg ? 1 : 0) + replies.length;
  const lastSaid = replies.length ? last : implMsg;
  const thread = expanded && (
    <div className={"note-thread" + (wide ? " note-row-thread" : "")}>
      {implMsg && (
        <div className="note-reply">
          <CornerDownRight size={12} className="note-reply-icon" />
          <div className="note-reply-body">
            <Message
              msg={implMsg}
              onEditing={onEditing}
              onCommit={(body) => ops.setNote(nodeId, note.id, { impl: body })}
              onDelete={() => ops.setNote(nodeId, note.id, { impl: "" })}
            />
          </div>
        </div>
      )}
      {replies.map((r) => (
        <div className="note-reply" key={r.id}>
          <CornerDownRight size={12} className="note-reply-icon" />
          <div className="note-reply-body">
            <Message
              msg={r}
              onEditing={onEditing}
              onCommit={(body) => {
                if (body) ops.setNote(nodeId, note.id, { body }, r.id);
                else ops.removeNote(nodeId, note.id, r.id);
              }}
              onDelete={() => ops.removeNote(nodeId, note.id, r.id)}
            />
          </div>
        </div>
      ))}
      {replying ? (
        <div className="note-reply-new">
          <CornerDownRight size={12} className="note-reply-icon" />
          <DraftInput
            className="note-body"
            value=""
            ariaLabel="Write a reply"
            placeholder={`Reply as ${noteAuthor || "someone"}...`}
            multiline
            rows={3}
            autoFocus
            onCommit={reply}
            onDone={walkedOff}
          />
        </div>
      ) : (
        <button
          className="note-reply-open"
          onClick={(e) => {
            e.stopPropagation();
            setReplying(true);
          }}
        >
          <CornerDownRight size={11} /> Reply
        </button>
      )}
    </div>
  );

  /* THE HEADER WITH A DROPDOWN: "Implementation notes" (plural, his)
     and the count, opening the thread; at its right, who spoke last
     while it is shut, and REPLY AS while it is open (his, 2026-09-07:
     "on the same row there's a 'reply as' text field (when open) and
     then every reply carries that and they're all uniform") -- the
     name every response from this browser is written as, which is the
     noteAuthor setting the card's note popover also sets. Opening the
     thread is reading it. In the sheet the column head names it, so
     the row's toggle carries only the count. */
  const implToggle = (
    <button
      className="note-impl-toggle"
      aria-expanded={expanded}
      aria-label={expanded ? "Hide the implementation notes" : "Show the implementation notes"}
      onClick={(e) => {
        e.stopPropagation();
        notesRead.mark(note);
        if (expanded) setReplying(false);
        onToggle();
      }}
    >
      {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      {!wide && <span className="note-impl-label mono">Implementation notes</span>}
      <span className="note-impl-count mono">{responses || (wide ? "none" : "")}</span>
    </button>
  );
  const replyAs = (
    <label className="note-reply-as mono" onClick={(e) => e.stopPropagation()}>
      <span>Reply as</span>
      <DraftInput
        className="note-reply-as-field"
        value={noteAuthor}
        ariaLabel="Reply as"
        placeholder="your name"
        onCommit={(v) => {
          const name = v.trim();
          if (name !== noteAuthor) setSetting("", "noteAuthor", name);
        }}
      />
    </label>
  );
  const implHeader = (
    <div className="note-impl-label-row">
      {implToggle}
      {/* Who spoke LAST, without opening. "Has anyone come back to me
          on this" is the question you scan a worklist for. */}
      {!expanded && lastSaid && (
        <span className="note-last">
          {lastSaid.author || "unattributed"}
          {relTime(lastSaid.createdAt) && ` \u00b7 ${relTime(lastSaid.createdAt)}`}
        </span>
      )}
      {expanded && replyAs}
    </div>
  );

  /* FOLDED: one line, the chevron and the card's title, in either mode.
     The line still goes to the card on a click, like every row; the
     chevron is the only thing that opens it. */
  if (folded) {
    return (
      <div className={classes} data-note={note.id} data-state={note.state} onClick={onGoTo}>
        {foldBtn}
        {/* the swatch on the folded line too (his, 2026-09-07), so a
            folded list still reads by tier */}
        {swatch}
        <span className="note-fold-title">{title || `Untitled ${tier.toLowerCase()}`}</span>
      </div>
    );
  }

  /* THE SPREADSHEET ROW: one grid line per note, the thread underneath
     spanning every column. The implementation cell wears the state's
     color, which is the column his eye reads down. */
  if (wide) {
    return (
      <div className={classes} data-note={note.id} data-state={note.state} onClick={onGoTo}>
        <div className="note-cell note-cell-card">
          {foldBtn}
          {where}
          {path && <div className="note-card-path mono">{path}</div>}
        </div>
        <div className="note-cell note-cell-by mono">
          <span className="note-by">{note.author || "unattributed"}</span>
          {when && <span className="note-when">{when}</span>}
        </div>
        {/* the NOTE cell wears the state's color now (his, 2026-09-07:
            "the note itself should carry the color, and the
            implementation thread is just plain") */}
        <div className="note-cell note-cell-note" data-state={note.state}>
          <MsgText
            body={note.body}
            ariaLabel="Note"
            onEditing={onEditing}
            onCommit={(body) => ops.setNote(nodeId, note.id, { body })}
          />
        </div>
        <div className="note-cell note-cell-impl">{implHeader}</div>
        <div className="note-cell note-cell-state">{statePick}</div>
        <div className="note-cell note-cell-tools">{del}</div>
        {thread}
      </div>
    );
  }

  return (
    <div
      className={classes}
      data-note={note.id}
      /* ADR 0004: clicking a note takes the board to its card. It was the
         crosshair button alone, which made the rest of a worklist row dead
         space. Controls inside stop the event. */
      onClick={onGoTo}
    >
      <div className="note-card-head">
        {foldBtn}
        {where}
        {statePick}
        {del}
      </div>
      {path && <div className="note-card-path mono">{path}</div>}

      {/* THE NOTE'S WORDS wear the state's color (his, 2026-09-07); the
          head above stays plain paper, so the card's swatch and the
          state's tint never share a surface. Unaddressed has no color,
          so an open note reads as plain paper, the sheet's blank. */}
      <div className="note-words" data-state={note.state}>
        <Message msg={note} onEditing={onEditing} onCommit={(body) => ops.setNote(nodeId, note.id, { body })} />
      </div>

      {/* THE IMPLEMENTATION NOTES: a plain header with a dropdown, the
          thread under it. */}
      <div className="note-impl">
        {implHeader}
        {thread}
      </div>
    </div>
  );
}

/* The card's own fill as the row's swatch: tier default, override or
 * nesting fill, with its SPLIT tags as the card's own gradient (his,
 * 2026-09-07). cardFill sets the longhands; the border is the card's. */
function swatchStyleFor(board: Board | null, card: CardRef, projectTags: ReturnType<typeof useTags>) {
  if (!board) return undefined;
  const fill = resolveNodeColor(board.legend, card.colorId, board.levels[card.depth]?.id ?? "", card.nested);
  return { ...cardFill(fill.bg, card.tags, projectTags), borderColor: fill.border };
}

/* THE DRAFT ENTRY (owner, 2026-09-08): "when Notes mode is open and you
 * right click to leave a note, it should take place over in the notes
 * column instead of in the pop-up. the pop-up doesn't come and you're
 * taken to a new entry on the Notes list." A card-shaped row at the
 * card's place in cut order: its swatch and title, your name as the
 * same field the thread's Reply as is, and the note open for writing
 * with the caret in it. Always a NEW parent note, so two people can
 * each leave one on a card. Committing writes it; walking off it empty
 * removes it, like an empty reply. */
function NoteDraftCard({ card, board }: { card: CardRef; board: Board | null }) {
  const { noteAuthor } = useSettings();
  const projectTags = useTags();
  const sent = useRef(false);
  // while the draft is open its card's dot pulses on the board, and the
  // draft's own swatch dot pulses here
  useEffect(() => {
    noteEditing.set(card.nodeId);
    return () => releaseEditing(card.nodeId);
  }, [card.nodeId]);
  const tier = board?.levels[card.depth]?.name ?? "";
  const commit = (v: string) => {
    const body = v.trim();
    if (!body) return;
    sent.current = true;
    ops.addNote(card.nodeId, { body, author: noteAuthor });
    noteDraft.set(null);
  };
  return (
    <div className="note-card note-draft" data-draft={card.nodeId} onClick={(e) => e.stopPropagation()}>
      <div className="note-card-head">
        <span className="note-card-swatch" aria-hidden style={swatchStyleFor(board, card, projectTags)}>
          <i className="note-card-swatch-dot pulse" />
        </span>
        <span className="note-card-title note-draft-title">{card.title || `Untitled ${tier.toLowerCase()}`}</span>
        <label className="note-reply-as mono">
          <span>As</span>
          <DraftInput
            className="note-reply-as-field"
            value={noteAuthor}
            ariaLabel="Note author"
            placeholder="your name"
            onCommit={(v) => {
              const name = v.trim();
              if (name !== noteAuthor) setSetting("", "noteAuthor", name);
            }}
          />
        </label>
      </div>
      {card.path && <div className="note-card-path mono">{card.path}</div>}
      <DraftInput
        className="note-body note-draft-body"
        value=""
        ariaLabel="New note"
        placeholder="Leave a note..."
        multiline
        rows={3}
        autoFocus
        onCommit={commit}
        onDone={() => {
          if (!sent.current) noteDraft.set(null);
        }}
      />
    </div>
  );
}

/* THE PILL-SET PICKER: what the state filter and the author filter
 * both are (owner, 2026-09-06: "a more bespoke dropdown ... multi
 * select and has the color language in it", then "similarly improve
 * the menu for notes authors"). A trigger that says what the set is,
 * with a dot per lit state when it has tones; a popover with presets
 * on its first line, the pills under them one per row, each a toggle,
 * and an optional foot (the authors' reply switch). His pick between
 * the two treatments offered was FILLED IN / OUTLINED OUT: a lit pill
 * wears its color with its ink as the border, an unlit one keeps only
 * the outline and its ink -- so the popover reads as the legend either
 * way, and the selection is the weight of it. A pill with no tone is
 * neutral, off-black on off-white. The number beside each is that
 * item's count on the whole board. Fixed-positioned and measured, like
 * the row's picker.
 *
 * The pills are DRAG-SELECTABLE (his, 2026-09-06, right after seeing
 * it): press on one and sweep. The press sets the pill to the opposite
 * of what it was, and every pill the stroke crosses takes that same
 * value -- the designer's trace-select, not a toggle per pill, so a
 * sweep back over a pill does not undo it. The pressed row CAPTURES
 * the pointer and every move paints the whole span of rows between
 * the last one painted and the one under the pointer -- enter events
 * alone skipped a row on a quick flick (the pane's synthetic drag did
 * it first; a real one can too). Off the list's end the nearest row
 * counts, so a sweep past the bottom takes the last pill with it.
 * onClick keeps only the keyboard (`detail === 0` is an Enter or
 * Space; a pointer click was handled on the way down). `paint` and
 * `toggle` are the caller's, written as UPDATERS, since a sweep lands
 * several in one gesture. */
interface PillItem<T extends string> {
  id: T;
  label: string;
  count: number;
  tone?: NoteState; // colors the pill; absent = neutral
}

function PillSetPicker<T extends string>({
  ariaLabel,
  groupLabel,
  trigger,
  items,
  value,
  dots = [],
  presets,
  paint,
  toggle,
  foot,
}: {
  ariaLabel: string;
  groupLabel: string;
  trigger: string;
  items: PillItem<T>[];
  value: ReadonlySet<T>;
  dots?: NoteState[];
  presets: { label: string; on: boolean; apply: () => void }[];
  paint: (id: T, on: boolean) => void;
  toggle: (id: T) => void;
  foot?: ReactNode;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  /* the value this sweep paints and the last row it painted, while the
     button is down */
  const sweep = useRef<{ to: boolean; last: number } | null>(null);
  /* which row the pointer is over, by height -- the nearest one when it
     is between rows or off the list */
  const rowAt = (y: number): number => {
    const rows = pop.current?.querySelectorAll<HTMLElement>(".notes-pick-row") ?? [];
    let best = -1;
    let dist = Infinity;
    rows.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return best;
  };
  const sweepTo = (idx: number) => {
    const sw = sweep.current;
    if (!sw || idx < 0 || idx === sw.last) return;
    const step = idx > sw.last ? 1 : -1;
    for (let i = sw.last + step; i !== idx + step; i += step) paint(items[i].id, sw.to);
    sw.last = idx;
  };
  const POP_W = 232;
  const { left, top } = useClampToViewport(pop, at?.x ?? 0, at?.y ?? 0, { w: POP_W, h: 250 });

  useEffect(() => {
    if (!at) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setAt(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAt(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [at]);

  const open = (btn: HTMLElement) => {
    if (at) return setAt(null);
    const r = btn.getBoundingClientRect();
    setAt({ x: r.left, y: r.bottom + 4 });
  };

  return (
    <div className="notes-pick" ref={wrap}>
      <button
        className={"notes-filter notes-pick-trig" + (at ? " open" : "")}
        aria-label={`${ariaLabel}: ${trigger}`}
        aria-expanded={!!at}
        onClick={(e) => open(e.currentTarget)}
      >
        <span className="notes-pick-trig-text">{trigger}</span>
        {dots.length > 0 && (
          <span className="notes-pick-dots" aria-hidden>
            {dots.map((s) => (
              <i key={s} data-state={s} />
            ))}
          </span>
        )}
        <ChevronDown size={12} />
      </button>
      {at && (
        <div
          className="fold-menu-pop notes-pick-pop"
          ref={pop}
          role="group"
          aria-label={groupLabel}
          style={{ top, left, width: POP_W }}
        >
          <div className="notes-pick-presets">
            {presets.map((p) => (
              <button
                key={p.label}
                className={"notes-pick-preset" + (p.on ? " on" : "")}
                aria-pressed={p.on}
                onClick={p.apply}
              >
                {p.label}
              </button>
            ))}
          </div>
          {items.length === 0 && <div className="notes-pick-empty">Nobody has written a note yet.</div>}
          {items.map((it, i) => {
            const on = value.has(it.id);
            return (
              <button
                key={it.id}
                className="notes-pick-row"
                role="checkbox"
                aria-checked={on}
                aria-label={it.label}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault(); // no text selection along the sweep
                  e.currentTarget.setPointerCapture(e.pointerId);
                  sweep.current = { to: !on, last: i };
                  paint(it.id, !on);
                }}
                onPointerMove={(e) => {
                  if (sweep.current && e.buttons & 1) sweepTo(rowAt(e.clientY));
                }}
                onPointerUp={() => {
                  sweep.current = null;
                }}
                onPointerCancel={() => {
                  sweep.current = null;
                }}
                onClick={(e) => {
                  if (e.detail === 0) toggle(it.id);
                }}
              >
                <span
                  className={"notes-pick-pill" + (on ? "" : " off") + (it.tone ? "" : " neutral")}
                  data-state={it.tone}
                >
                  {it.label}
                </span>
                <span className="notes-pick-count mono">{it.count}</span>
              </button>
            );
          })}
          {foot}
        </div>
      )}
    </div>
  );
}

/* THE STATE, picked: a pill in the state's color, opening the legend.
 * Fixed-positioned rather than hung off the row, because the list
 * scrolls and an absolutely placed menu at the bottom of it would be
 * clipped by the list's own overflow. */
function StatePicker({
  state,
  label,
  onPick,
}: {
  state: NoteState;
  label?: string;
  onPick: (s: NoteState) => void;
}) {
  const [open, setOpen] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const def = noteStateDef(state);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const MENU_W = 236;
  const MENU_H = 8 + NOTE_STATES.length * 46; // two-line items
  const toggle = (btn: HTMLElement) => {
    if (open) return setOpen(null);
    const r = btn.getBoundingClientRect();
    const below = r.bottom + 4 + MENU_H <= window.innerHeight;
    setOpen({
      top: below ? r.bottom + 4 : Math.max(4, r.top - 4 - MENU_H),
      left: Math.max(4, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 4)),
    });
  };

  return (
    <span className="note-state-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      {label && <span className="note-state-label mono">{label}</span>}
      <button
        className={"note-state-pick" + (open ? " open" : "")}
        data-state={state}
        aria-label={`State: ${def.label}`}
        aria-expanded={!!open}
        onClick={(e) => toggle(e.currentTarget)}
      >
        {def.label}
      </button>
      {open && (
        <div className="fold-menu-pop note-state-menu" style={{ top: open.top, left: open.left, width: MENU_W }}>
          {NOTE_STATES.map((s) => (
            <button
              key={s.id}
              className={"fold-menu-item note-state-item" + (s.id === state ? " active" : "")}
              onClick={() => {
                setOpen(null);
                if (s.id !== state) onPick(s.id);
              }}
            >
              <span className="note-state-swatch" data-state={s.id} />
              <span className="note-state-item-text">
                <span className="note-state-item-label">{s.label}</span>
                <span className="note-state-item-means">{s.means}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/* One message -- a note or a reply: the speaker's name ABOVE the words,
 * a relative time, and the words as MsgText. The author used to sit
 * under its own message, where reading down a thread the name attached
 * to the message that FOLLOWED it. */
function Message({
  msg,
  onCommit,
  onDelete,
  onEditing,
}: {
  msg: Note;
  onCommit: (body: string) => void;
  onDelete?: () => void;
  onEditing?: (on: boolean) => void;
}) {
  const when = relTime(msg.createdAt);
  return (
    <div className="note-msg">
      <div className="note-msg-head mono">
        <span className="note-by">{msg.author || "unattributed"}</span>
        {when && <span className="note-when">{when}</span>}
        {onDelete && (
          <button
            className="note-del"
            aria-label="Delete this reply" data-tip="Delete this reply"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
      <MsgText body={msg.body} ariaLabel="Note" onCommit={onCommit} onEditing={onEditing} />
    </div>
  );
}

/* Some words: TEXT until you double-click them, which is the board's own
 * rule for a card title (single click selects, double click edits in
 * place), so there is no second idiom to learn. Clamped to a few lines
 * with a "more" when there is more. With `addLabel`, an empty one is a
 * button that opens the editor -- the implementation note starts blank
 * on every note, and a blank you have to know to double-click is not a
 * door. */
function MsgText({
  body,
  ariaLabel,
  placeholder,
  addLabel,
  onCommit,
  onEditing,
}: {
  body: string;
  ariaLabel: string;
  placeholder?: string;
  addLabel?: string;
  onCommit: (body: string) => void;
  /* the editor opened (true) / closed (false): the row's under-edit state */
  onEditing?: (on: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const onEditingRef = useRef(onEditing);
  onEditingRef.current = onEditing;
  useEffect(() => {
    if (!editing) return;
    onEditingRef.current?.(true);
    return () => onEditingRef.current?.(false);
  }, [editing]);
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);

  /* Whether the clamp is actually hiding anything, so "more" appears only
   * when there is more. Measured only while CLAMPED: expanded, scrollHeight
   * equals clientHeight and the check would say no -- hiding the way back. */
  useLayoutEffect(() => {
    if (editing || expanded) return;
    const el = bodyRef.current;
    if (el) setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [body, editing, expanded]);

  if (editing) {
    return (
      <div className="note-msg-edit" onBlur={() => setEditing(false)}>
        <DraftInput
          className="note-body"
          value={body}
          ariaLabel={ariaLabel}
          placeholder={placeholder}
          multiline
          /* Enough to hold what's there without a scroll the moment it
             opens; the field is resizable, and the read view is where a
             long note gets its clamp. */
          rows={Math.min(12, Math.max(3, Math.ceil(body.length / 38) + 1))}
          autoFocus
          caretAtEnd
          onCommit={(v) => onCommit(v.trim())}
        />
      </div>
    );
  }

  if (!body && addLabel) {
    return (
      <button
        className="note-add-text"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {addLabel}
      </button>
    );
  }

  return (
    <>
      <div
        className={"note-msg-body" + (expanded ? " open" : "")}
        ref={bodyRef}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {body || <em className="info-empty">Empty</em>}
      </div>
      {(clipped || expanded) && (
        <button
          className="note-more"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </>
  );
}
