/* ------------------------------------------------------------------ *
 *  TIMECODE -- SMPTE strings <-> frame counts, drop-frame included.
 *
 *  Pure, and deliberately knows nothing about EDLs. It is written this
 *  way because it is SHARED WORK rather than import-only work: the
 *  spec's Phase 8 wants typed values with timecode arithmetic and
 *  running-time roll-ups per scene / day / reel, which is this module.
 *  Whichever lands first pays for the other, so nothing here may grow a
 *  dependency on where the timecode came from.
 *
 *  THE ONE RULE, and every drifting-timecode bug is a violation of it:
 *
 *      CONVERT TO AN ABSOLUTE FRAME COUNT FIRST, THEN DIVIDE BY THE
 *      EXACT RATE. Never go from a timecode to seconds directly.
 *
 *  A timecode is a LABEL for a frame number, counted at an integer rate
 *  (`base`). How long those frames take to play is a different number
 *  (`exact`), and at 23.976 or 29.97 the two differ by a factor of
 *  1000/1001 -- 0.1%, which is a frame every 33 seconds and half a
 *  second across an hour. Going "01:00:14:22 is 14.9 seconds" bakes that
 *  error in at every event; going via frames cannot.
 *
 *  DROP FRAME CHANGES THE LABELLING, NEVER THE COUNT. It exists because
 *  29.97 is not 30, so counting 30 labels a second drifts against the
 *  clock; DF skips two labels a minute (nine minutes in ten) to keep the
 *  timecode near wall time. It removes NUMBERS, not frames -- there is
 *  no missing picture -- so a frame count is the same either way and the
 *  drop only affects how that count is spelled.
 * ------------------------------------------------------------------ */

export interface Rate {
  /* Integer frames per timecode SECOND -- what the `ff` field counts to.
   * 23.976 and 24 both count to 24; 29.97 and 30 both count to 30. */
  base: number;
  /* Real frames per second, for turning a frame count into a duration.
   * The /1001 rates are exact fractions on purpose: 23.976 as a decimal
   * is already wrong in the fourth place. */
  exact: number;
  drop: boolean;
  label: string;
}

/* The rates an EDL from a real cut can be in. `base` is what a timecode
 * counts to; `exact` is what it plays at. Drop-frame is only defined for
 * the /1001 rates whose base divides by 15 (30 and 60), which is why
 * there is no "25 DF" -- PAL never needed one, 25 being exact. */
export const RATES: Rate[] = [
  { base: 24, exact: 24000 / 1001, drop: false, label: "23.976" },
  { base: 24, exact: 24, drop: false, label: "24" },
  { base: 25, exact: 25, drop: false, label: "25" },
  { base: 30, exact: 30000 / 1001, drop: true, label: "29.97 DF" },
  { base: 30, exact: 30000 / 1001, drop: false, label: "29.97 NDF" },
  { base: 30, exact: 30, drop: false, label: "30" },
  { base: 50, exact: 50, drop: false, label: "50" },
  { base: 60, exact: 60000 / 1001, drop: true, label: "59.94 DF" },
  { base: 60, exact: 60000 / 1001, drop: false, label: "59.94 NDF" },
  { base: 60, exact: 60, drop: false, label: "60" },
];

export const DEFAULT_RATE: Rate = RATES[0]; // 23.976, the documentary default

/* The rate for a (base, drop) pair, preferring the /1001 member -- which
 * is the right bias because a cut in 24.000 or 30.000 is rare and a cut
 * in 23.976 or 29.97 is the norm. An unknown base falls back rather than
 * throwing: this is reached from an import of a file we did not write. */
export function rateFor(base: number, drop: boolean): Rate {
  return (
    RATES.find((r) => r.base === base && r.drop === drop) ??
    RATES.find((r) => r.base === base) ??
    DEFAULT_RATE
  );
}

/* How many timecode LABELS a drop-frame rate skips per minute: 2 at 30,
 * 4 at 60. Zero for every non-drop rate, which is what makes the two
 * paths one formula rather than two. */
const dropPerMin = (r: Rate): number => (r.drop ? r.base / 15 : 0);

const TC_RE = /^(\d{1,3}):([0-5]\d):([0-5]\d)[:;.](\d{1,3})$/;

/* A timecode string -> an absolute frame count, or null if it is not a
 * timecode. A `;` or `.` before the frames is the common drop-frame
 * spelling (`01:00:00;00`) and is accepted whatever the rate says --
 * the RATE decides whether drop arithmetic applies, not the punctuation,
 * because plenty of tools emit `:` for drop-frame anyway.
 *
 * An out-of-range frame field (`ff >= base`) is REFUSED rather than
 * clamped: it means the rate is wrong, and a silently wrong frame count
 * is exactly the drift this module exists to prevent. */
