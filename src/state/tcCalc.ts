import { formatDuration, formatTC, parseTC, type Rate } from "./timecode";

/* ------------------------------------------------------------------ *
 *  THE TIMECODE CALCULATOR'S MODEL (owner, 2026-09-10), and it is three
 *  fields rather than two operands: IN, OUT and DURATION, where filling
 *  any two computes the third.
 *
 *  WHY NOT A + / - CALCULATOR, which is what he first sketched: each
 *  layout of one answers a single question. "How long is this scene" is
 *  out minus in; "where does it end" is in plus duration; "where must it
 *  start to end here" is out minus duration -- three questions, one
 *  relationship, and a two-box calculator makes you re-type into
 *  different boxes to ask each. The three-field form is also the shape
 *  editors already hold in their heads, since it is what every
 *  professional transport shows.
 *
 *  WHICH FIELD IS COMPUTED is simply the one you have not touched most
 *  recently. `held` is the two you last typed into, newest first; the
 *  third is derived and re-derives on every keystroke. Type into the
 *  derived one and it takes the place of the older held field, which
 *  becomes the new derived -- so the answer always moves out of the way
 *  of what you are telling it, and there is no mode to switch.
 *
 *  EVERYTHING IS FRAMES in here. That is timecode.ts's one rule --
 *  convert to an absolute frame count first, never to seconds -- and the
 *  reason this module exists rather than the arithmetic living in the
 *  component: seconds are a PRESENTATION of a frame count, and at 23.976
 *  or 29.97 doing the sum in seconds bakes in a 0.1% error, half a second
 *  across an hour.
 *
 *  A DURATION MAY BE NEGATIVE, and says so. Out before in is a thing you
 *  typed, not an error to swallow: showing "-00:00:12:04" tells you the
 *  two are the wrong way round, where clamping at zero would quietly
 *  read as a twelve-frame scene.
 * ------------------------------------------------------------------ */

export type TcField = "in" | "out" | "dur";
export const TC_FIELDS: TcField[] = ["in", "out", "dur"];

export interface TcCalc {
  /* Frame counts, or null for a field you have not filled in. */
  frames: Record<TcField, number | null>;
  /* The two fields last typed into, newest first. The one missing from
   * this pair is the computed one. */
  held: [TcField, TcField];
}

export const EMPTY_CALC: TcCalc = {
  frames: { in: null, out: null, dur: null },
  held: ["in", "out"], // so DURATION is the answer on first sight, the common case
};

/* The computed field: the one not being held. */
export function derivedOf(c: TcCalc): TcField {
  return TC_FIELDS.find((f) => f !== c.held[0] && f !== c.held[1]) ?? "dur";
}

function derive(c: TcCalc): TcCalc {
  const d = derivedOf(c);
  const { in: i, out: o, dur } = c.frames;
  let value: number | null = null;
  if (d === "dur") value = i !== null && o !== null ? o - i : null;
  else if (d === "out") value = i !== null && dur !== null ? i + dur : null;
  else value = o !== null && dur !== null ? o - dur : null;
  return { ...c, frames: { ...c.frames, [d]: value } };
}

/* Type into a field. Returns the whole state, re-derived. */
export function setField(c: TcCalc, field: TcField, frames: number | null): TcCalc {
  const held: [TcField, TcField] = c.held.includes(field)
    ? /* already one of the two: promote it, so the OTHER held one is the
         next to be evicted -- the field you are ignoring gives way first */
      [field, c.held.find((f) => f !== field) as TcField]
    : [field, c.held[0]];
  return derive({ frames: { ...c.frames, [field]: frames }, held });
}

/* Clear everything, keeping which field is the answer. */
export function clearCalc(c: TcCalc): TcCalc {
  return { frames: { in: null, out: null, dur: null }, held: c.held };
}

/* ---- mm:ss (ROUNDED): the same timecode, said out loud ------------- *
 *  A full timecode is exact and unreadable at a glance; "2:30" is how
 *  anybody says a scene's length. This is that, and it is deliberately
 *  NOT a conversion to real time.
 *
 *  IT IS A RE-READING OF THE LABEL, not a duration in seconds (owner,
 *  2026-09-10: "lets do mm:ss that's just a rounded re-configuration of
 *  the TC"). Take hh:mm:ss:ff, round the frames into the seconds, and
 *  pour the hours into the minutes. So 00:59:58:00 reads 59:58 and an
 *  hour reads 60:00 -- MINUTES RUN ON, past sixty and into three or four
 *  digits, because there is no hours column to carry into.
 *
 *  THE REASON IS WHAT IT IS FOR, in his words: "this is for creating
 *  simplified, readable overlay metadata for the cards more than doing
 *  hardcore second-accurate runtime math". An hour of 23.976 LABELS
 *  takes an hour and 3.6 real seconds, and a box that answered 1:00:02
 *  for 01:00:00:00 was right about physics and useless on a card.
 *
 *  The two boxes therefore agree exactly: "2:30" is 00:02:30:00 and back
 *  again, with rounding the only thing lost. (state/player.ts's
 *  `formatRuntime` is the OTHER thing -- real elapsed time from a file's
 *  zero -- and stays that way. Same shape, different question.)
 * ------------------------------------------------------------------ */

/* "2:30" / "1:05:17" / "90" -> seconds. Minutes and seconds may be
 * written with or without a leading zero; anything else is a null. */
