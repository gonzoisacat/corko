import type { Note } from "../state/types";
import { isClosed } from "../state/noteStates";

/* ------------------------------------------------------------------ *
 *  The mark on a card that carries notes -- in EVERY view, which is the
 *  point: a note you can only see by right-clicking the card is a note
 *  you'll only find if you already knew it was there.
 *
 *  Deliberately unlike the other two marks a card can wear. A tag is a
 *  colored tab straddling an EDGE, placed wherever its definition says; a
 *  pushpin sits at the top center and is decoration. This is a fixed green
 *  circle in the TOP-LEFT corner (the bottom-right until 2026-09-08, his
 *  move), the same place on every card at every tier, so "has notes" is
 *  a single spot your eye can sweep.
 *
 *  Filled = something is still open on this card. Hollow = there are
 *  notes but all of them are CLOSED (done, caveat or declined --
 *  state/noteStates.ts) -- the record is kept (that's the whole point of
 *  closing rather than deleting), so the card shouldn't go blank, but it
 *  shouldn't read as outstanding work either.
 *
 *  A RING round either of those means something on this card is new to
 *  you (state/notesRead). Deliberately a third FORM rather than a third
 *  color: "always the same color in the same corner" is what makes the
 *  dot one spot the eye can sweep, and a second hue would put it in
 *  competition with the tags. The ring is painted by an injected rule
 *  keyed on `data-note-host` -- see board/noteMarks.ts for why it can't
 *  be a prop.
 *
 *  `on` is threaded rather than read from settings here: the Overview
 *  isn't virtualized, so this renders thousands of times and each instance
 *  would otherwise subscribe to the settings store separately.
 * ------------------------------------------------------------------ */

export function NoteDot({
  notes,
  on,
  nodeId,
  hostScale = 1,
}: {
  notes: Note[] | undefined;
  on: boolean;
  /* The card this dot sits on, so the unread rule can name it. Static --
   * it never changes for a given card, so it costs no re-renders. */
  nodeId?: string;
  /* The CSS scale the host card is drawn under, if any. The Overview's
   * miniatures are real detail-sized cards squashed by a transform, which
   * would take a 7px dot down to under 2px -- an indicator you can't see at
   * the zoom level you'd use it at is not an indicator. Cancelling the
   * host's scale keeps it the same size everywhere. */
  hostScale?: number;
}) {
  if (!on) return null;
  /* no notes yet: a hidden dot the pulse rule (board/noteMarks.ts) can
     show while a first note is being written for this card */
  if (!notes?.length) return <span className="note-dot pending" data-note-host={nodeId} aria-hidden />;
  const open = notes.filter((n) => !isClosed(n.state)).length;
  const label =
    open > 0
      ? `${open} open note${open === 1 ? "" : "s"}`
      : `${notes.length} note${notes.length === 1 ? "" : "s"}, all closed`;
  return (
    <span
      className={"note-dot tip-left" + (open ? "" : " resolved")}
      /* the app's own tip, never a native title (owner, 2026-09-07) */
      data-tip={label}
      role="img"
      aria-label={label}
      data-note-host={nodeId}
      style={
        hostScale === 1
          ? undefined
          : { transform: `scale(${1 / hostScale})`, transformOrigin: "0 0" }
      }
    />
  );
}
