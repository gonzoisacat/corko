import { useEffect } from "react";
import { ops, useBoard, useNode } from "../state/useBoard";
import { setSetting, useSettings } from "../state/settings";
import { DraftInput } from "../ui/DraftInput";
import { FloatPanel } from "../ui/FloatPanel";
import { NOTE_W, noteEditing, notePanel, releaseEditing, useNotePanel } from "./cardPanels";

/* ------------------------------------------------------------------ *
 *  The quick note: leave one on a card without opening Notes view.
 *
 *  Deliberately the SMALL door. A card can hold many notes, each with its
 *  own author, state and replies -- but that list, and everything you do
 *  across a whole cut with it, lives in Notes view. Here you get the most
 *  recent note and an author line, because the common case is "say the
 *  thing about this card and get back to work".
 *
 *  The author is remembered per browser (`noteAuthor` in state/settings):
 *  fill it once and every note you write afterwards is pre-attributed.
 *  Per browser rather than per project because it's a property of the
 *  person at this keyboard, and there are no accounts yet (spec Phase 7).
 * ------------------------------------------------------------------ */

export function NotePanelPopover() {
  const open = useNotePanel();
  // hooks run unconditionally, above the early return below
  const node = useNode(open?.boardId ?? null, open?.nodeId ?? null);
  const board = useBoard(open?.boardId ?? null);
  const { noteAuthor } = useSettings(open?.boardId ?? "");

  // the card can be deleted from under an open panel (or by a collaborator)
  useEffect(() => {
    if (open && !node) notePanel.close();
  }, [open, node]);

  // while open, its card's dot pulses (board/noteMarks.ts)
  useEffect(() => {
    if (!open) return;
    const id = open.nodeId;
    noteEditing.set(id);
    return () => releaseEditing(id);
  }, [open]);

  /* TAB GOES TO DONE FIRST (owner, 2026-09-07: "TAB brings you directly
   * to DONE first. another tab gets you to the author dialog, and then
   * one more back to the note field"). The panel is three stops -- the
   * note, Done, the author -- in that order, round and round, which is
   * not their order on screen: you write, and the next key finishes.
   * Shift+Tab walks it backward. Tab out of the note is also its blur,
   * so the note commits on the way. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = document.querySelector<HTMLElement>(".float-panel.note-panel");
      if (!root || !root.contains(document.activeElement)) return;
      const stops = [".info-notes", ".float-done", ".note-author"]
        .map((sel) => root.querySelector<HTMLElement>(sel))
        .filter((el): el is HTMLElement => !!el);
      if (stops.length < 2) return;
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length;
      e.preventDefault();
      stops[next].focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || !node) return null;

  const level = board?.levels[open.depth];
  const notes = node.notes ?? [];
  const note = notes[notes.length - 1]; // the most recent one, if any
  const left = open.x;
  const top = open.y; // FloatPanel clamps to the window by measuring itself

  /* Writing in an empty panel creates the note; writing in a filled one
   * edits it. Emptying it deletes it -- a blank note is not a note, the
   * same rule the metadata values follow. */
  const commitBody = (v: string) => {
    const body = v.trim();
    if (note) {
      if (body) ops.setNote(node.id, note.id, { body });
      else ops.removeNote(node.id, note.id);
    } else if (body) {
      ops.addNote(node.id, { body, author: noteAuthor });
    }
  };

  /* The author box does double duty: it attributes THIS note and becomes
   * the default for every note you write from now on. */
  const commitAuthor = (v: string) => {
    const author = v.trim();
    if (author !== noteAuthor) setSetting(open.boardId, "noteAuthor", author);
    if (note && author !== note.author) ops.setNote(node.id, note.id, { author });
  };

  return (
    <FloatPanel
      title={`${level?.name || "Card"} note`}
      className="note-panel"
      x={left}
      y={top}
      width={NOTE_W}
      onMove={notePanel.moveTo}
      onClose={notePanel.close}
      done
    >
      <div className="info-card-title" title={node.title}>
        {node.title || <em className="info-empty">Untitled</em>}
      </div>
      <DraftInput
        className="info-notes"
        value={note?.body ?? ""}
        ariaLabel="Note"
        placeholder="Leave a note..."
        multiline
        rows={5}
        autoFocus
        onCommit={commitBody}
      />
      <div className="note-author-row">
        <span className="note-author-label mono">Author</span>
        <DraftInput
          className="note-author"
          value={note?.author ?? noteAuthor}
          ariaLabel="Note author"
          placeholder="who's asking"
          onCommit={commitAuthor}
        />
      </div>
      {notes.length > 1 && (
        <div className="info-empty-row">
          {notes.length - 1} earlier note{notes.length - 1 === 1 ? "" : "s"} on this card -- open
          Notes view to read the thread.
        </div>
      )}
      {/* The dots' switch lived here until 2026-09-07 ("notes are just
          the text box and then the author field and done"); it is the
          symbol beside the Overrides door now, board/NoteDotsToggle.tsx. */}
    </FloatPanel>
  );
}