export function parseClock(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  /* Bare digits fill from the right here too: the last two are SECONDS
   * and everything before them is minutes, however many there are --
   * "230" is two thirty and "12305" is a hundred and twenty-three
   * minutes. No hours place, matching what this box prints. */
  if (/^\d+$/.test(t)) {
    if (t.length > 6) return null;
    const sec = Number(t.slice(-2));
    const min = t.length > 2 ? Number(t.slice(0, -2)) : 0;
    return min * 60 + sec; // carries: "90" is a minute and a half
  }
  /* Written, it is mm:ss -- but an h:mm:ss somebody pastes is folded in
   * rather than refused, and comes back with its hours in the minutes. */
  if (!/^\d{1,4}(:\d{1,4}){0,2}$/.test(t)) return null;
  const parts = t.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  /* Carries here too, for the same reason the timecode field does: "1:75"
   * is a minute and seventy-five seconds, which is 2:15, and showing that
   * back beats refusing to take it. */
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/* Label-seconds -> "2:30" / "60:00" / "123:05". Minutes run on rather
 * than carrying into an hours column, which is the whole point. Signed,
 * for a backwards in/out. */
export function formatClock(seconds: number): string {
  const neg = seconds < 0;
  const n = Math.round(Math.abs(seconds));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${neg ? "-" : ""}${m}:${String(s).padStart(2, "0")}`;
}

/* ---- reading the three fields out -------------------------------- */

/* A POSITION (in / out) as a timecode. */
export const showPosition = (frames: number | null, rate: Rate): string =>
  frames === null ? "" : (frames < 0 ? "-" : "") + formatTC(Math.abs(frames), rate);

/* A LENGTH as a timecode, signed -- formatDuration clamps at zero on
 * purpose (it is used for real durations elsewhere), so the sign is
 * carried here rather than by changing what that function means. */
export const showDuration = (frames: number | null, rate: Rate): string =>
  frames === null ? "" : (frames < 0 ? "-" : "") + formatDuration(Math.abs(frames), rate);

/* ...and the same length as mm:ss, ROUNDED off the label rather than
 * converted to real time -- see the section header. */
export const showClock = (frames: number | null, rate: Rate): string => {
  if (frames === null) return "";
  const neg = frames < 0;
  const n = Math.abs(frames);
  const whole = Math.floor(n / rate.base);
  const ff = n % rate.base;
  const secs = whole + (ff * 2 >= rate.base ? 1 : 0); // round the frames into a second
  return formatClock(neg ? -secs : secs);
};

/* Typing INTO the mm:ss box: label seconds, so it is the exact inverse
 * of the box above and "2:30" lands on 00:02:30:00 rather than four
 * frames short of it. */
export const clockToFrames = (seconds: number, rate: Rate): number => Math.round(seconds * rate.base);

/* TYPING WITHOUT COLONS FILLS FROM THE RIGHT (owner-reported 2026-09-10:
 * "if i start with an 01 and don't use colons, it moves the numbers over
 * the wrong way"). Digits land in the FRAMES place first and push left
 * as you type, which is what every editing system does and the only
 * reading that lets you type a timecode left to right without stopping:
 *
 *     1        ->  00:00:00:01
 *     130      ->  00:00:01:30
 *     10000    ->  00:01:00:00
 *     1000000  ->  01:00:00:00
 *
 * It used to read a bare number as a raw FRAME COUNT, so "0100" was a
 * hundred frames rather than one second -- the numbers going the wrong
 * way. The frame count is still what the footer reports and is not worth
 * an ambiguous second meaning here.
 *
 * AND IT CARRIES rather than refusing (his follow-up: "it needs to be
 * flexible on entry essentially"). "130" at base 24 is one second and
 * thirty frames, a frame number that does not exist -- so it becomes
 * 00:00:02:06, the instant you described, shown back to you immediately.
 * Refusing would leave you staring at a field that will not take what
 * you typed; carrying answers and shows its working.
 *
 * A VALID LABEL IS PARSED AS ONE FIRST, which is what keeps drop-frame
 * right: `parseTC` knows which labels DF skips, and arithmetic on
 * segments does not. The carry is only reached for input that was not a
 * real label anyway, where a plain frame count is the honest reading. */
function fillRight(digits: string, rate: Rate): number | null {
  if (digits.length > 8) return null;
  const p = digits.padStart(8, "0");
  const seg = [p.slice(0, 2), p.slice(2, 4), p.slice(4, 6), p.slice(6, 8)].map(Number);
  const exact = parseTC(`${p.slice(0, 2)}:${p.slice(2, 4)}:${p.slice(4, 6)}:${p.slice(6, 8)}`, rate);
  if (exact !== null) return exact;
  const [hh, mm, ss, ff] = seg;
  return ((hh * 60 + mm) * 60 + ss) * rate.base + ff;
}

/* Typing into a position or duration field: a written timecode, or bare
 * digits filled from the right. */
export function parseAny(s: string, rate: Rate): number | null {
  const t = s.trim();
  if (!t) return null;
  const neg = t.startsWith("-");
  const body = (neg ? t.slice(1) : t).trim();
  if (!body) return null;
  const value = /^\d+$/.test(body) ? fillRight(body, rate) : parseTC(body, rate);
  if (value === null) return null;
  return neg ? -value : value;
}
