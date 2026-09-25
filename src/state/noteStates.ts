import type { NoteState } from "./types";

/* ------------------------------------------------------------------ *
 *  WHAT STATE A NOTE IS IN -- the owner's spreadsheet legend, as data
 *  (2026-09-06). For years his notes have lived in a sheet: a row per
 *  note, and an "implementation notes" column color-coded by what became
 *  of it. Green: addressed as given, or a non-action note. Yellow:
 *  addressed with a caveat for review. Red: not implemented, reason
 *  given. Blue: needs addressing later. Purple: a GFX pass, or needs
 *  further discussion. Blank: nobody has got to it.
 *
 *  Seven states, FIXED (his call: not a per-project vocabulary). They
 *  replace the old open/resolved pair; a stored "resolved" reads as
 *  "done" forever, so no migration writes anything.
 *
 *  CLOSED is the half that was "resolved": the note has been answered
 *  one way or another (done, caveat, declined). OPEN is the half that
 *  is still somebody's to do (open, later, discuss). That split is what
 *  the card's dot goes hollow on and what the state filter's Open /
 *  Closed lines mean, so it lives here and nowhere else.
 * ------------------------------------------------------------------ */

export interface NoteStateDef {
  id: NoteState;
  label: string;
  /* the legend's own words, for the picker's tip */
  means: string;
  closed: boolean;
}

export const NOTE_STATES: readonly NoteStateDef[] = [
  /* "Unaddressed", not "Open" (owner, 2026-09-06: on a pill, "Open"
   * reads as a verb -- "looks like it opens the note or the card"). The
   * id stays `open`; "open" remains the GROUP word in the filter and the
   * counts, where it is not a button. */
  { id: "open", label: "Unaddressed", means: "Not addressed yet", closed: false },
  /* the labels and their meanings are his words, verbatim (2026-09-06) */
  {
    id: "done",
    label: "Done",
    means: "Addressed straightforwardly, or confirming receipt of a non-action note",
    closed: true,
  },
  {
    id: "caveat",
    label: "Done-ish",
    means: "Addressed, but with a caveat or modification to be reviewed",
    closed: true,
  },
  {
    id: "declined",
    label: "Not Doing",
    means: "Deliberately not implemented, with reason given (e.g. the footage requested does not exist)",
    closed: true,
  },
  {
    id: "later",
    label: "Later - Pending",
    means: "Needs to be done later, for lack of material or time",
    closed: false,
  },
  {
    id: "discuss",
    label: "Discussion needed",
    means: "Needs further discussion before implementing",
    closed: false,
  },
  /* OTHER (his, 2026-09-06): the status is whatever the implementation
   * note says. Counted as OPEN -- a status you have to read is not one
   * the dot can call closed on its own. */
  { id: "other", label: "Other", means: "Read implementation note for status", closed: false },
];

const BY_ID = new Map(NOTE_STATES.map((s) => [s.id, s]));

export function noteStateDef(id: NoteState): NoteStateDef {
  return BY_ID.get(id) ?? NOTE_STATES[0];
}

export function isClosed(state: NoteState): boolean {
  return noteStateDef(state).closed;
}

/* A stored value -> a state. The one place the old pair is translated:
 * "resolved" was the only closed state and becomes "done"; anything
 * unknown (a build from the future, junk in a file) is open, which is
 * the state that asks for a look rather than hiding one. */
export function readNoteState(raw: unknown): NoteState {
  if (raw === "resolved") return "done";
  return typeof raw === "string" && BY_ID.has(raw as NoteState) ? (raw as NoteState) : "open";
}
