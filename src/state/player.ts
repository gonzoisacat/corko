import type { Board, Node } from "./types";
import { formatTC, parseTC, secondsToFrames, framesToSeconds, type Rate } from "./timecode";

/* ------------------------------------------------------------------ *
 *  PLAYER MODE, the pure half (owner, 2026-09-06).
 *
 *  A proxy plays beside the Beat Map and a button mints a card of a
 *  chosen tier from the frame on screen, stamped with where it was in
 *  the cut. Two stamps, each behind its own checkbox, both on by
 *  default (his "ideally both would be captured anytime by default"):
 *
 *    Timecode -- the SEQUENCE's timecode: a start value you type once
 *                per video (01:00:00:00 is the convention) plus the
 *                playhead, at the rate you picked. The browser will not
 *                tell you a file's rate or its start, so both are asked,
 *                as the EDL import asks.
 *    Playhead -- elapsed from the file's own zero, as a clock reading
 *                with no leading zeros: "5:17", "1:05:17" (owner,
 *                2026-09-06) -- seconds, not frames; it is a where-
 *                abouts, not an edit point. The FIELD was called
 *                "Runtime" until 2026-09-10, and he renamed it for
 *                saying the wrong thing: "Runtime ... seems like we're
 *                calling out the TRT of something", where this is a
 *                position IN a file, not the length OF one.
 *
 *  Both land as METADATA VALUES under categories named here, not as a
 *  new field on the node: no doc-shape change, they can sit on the card
 *  face through a display slot, and the notes list reads them off the
 *  card. Phase 8's typed values can formalize this later.
 *
 *  WHERE A CAPTURE LANDS is a rule, not a toggle: at the END of the
 *  board, at the chosen tier, because the video plays forward and the
 *  board is being built in play order -- capture the first frame of a
 *  scene as a Scene, type its beats by hand while it plays, capture the
 *  next scene. `endChain` is the last card at every tier along the
 *  last-child path; a capture at depth d hangs off chain[d-1], minting
 *  any missing ancestor above it. He expects "go backwards and mint a
 *  scene in between" to come up once this is timecode-aware; not built.
 * ------------------------------------------------------------------ */

export const TIMECODE_FIELD = "Timecode";
/* THE FIELD'S NAME ON THE BOARD, and the only place it is written down.
 * `fieldIdNamed` (board/capture.ts) matches an existing category by NAME
 * and mints one when there is none, so changing this string points new
 * captures at a new category -- values already written under the old
 * name stay where they are, under a category that keeps existing. That
 * is a rename of what gets written NEXT, not a migration of what was.
 *
 * The internal names around this (`stampRuntime`, `stamps.runtime`,
 * `formatRuntime`) are deliberately left alone: they describe the
 * MEASUREMENT, which is still elapsed time, and `stampRuntime` is a
 * stored per-board preference key -- renaming it would quietly reset
 * everybody's toggle to the default. */
export const PLAYHEAD_FIELD = "Playhead";

export type CaptureVerb = "create" | "apply";

export interface PlayerPrefs {
  /* the button's opening word (owner, 2026-09-06): CREATE a new card
   * of a tier at the end of the board, or APPLY the frame to the card
   * selected on the board -- the same still, stamps and armed tags,
   * onto a card that already exists */
  verb: CaptureVerb;
  tierDepth: number; // index into board.levels (0 = top); clamped by the caller
  rateLabel: string; // a state/timecode.ts RATES label, or "" = not detected, not yet picked
  startTC: string; // the sequence's start, "hh:mm:ss:ff", when not following the file
  /* FOLLOW THE FILE (owner, 2026-09-06: "the file's embedded timecode
   * to be the 'timecode' figure ... if there isn't one, the runtime is
   * the fallback and we just wouldn't include timecode"): on, the start
   * is the container's timecode track (state/mp4tc.ts) and a file with
   * none gets no Timecode stamp at all; off, the start is `startTC`. */
  followEmbedded: boolean;
  stampTimecode: boolean;
  stampRuntime: boolean;
  /* CAPTURE STILL FRAME (owner, 2026-09-08): whether a capture hangs the
   * frame on the card at all. Off, the card is minted -- or the selected
   * one written to -- with the stamps and tags and no picture. */
  still: boolean;
  /* the tag strip at the foot of the panel, rolled up or not */
  tagsOpen: boolean;
}

export const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
  verb: "create",
  tierDepth: 0,
  rateLabel: "23.976",
  startTC: "01:00:00:00",
  followEmbedded: true,
  stampTimecode: true,
  stampRuntime: true,
  still: true,
  tagsOpen: true,
};

/* The start, in frames, or 0 when the box holds nothing parseable -- a
 * bad start must not stop a capture, only un-offset it. */
export function startFrames(startTC: string, rate: Rate): number {
  return parseTC(startTC, rate) ?? 0;
}

/* Seconds as a clock reading, no leading zeros: 0:05, 5:17, 1:05:17. */
export function formatRuntime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/* The playhead as timecode(s). Seconds -> frames is rounded, since the
 * element's currentTime is a real number and a frame is not. */
export function captureStamps(
  seconds: number,
  rate: Rate,
  prefs: Pick<PlayerPrefs, "startTC" | "stampTimecode" | "stampRuntime">,
): { timecode?: string; runtime?: string } {
  const frames = secondsToFrames(seconds, rate);
  const out: { timecode?: string; runtime?: string } = {};
  if (prefs.stampTimecode) out.timecode = formatTC(frames + startFrames(prefs.startTC, rate), rate);
  if (prefs.stampRuntime) out.runtime = formatRuntime(seconds);
  return out;
}

/* A card's Timecode value -> where the playhead should go, in seconds,
 * or null when it does not parse at this rate. Negative (a timecode
 * before the typed start) is clamped to the head. The automatic seek
 * on selecting a card was CUT by the owner the same day ("that may be
 * unnecessary"); this stays for an explicit gesture, if one comes. */
export function seekSecondsFor(timecode: string, rate: Rate, startTC: string): number | null {
  const f = parseTC(timecode, rate);
  if (f === null) return null;
  return Math.max(0, framesToSeconds(f - startFrames(startTC, rate), rate));
}

/* The last card at every tier along the last-child path: chain[0] is
 * the last root, chain[1] its last child, and so on until a card has no
 * children. Shorter than the ladder when the end of the board is not
 * fully populated (a scene with no beats yet). */
export function endChain(board: Board): Node[] {
  const chain: Node[] = [];
  let nodes = board.roots;
  while (nodes.length) {
    const last = nodes[nodes.length - 1];
    chain.push(last);
    nodes = last.children;
  }
  return chain;
}

/* The playhead as a display string for the transport. */
export function displayTC(seconds: number, rate: Rate, startTC: string): string {
  return formatTC(secondsToFrames(seconds, rate) + startFrames(startTC, rate), rate);
}
