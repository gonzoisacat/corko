import type { EdlEvent } from "./edl";
import { framesToSeconds, parseTC, type Rate } from "./timecode";

/* ------------------------------------------------------------------ *
 *  WHICH FRAME OF THE PROXY BELONGS TO WHICH SHOT.
 *
 *  Pure arithmetic, kept apart from the video work in board/stills.ts so
 *  the part that can be wrong silently is the part that is tested. Every
 *  card on the board is placed by this, and getting it wrong does not
 *  throw -- it just quietly grabs the wrong picture.
 * ------------------------------------------------------------------ */

/* WHERE IN THE SHOT TO GRAB, in frames after its record-in.
 *
 * Landing exactly ON the record-in is the single most likely thing to
 * get wrong here: seeking to a cut can return the last frame of the
 * OUTGOING shot, so a whole board comes back one shot late. Stepping in
 * also clears a dissolve's overlap and picks a more representative frame
 * than the first one.
 *
 * A quarter of the way in, clamped: 2 frames is enough to clear a cut on
 * a very short shot, 10 is enough to clear a typical dissolve without
 * drifting far into a long one. */
export const GRAB_MIN = 2;
export const GRAB_MAX = 10;
export function grabOffsetFrames(durationFrames: number): number {
  if (!Number.isFinite(durationFrames) || durationFrames <= 1) return 0;
  const quarter = Math.floor(durationFrames / 4);
  /* Never past the shot's own out point: a 3-frame shot gets frame 1,
   * not frame 2. */
  return Math.min(Math.max(quarter, GRAB_MIN), GRAB_MAX, durationFrames - 1);
}

export interface GrabPlan {
  /* Index into the parse's `events`, so a result can be matched back to
   * the card it belongs to without relying on array alignment. */
  index: number;
  /* Seconds into the proxy. THE one number the whole feature turns on. */
  seconds: number;
  /* The frame this resolves to, for reporting and for the contact sheet
   * to show what it grabbed. */
  frames: number;
}

export interface GrabOptions {
  rate: Rate;
  /* The sequence's own start, as a frame count. Record timecodes are
   * absolute sequence positions and the video starts at zero, so this is
   * what maps one to the other. Defaults to the first event's record-in,
   * which is right for any list that starts where the sequence does. */
  startFrames: number;
  /* A global correction, in frames, from the contact sheet's nudge.
   *
   * ONE number for the whole board, because THE ERROR IS UNIFORM: a
   * mis-stated sequence start, or a slate on the head of the export,
   * shifts every shot by exactly the same amount. That is what makes a
   * twelve-frame contact sheet worth looking at -- fix it once and all
   * five hundred are right. */
  nudgeFrames?: number;
}

/* Where to seek for each event. Events whose record-in will not parse at
 * this rate are DROPPED rather than guessed at: a wrong rate should show
 * up as missing stills, not as a board of wrong pictures. */
export function planGrabs(events: EdlEvent[], opts: GrabOptions): GrabPlan[] {
  const { rate, startFrames } = opts;
  const nudge = opts.nudgeFrames ?? 0;
  const out: GrabPlan[] = [];
  events.forEach((e, index) => {
    const inF = parseTC(e.recIn, rate);
    const outF = parseTC(e.recOut, rate);
    if (inF === null) return;
    const dur = outF === null ? 0 : outF - inF;
    const frames = inF + grabOffsetFrames(dur) + nudge - startFrames;
    /* A negative lands before the file starts -- which happens the
     * moment someone nudges backwards past the head. Clamp to 0 rather
     * than skip: the first shot still gets a picture, and the nudge
     * stays reversible. */
    out.push({ index, frames, seconds: framesToSeconds(Math.max(0, frames), rate) });
  });
  return out;
}

/* The sequence start to assume: the first event's record-in.
 *
 * Right for anything that starts where its sequence does, which is the
 * normal case -- and when it is wrong it is wrong by a CONSTANT, which
 * the nudge fixes in one move. That is why this is a default rather than
 * a question: a question would make everyone answer something they
 * usually do not need to think about, to avoid a case the contact sheet
 * shows you anyway. */
export function defaultStartFrames(events: EdlEvent[], rate: Rate): number {
  for (const e of events) {
    const f = parseTC(e.recIn, rate);
    if (f !== null) return f;
  }
  return 0;
}

/* The shots to show in the contact sheet: a spread across the WHOLE
 * list, not the first twelve.
 *
 * The first twelve of a 500-shot board are its first two minutes, and a
 * head-offset error looks identical at both ends -- but a WRONG RATE
 * does not. A rate error compounds with distance, so it is invisible in
 * the first minute and obvious by the end. Sampling across the list
 * makes the sheet able to show the difference between the two mistakes
 * it exists to catch. */
export function contactSample<T>(items: T[], n = 12): { item: T; index: number }[] {
  if (items.length <= n) return items.map((item, index) => ({ item, index }));
  const out: { item: T; index: number }[] = [];
  for (let i = 0; i < n; i++) {
    const index = Math.round((i * (items.length - 1)) / (n - 1));
    out.push({ item: items[index], index });
  }
  return out;
}
