import { guessBase, parseTC, rateFor, type Rate } from "./timecode";

/* ------------------------------------------------------------------ *
 *  CMX3600 EDL -- the parser.
 *
 *  Pure and tolerant. It reads a plain-text edit decision list into
 *  events; turning those into a board is edlBoard.ts's job, and pulling
 *  frames out of a video is Phase B's. Nothing here touches the doc.
 *
 *  WHY THIS FORMAT. It is the only interchange both Avid and Premiere
 *  export natively that a browser can read. AAF is Avid's richer native
 *  format and is Microsoft Compound File Binary -- no mature browser
 *  parser, so it means WASM or a server, against the self-deployable
 *  premise (spec Sec 3 / Sec 12). FCP7 XML is strictly better from
 *  Premiere and worth a second parser later, but Avid cannot produce it,
 *  so it would serve half the users. See docs/explorations/
 *  edl-shot-board.md for the full comparison.
 *
 *  TOLERANT IS THE DESIGN, not laziness. CMX3600 is a 1970s punched-tape
 *  format with forty years of vendor dialects on top: field widths vary,
 *  reel names got wider twice, drop-frame is spelled two ways, and every
 *  NLE writes its own comment lines. A parser that refuses a list it
 *  half-understands is useless against real exports, so anything
 *  unrecognized is COUNTED and skipped rather than thrown -- and the
 *  count is surfaced, so a list that parsed badly says so instead of
 *  quietly producing six cards.
 * ------------------------------------------------------------------ */

export interface EdlEvent {
  num: number; // the event number as listed (not an index -- lists skip)
  reel: string; // source reel / tape / file name, per the export template
  channel: string; // V, A, A2, AA, B, A2/V ...
  transition: string; // C (cut), D (dissolve), W### (wipe), K (key)
  transitionFrames: number | null; // the D/W duration field, when present
  srcIn: string;
  srcOut: string;
  recIn: string;
  recOut: string;
  clipName: string | null; // * FROM CLIP NAME
  sourceFile: string | null; // * SOURCE FILE
  comments: string[]; // every other * line, kept verbatim
}

export interface EdlParse {
  title: string;
  dropFrame: boolean;
  events: EdlEvent[];
  /* The smallest timecode base consistent with every frame field seen.
   * A FLOOR, not a fact -- see timecode.ts guessBase. */
  guessedBase: number;
  /* What the rate would be if you took the guess and the FCM line at
   * face value. Offered as the default; the importer lets it be changed. */
  suggestedRate: Rate;
  audioOnlyEvents: number; // parsed, then dropped -- a shot board is picture
  unparsedLines: number; // neither blank, comment, header, nor event
}

/* An event line, and the only regex that matters here.
 *
 *   003  A047C012 V     C        04:12:33:18 04:12:39:07 01:00:14:22 01:00:20:11
 *   004  BL       V     D    025 00:00:00:00 00:00:02:00 01:00:20:11 01:00:22:11
 *
 * Notes on the fiddly parts:
 *  - the reel is `\S+` rather than a fixed 8 columns. Plain CMX3600
 *    truncates reels to 8 characters, but Avid's File_32 / File_129
 *    templates and Premiere's "32-character names" option widen it --
 *    which is exactly what we tell people to switch on, so the parser
 *    must not assume the narrow form it is trying to avoid.
 *  - the transition-duration field is optional and only present on
 *    non-cuts, so it is an optional group rather than a second regex.
 *  - `[:;.]` before the frames: `;` is the conventional drop-frame
 *    spelling and `.` turns up in a few dialects. */
const TC = String.raw`\d{1,3}:\d{2}:\d{2}[:;.]\d{1,3}`;
const EVENT_RE = new RegExp(
  String.raw`^(\d{1,6})\s+(\S+)\s+(\S+)\s+(\S+?)(?:\s+(\d{1,4}))?\s+(${TC})\s+(${TC})\s+(${TC})\s+(${TC})\s*$`,
);

/* Header/marker lines that are legal and carry nothing we need. Listed
 * so they are not counted as unparsed noise -- an honest `unparsedLines`
 * is the signal that a list did NOT parse, so it must not be padded with
 * lines we understood perfectly and simply ignored.
 *
 * `>>>` (Avid's source-table trailer lines) sits OUTSIDE the \b group:
 * a word boundary needs a word character on one side, and `>` followed
 * by a space has none -- so with `>>>` inside the group the alternative
 * could never match anything, and every trailer line in an Avid export
 * padded the one number this exists to keep honest. Found by testing
 * the regex, not by a failing list; pinned below. */
const KNOWN_HEADERS =
  /^(?:(?:FCM|TITLE|SPLIT|AUD|VIDEO|MOTION|EFFECTS?|GPI|M2|SOURCE TABLE)\b|>>>)/i;

const CLIP_NAME_RE = /^\*\s*FROM\s+CLIP\s+NAME:\s*(.*)$/i;
const SOURCE_FILE_RE = /^\*\s*(?:SOURCE\s+FILE|FROM\s+FILE):\s*(.*)$/i;

/* Does this channel carry picture? A shot board is a picture board, so
 * audio-only events are parsed (they are valid, and counting them is how
 * we can say "12 audio events ignored") and then dropped.
 *
 * CMX channel codes: V, A, A2, AA (both audio), B (both audio AND
 * video), and slashed combinations like A2/V or AA/V. So picture is
 * "contains a V" or "is exactly B". */
const hasPicture = (channel: string): boolean => {
  const c = channel.toUpperCase();
  return c.includes("V") || c === "B";
};