export function parseTC(tc: string, rate: Rate): number | null {
  const m = TC_RE.exec(tc.trim());
  if (!m) return null;
  const [, hh, mm, ss, ff] = m;
  const h = +hh;
  const min = +mm;
  const s = +ss;
  const f = +ff;
  if (f >= rate.base) return null;
  const counted = ((h * 60 + min) * 60 + s) * rate.base + f;
  const d = dropPerMin(rate);
  if (!d) return counted;
  /* Drop-frame: subtract the labels that were never used. Nine minutes
   * in every ten skip `d` labels each, so the count of skipped labels is
   * d * (total minutes - the tenth minutes, which keep theirs). */
  const totalMin = h * 60 + min;
  return counted - d * (totalMin - Math.floor(totalMin / 10));
}

/* A frame count -> its timecode string. The inverse of parseTC, and
 * `timecode.test.ts` asserts the round trip rather than trusting that
 * the two formulas agree by inspection -- they are easy to write so they
 * almost agree.
 *
 * Negative counts format with a leading `-` instead of wrapping, because
 * a negative here means an offset ran off the head of the sequence and
 * that should look wrong rather than look like hour 23. */
export function formatTC(frames: number, rate: Rate): string {
  const neg = frames < 0;
  let n = Math.abs(Math.round(frames));
  const d = dropPerMin(rate);
  if (d) {
    /* Put the skipped labels back.
     *
     * A ten-minute block is one FULL minute (which keeps its labels)
     * followed by nine SHORT ones (which each lost `d`), so a whole
     * block is a flat 9*d, and inside the remainder it is `d` per short
     * minute the remainder has entered.
     *
     * The two easy ways to get this wrong, both of which the exhaustive
     * round-trip test catches: measuring the remainder against the SHORT
     * minute length instead of the full one, and forgetting that
     * entering a short minute at all already costs a whole `d`. */
    const fullMin = rate.base * 60; // minute 0 of a block
    const shortMin = fullMin - d; // minutes 1..9
    const per10 = fullMin + 9 * shortMin;
    const blocks = Math.floor(n / per10);
    const rem = n % per10;
    n += 9 * d * blocks;
    if (rem >= fullMin) n += d * (Math.floor((rem - fullMin) / shortMin) + 1);
  }
  const base = rate.base;
  const f = n % base;
  const totalSec = Math.floor(n / base);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p = (v: number, w = 2) => String(v).padStart(w, "0");
  const sep = rate.drop ? ";" : ":";
  return `${neg ? "-" : ""}${p(h)}:${p(m)}:${p(s)}${sep}${p(f)}`;
}

/* A frame COUNT as a duration string. Deliberately separate from
 * formatTC: a duration is an amount rather than a position, so it never
 * takes drop-frame's `;` (there is no wall-clock to stay aligned with)
 * and it should not be re-spelled by the drop arithmetic. */
export function formatDuration(frames: number, rate: Rate): string {
  const n = Math.max(0, Math.round(frames));
  const base = rate.base;
  const f = n % base;
  const totalSec = Math.floor(n / base);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${p(Math.floor(totalSec / 3600))}:${p(Math.floor(totalSec / 60) % 60)}:${p(
    totalSec % 60,
  )}:${p(f)}`;
}

/* Frames -> real seconds. THIS is the function that must be used to find
 * a point in a video file, and the only place `exact` is read. */
export const framesToSeconds = (frames: number, rate: Rate): number => frames / rate.exact;

/* ...and back, for turning a scrubbed position into a frame number. */
export const secondsToFrames = (seconds: number, rate: Rate): number =>
  Math.round(seconds * rate.exact);

/* THE RATE IS NOT IN THE FILE, which is a real gap in CMX3600 and not an
 * oversight here: an EDL states drop-frame (`FCM:`) and never states the
 * frame rate, so it cannot be read and has to be guessed or asked for.
 *
 * The only evidence a list carries is the largest frame field it uses:
 * a timecode counting to 30 must be a 30-base rate. So take the smallest
 * base that fits every value seen. It is a floor rather than an answer --
 * a 25 fps cut that happens never to use frame 24 looks like 24 -- but it
 * is right for anything with a few hundred events, it can only ever
 * under-estimate, and Phase B's contact sheet is where a wrong guess
 * becomes visible. Callers should offer it as a default, not apply it as
 * a fact. */
export function guessBase(timecodes: string[]): number {
  let maxFF = -1;
  for (const tc of timecodes) {
    const m = TC_RE.exec(tc.trim());
    if (m) maxFF = Math.max(maxFF, +m[4]);
  }
  if (maxFF < 0) return DEFAULT_RATE.base;
  for (const b of [24, 25, 30, 50, 60]) if (maxFF < b) return b;
  return 60;
}