export function parseEdl(text: string): EdlParse {
  const lines = text.split(/\r\n|\r|\n/);
  let title = "";
  let dropFrame = false;
  let sawFcm = false;
  const events: EdlEvent[] = [];
  let audioOnlyEvents = 0;
  let unparsedLines = 0;
  /* Comments attach to the event ABOVE them, which is the CMX
   * convention -- `* FROM CLIP NAME:` follows the event it names. */
  let last: EdlEvent | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    if (line.startsWith("*")) {
      if (!last) continue; // a comment before any event: a file header
      const cn = CLIP_NAME_RE.exec(line);
      if (cn) {
        /* FIRST ONE WINS. A dissolve carries both a FROM and a TO clip
         * name, and there can be repeats; the first is the one belonging
         * to this event's own source. */
        if (last.clipName === null) last.clipName = cn[1].trim();
        continue;
      }
      const sf = SOURCE_FILE_RE.exec(line);
      if (sf) {
        if (last.sourceFile === null) last.sourceFile = sf[1].trim();
        continue;
      }
      last.comments.push(line.replace(/^\*\s?/, "").trim());
      continue;
    }

    const t = /^TITLE:\s*(.*)$/i.exec(line);
    if (t) {
      title = t[1].trim();
      continue;
    }
    const f = /^FCM:\s*(.*)$/i.exec(line);
    if (f) {
      /* The FIRST FCM is the list's mode. Per-event FCM lines are legal
       * in a mixed list, but a shot board takes one rate for the whole
       * sequence, and a cut that genuinely mixes them is beyond what
       * this is for. */
      if (!sawFcm) {
        dropFrame = /DROP/i.test(f[1]) && !/NON.?DROP/i.test(f[1]);
        sawFcm = true;
      }
      continue;
    }

    const m = EVENT_RE.exec(line);
    if (m) {
      const ev: EdlEvent = {
        num: +m[1],
        reel: m[2],
        channel: m[3],
        transition: m[4],
        transitionFrames: m[5] === undefined ? null : +m[5],
        srcIn: m[6],
        srcOut: m[7],
        recIn: m[8],
        recOut: m[9],
        clipName: null,
        sourceFile: null,
        comments: [],
      };
      /* `last` is set even for audio events, so their own comment lines
       * are absorbed by them rather than landing on the previous picture
       * event and mislabelling a card. */
      last = ev;
      if (hasPicture(ev.channel)) events.push(ev);
      else audioOnlyEvents++;
      continue;
    }

    if (!KNOWN_HEADERS.test(line)) unparsedLines++;
  }

  /* GUESS FROM THE RECORD TIMECODES ONLY, never the source ones.
   *
   * Record timecode is in the SEQUENCE's rate, which is the rate this
   * whole import is about. Source timecode is in each source CLIP's own
   * rate, and those can legitimately differ -- a 50 fps clip cut into a
   * 24 fps timeline carries source frame fields up to 49, and that says
   * nothing whatever about the sequence.
   *
   * Found on the owner's second real export (2026-08-27): one event from
   * a `rig-demo.mov` carried a source out of `00:00:11:40`, so the
   * all-four-timecodes version guessed base 50 for a plainly 24-base
   * cut. Max source frame field 40, max record frame field 22.
   *
   * WHAT MAKES IT NASTY IS THAT IT LOOKS FINE. A duration is formatted
   * at the same base it was parsed at, so `00:00:03:02` round-trips to
   * `00:00:03:02` whatever the base -- the wrong rate is INVISIBLE in
   * Phase A and only surfaces in Phase B, where it puts every frame grab
   * in the wrong place. Which is also the argument for the rate picker
   * existing at all. */
  const guessedBase = guessBase(events.flatMap((e) => [e.recIn, e.recOut]));
  return {
    title,
    dropFrame,
    events,
    guessedBase,
    suggestedRate: rateFor(guessedBase, dropFrame),
    audioOnlyEvents,
    unparsedLines,
  };
}

/* REEL NAMES THAT NAME NOTHING.
 *
 * `BL` is the CMX code for black and `AX` for "auxiliary" -- what a list
 * carries when the source is not a tape, which for a file-based cut is
 * every event. Both are real events and neither is a reel NAME, so
 * filing them as a Source Reel value writes "AX" onto every card in the
 * board and calls it data.
 *
 * Found on the owner's first real export (2026-08-27): a single-source
 * cut-down where 15 of 16 events read AX. */
const PLACEHOLDER_REELS = new Set(["BL", "AX"]);
export const isRealReel = (reel: string): boolean =>
  !!reel && !PLACEHOLDER_REELS.has(reel.toUpperCase());

/* What a card should be CALLED. The clip name is the editor's own label
 * and the best title available; the reel is a fallback because on some
 * templates it IS the file name; and an event with neither still gets a
 * card rather than a blank one, because a gap in the list should be
 * visible on the board rather than silently absent. */
export function eventTitle(e: EdlEvent): string {
  const name = e.clipName || e.sourceFile || (isRealReel(e.reel) ? e.reel : "");
  if (name) return name;
  /* BL is black -- a real event, and naming it "BL" on a card says less
   * than saying what it is. AX just means "not a tape", which is not a
   * name for anything, so those fall through to the event number. */
  return e.reel.toUpperCase() === "BL" ? "Black" : `Shot ${e.num}`;
}

/* An event's length in frames, from its RECORD times -- the length it
 * occupies in the cut, which is what a shot board is about. Source
 * duration can differ (speed effects), and record is the honest one.
 *
 * Returns null when either timecode will not parse at this rate, which
 * is the caller's signal that the rate is wrong rather than that the
 * event is. */
export function eventFrames(e: EdlEvent, rate: Rate): number | null {
  const a = parseTC(e.recIn, rate);
  const b = parseTC(e.recOut, rate);
  if (a === null || b === null) return null;
  return b - a;
}
