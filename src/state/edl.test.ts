import { describe, expect, it } from "vitest";
import { eventFrames, eventTitle, parseEdl } from "./edl";
import { DEFAULT_SHOT_ASPECT, edlFieldCounts, edlToBoard, EDL_FIELDS } from "./edlBoard";
import { rateFor } from "./timecode";

/* ------------------------------------------------------------------ *
 *  THE EDL PARSER, and the board it builds.
 *
 *  CMX3600 is a 1970s format with forty years of vendor dialects on
 *  top, so most of what is pinned here is TOLERANCE: the shapes a real
 *  Avid or Premiere export actually emits, and the promise that
 *  anything not understood is COUNTED rather than silently dropped.
 *  That count is the only signal a list parsed badly, so a test that
 *  lets it drift makes every future import bug invisible.
 * ------------------------------------------------------------------ */

const ndf30 = rateFor(30, false);
const r24 = rateFor(24, false);

/* A minimal, well-formed list: two cuts and a dissolve. */
const BASIC = `TITLE:   REEL 3 GRIEF V4
FCM: NON-DROP FRAME

001  A047C012 V     C        04:12:33:18 04:12:39:07 01:00:00:00 01:00:05:13
* FROM CLIP NAME:  ARIEL KITCHEN WIDE
002  A051C003 V     C        02:14:02:00 02:14:06:12 01:00:05:13 01:00:10:01
* FROM CLIP NAME:  JAY DOORWAY
003  B002C007 V     D    025 05:00:00:00 05:00:04:00 01:00:10:01 01:00:14:01
* FROM CLIP NAME:  RAIN EXTERIOR
`;

describe("parseEdl: the well-formed case", () => {
  const p = parseEdl(BASIC);

  it("reads the title and the drop-frame mode", () => {
    expect(p.title).toBe("REEL 3 GRIEF V4");
    expect(p.dropFrame).toBe(false);
  });

  it("reads every event, in order, with its four timecodes", () => {
    expect(p.events.length).toBe(3);
    expect(p.events[0]).toMatchObject({
      num: 1,
      reel: "A047C012",
      channel: "V",
      transition: "C",
      transitionFrames: null,
      srcIn: "04:12:33:18",
      recIn: "01:00:00:00",
      recOut: "01:00:05:13",
      clipName: "ARIEL KITCHEN WIDE",
    });
  });

  it("reads a transition's duration field, which only non-cuts carry", () => {
    expect(p.events[2].transition).toBe("D");
    expect(p.events[2].transitionFrames).toBe(25);
    // ...and a cut has none, rather than a zero that looks like a value
    expect(p.events[0].transitionFrames).toBeNull();
  });

  it("understands every line -- nothing counted as noise", () => {
    expect(p.unparsedLines).toBe(0);
    expect(p.audioOnlyEvents).toBe(0);
  });

  it("guesses a base from the frame fields, and a rate from that plus FCM", () => {
    expect(p.guessedBase).toBe(24); // nothing here uses a frame field >= 24
    expect(p.suggestedRate.drop).toBe(false);
  });
});

describe("parseEdl: the dialects a real export throws at it", () => {
  it("accepts a WIDE reel name -- the templates we tell people to use", () => {
    /* Plain CMX3600 truncates reels to 8 characters; Avid's File_32 /
     * File_129 and Premiere's "32-character names" widen it, and those
     * are exactly what the plan recommends. A parser assuming the narrow
     * form would break on its own advice. */
    const p = parseEdl(
      `001  A047C012_001_0830_S001 V  C  01:00:00:00 01:00:01:00 01:00:00:00 01:00:01:00\n`,
    );
    expect(p.events[0].reel).toBe("A047C012_001_0830_S001");
    expect(p.unparsedLines).toBe(0);
  });

  it("accepts `;` and `.` as the drop-frame separator", () => {
    const p = parseEdl(
      `FCM: DROP FRAME\n001  TAPE01 V  C  01:00:00;00 01:00:01;00 01:00:00;00 01:00:01;00\n`,
    );
    expect(p.dropFrame).toBe(true);
    expect(p.events.length).toBe(1);
    expect(p.events[0].recIn).toBe("01:00:00;00");
  });

  it("reads DROP FRAME without mistaking NON-DROP for it", () => {
    /* "NON-DROP FRAME" contains "DROP", so a naive test gets this exactly
     * backwards -- and being wrong here shifts every card. */
    expect(parseEdl("FCM: DROP FRAME\n").dropFrame).toBe(true);
    expect(parseEdl("FCM: NON-DROP FRAME\n").dropFrame).toBe(false);
    expect(parseEdl("FCM: NON DROP FRAME\n").dropFrame).toBe(false);
  });

  it("takes the FIRST FCM as the list's mode", () => {
    const p = parseEdl(`FCM: DROP FRAME\nFCM: NON-DROP FRAME\n`);
    expect(p.dropFrame).toBe(true);
  });

  it("keeps picture events and counts audio-only ones separately", () => {
    const p = parseEdl(
      `001  TAPE01 V   C  01:00:00:00 01:00:01:00 01:00:00:00 01:00:01:00\n` +
        `002  TAPE01 A   C  01:00:00:00 01:00:01:00 01:00:00:00 01:00:01:00\n` +
        `003  TAPE01 A2  C  01:00:00:00 01:00:01:00 01:00:00:00 01:00:01:00\n` +
        `004  TAPE01 AA  C  01:00:00:00 01:00:01:00 01:00:00:00 01:00:01:00\n` +
        `005  TAPE01 B   C  01:00:00:00 01:00:01:00 01:00:00:00 01:00:01:00\n` +
        `006  TAPE01 A2/V C  01:00:00:00 01:00:01:00 01:00:00:00 01:00:01:00\n`,
    );
    // V, B and A2/V carry picture; A, A2 and AA do not
    expect(p.events.map((e) => e.channel)).toEqual(["V", "B", "A2/V"]);
    expect(p.audioOnlyEvents).toBe(3);
    expect(p.unparsedLines).toBe(0);
  });

  it("attaches a comment to the event ABOVE it, audio events included", () => {
    /* An audio event still claims its own comments, or its clip name
     * would land on the previous PICTURE event and mislabel that card. */
    const p = parseEdl(
      `001  TAPE01 V  C  01:00:00:00 01:00:01:00 01:00:00:00 01:00:01:00\n` +
        `* FROM CLIP NAME:  PICTURE\n` +
        `002  TAPE01 A  C  01:00:00:00 01:00:01:00 01:00:00:00 01:00:01:00\n` +
        `* FROM CLIP NAME:  SOUND ONLY\n`,
    );
    expect(p.events.length).toBe(1);
    expect(p.events[0].clipName).toBe("PICTURE");
  });

  it("takes the FIRST clip name, not the last -- a dissolve names two", () => {
    const p = parseEdl(
      `001  TAPE01 V  D  025 01:00:00:00 01:00:01:00 01:00:00:00 01:00:01:00\n` +
        `* FROM CLIP NAME:  OUTGOING\n* TO CLIP NAME:  INCOMING\n`,
    );
    expect(p.events[0].clipName).toBe("OUTGOING");
  });

  it("reads a source file comment, and keeps unknown comments verbatim", () => {
    const p = parseEdl(
      `001  TAPE01 V  C  01:00:00:00 01:00:01:00 01:00:00:00 01:00:01:00\n` +
        `* SOURCE FILE: A047C012_230830.mxf\n* COMMENT: colour pass done\n`,
    );
    expect(p.events[0].sourceFile).toBe("A047C012_230830.mxf");
    expect(p.events[0].comments).toEqual(["COMMENT: colour pass done"]);
  });

  it("does not count legal header lines as noise, but does count real junk", () => {
    /* An honest `unparsedLines` is the ONLY signal that a list failed to
     * parse, so padding it with lines we understood and ignored would
     * make it useless. */
    const clean = parseEdl(
      `TITLE: X\nFCM: NON-DROP FRAME\nSPLIT:    AUDIO DELAY  00:00:01:00\nM2   TAPE01       048.0                01:00:00:00\n`,
    );
    expect(clean.unparsedLines).toBe(0);
    expect(parseEdl("this is not an EDL at all\nnor is this\n").unparsedLines).toBe(2);
  });

  it("does not count Avid's >>> source-table trailer lines as noise", () => {
    /* `>` is not a word character, so `>>>` inside the \b'd alternation
     * could never match -- every trailer line in an Avid export counted
     * as "not understood", padding the parser's one health signal. The
     * shipped bug this pins: a clean Avid list reporting dozens of
     * not-understood lines. */
    const p = parseEdl(
      `TITLE: X\n>>> SOURCE A047C012  DA-88\n>>> SOURCE B002R3NM  FILE\n>>>\n`,
    );
    expect(p.unparsedLines).toBe(0);
  });

  it("survives CRLF and a file with no trailing newline", () => {
    const p = parseEdl(
      `TITLE: X\r\n001  TAPE01 V  C  01:00:00:00 01:00:01:00 01:00:00:00 01:00:01:00`,
    );
    expect(p.events.length).toBe(1);
    expect(p.unparsedLines).toBe(0);
  });

  it("returns an empty, honest result for an empty file rather than throwing", () => {
    const p = parseEdl("");
    expect(p.events).toEqual([]);
    expect(p.unparsedLines).toBe(0);
  });
});

describe("eventTitle: what a card gets called", () => {
  const ev = (over: Partial<ReturnType<typeof parseEdl>["events"][0]>) => ({
    num: 7, reel: "TAPE01", channel: "V", transition: "C", transitionFrames: null,
    srcIn: "01:00:00:00", srcOut: "01:00:01:00", recIn: "01:00:00:00", recOut: "01:00:01:00",
    clipName: null, sourceFile: null, comments: [], ...over,
  });

  it("prefers the clip name -- the editor's own label", () => {
    expect(eventTitle(ev({ clipName: "ARIEL KITCHEN" }))).toBe("ARIEL KITCHEN");
  });

  it("falls back to the source file, then the reel", () => {
    expect(eventTitle(ev({ sourceFile: "a047.mxf" }))).toBe("a047.mxf");
    expect(eventTitle(ev({}))).toBe("TAPE01");
  });

  it("names black BLACK, not BL", () => {
    expect(eventTitle(ev({ reel: "BL" }))).toBe("Black");
  });

  it("never returns an empty title -- a gap must be visible on the board", () => {
    /* Numbered by the event's own listed number, not its index: lists
     * skip numbers, and the card should say what the LIST says. */
    expect(eventTitle(ev({ reel: "" }))).toBe("Shot 7");
    expect(eventTitle(ev({ reel: "AX" }))).toBe("Shot 7");
  });
});

describe("eventFrames: length in the CUT, from record times", () => {
  it("measures record, not source -- a speed effect makes them differ", () => {
    const p = parseEdl(
      `001  TAPE01 V  C  01:00:00:00 01:00:10:00 05:00:00:00 05:00:05:00\n`,
    );
    // source runs 10s, record runs 5s: the cut sees 5s
    expect(eventFrames(p.events[0], ndf30)).toBe(150);
  });

  it("returns null when the timecodes will not parse at this rate", () => {
    /* The caller's signal that the RATE is wrong, not the event. */
    const p = parseEdl(`001  TAPE01 V  C  01:00:00:00 01:00:01:00 01:00:00:29 01:00:01:29\n`);
    expect(eventFrames(p.events[0], ndf30)).toBe(30);
    expect(eventFrames(p.events[0], r24)).toBeNull(); // frame 29 cannot exist at base 24
  });
});

describe("edlToBoard: the board that comes out", () => {
  const p = parseEdl(BASIC);
  const b = edlToBoard(p, { rate: r24 });

  it("is a two-rung Scene > Shot beat map", () => {
    expect(b.levels.map((l) => l.name)).toEqual(["Scene", "Shot"]);
    expect(b.type).toBeUndefined(); // absent = cut board
  });

  it("puts every shot in ONE scene, in order", () => {
    expect(b.roots.length).toBe(1);
    expect(b.roots[0].children.map((c) => c.title)).toEqual([
      "ARIEL KITCHEN WIDE", "JAY DOORWAY", "RAIN EXTERIOR",
    ]);
  });

  it("names the board and its one scene from the EDL's TITLE", () => {
    expect(b.title).toBe("REEL 3 GRIEF V4");
    expect(b.roots[0].title).toBe("REEL 3 GRIEF V4");
  });

  it("CARRIES ITS FIELD DEFINITIONS, which is what keeps the values alive", () => {
    /* The rule this repo has learned three times: anything writing nodes
     * whose values reference definitions the doc lacks must land the
     * definitions in the SAME transaction. Attaching them to the Board is
     * how this path inherits importBoard's `withVocabulary` rather than
     * re-earning the bug. */
    expect(b.fields?.map((f) => f.id).sort()).toEqual(
      Object.values(EDL_FIELDS).slice().sort(),
    );
  });

  it("files values under STABLE ids, so a second EDL joins the same columns", () => {
    const shot = b.roots[0].children[0];
    expect(shot.values?.[EDL_FIELDS.shotNo]).toBe("1");
    expect(shot.values?.[EDL_FIELDS.clip]).toBe("ARIEL KITCHEN WIDE");
    expect(shot.values?.[EDL_FIELDS.reel]).toBe("A047C012");
    expect(shot.values?.[EDL_FIELDS.srcIn]).toBe("04:12:33:18");
    expect(shot.values?.[EDL_FIELDS.srcOut]).toBe("04:12:39:07");
    expect(shot.values?.[EDL_FIELDS.recIn]).toBe("01:00:00:00");
    expect(shot.values?.[EDL_FIELDS.recOut]).toBe("01:00:05:13");
    expect(shot.values?.[EDL_FIELDS.duration]).toBe("00:00:05:13"); // 5s13f at base 24
  });

  it("SOURCE AND RECORD ARE FOUR FIELDS, not two that happen to match", () => {
    /* On a single-source cut-down they hold identical values, which is a
     * fact about that list rather than about the format (owner's
     * correction, 2026-08-27). Source is where a shot sits in the
     * RUSHES, record is where it sits in the CUT; collapsing them would
     * throw the distinction away on every multi-source list. */
    const same = parseEdl(
      `001  AX V  C  00:00:01:00 00:00:02:00 00:00:01:00 00:00:02:00\n`,
    );
    const v = edlToBoard(same, { rate: r24 }).roots[0].children[0].values!;
    for (const k of [EDL_FIELDS.srcIn, EDL_FIELDS.srcOut, EDL_FIELDS.recIn, EDL_FIELDS.recOut]) {
      expect(v[k]).toBeDefined();
    }
    expect(Object.keys(v)).toContain(EDL_FIELDS.srcOut);
    expect(Object.keys(v)).toContain(EDL_FIELDS.recOut);
  });

  it("PLACES NOTHING on the card face -- import the data, arrange it later", () => {
    /* The owner's call (2026-08-27), and it deleted a whole options UI:
     * the app already has a layout editor (the metadata panel's slot
     * preview) and a way to push one layout onto every card at a tier
     * (ops.applyLayout), so the importer's job is to get the data in
     * with nothing arranged. It also leaves the face clear for the
     * picture Phase B puts there. */
    for (const shot of b.roots[0].children) expect(shot.slots).toBeUndefined();
  });

  it("offers every category, so they are all there to arrange", () => {
    expect(b.fields?.map((f) => f.name)).toEqual([
      "Shot", "Clip name", "Source Reel", "Source In", "Source Out",
      "Record In", "Record Out", "Duration", "Transition",
    ]);
  });

  it("writes a Transition only when it is NOT a plain cut", () => {
    /* "C" on every card is noise, not data -- the blank-is-not-a-value
     * rule applied to a value that is technically present. */
    expect(b.roots[0].children[0].values?.[EDL_FIELDS.transition]).toBeUndefined();
    expect(b.roots[0].children[2].values?.[EDL_FIELDS.transition]).toBe("D 25");
  });

  it("writes NO blank values -- a blank is not a value", () => {
    /* Otherwise every card in a 500-shot board carries a map of empty
     * strings, which the ops would strip anyway (ADR 0003). */
    const p2 = parseEdl(`001  BL V  C  00:00:00:00 00:00:00:00 01:00:00:00 01:00:00:00\n`);
    const shot = edlToBoard(p2, { rate: r24 }).roots[0].children[0];
    expect(Object.values(shot.values ?? {}).every((v) => v !== "")).toBe(true);
    expect(shot.values?.[EDL_FIELDS.reel]).toBeUndefined(); // BL is not a reel name
    expect(shot.values?.[EDL_FIELDS.duration]).toBeUndefined(); // zero-length
  });

  it("treats AX as a placeholder too, not as a reel name", () => {
    /* AX is the CMX code for "auxiliary" -- what a list carries when the
     * source is not a tape, which for a file-based cut is every event.
     * Found on the owner's first real export: 15 of 16 events read AX,
     * which as a value writes "AX" onto every card and calls it data. */
    const p2 = parseEdl(
      `001  AX V  C  00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00\n* FROM CLIP NAME: A.mp4\n`,
    );
    const shot = edlToBoard(p2, { rate: r24 }).roots[0].children[0];
    expect(shot.values?.[EDL_FIELDS.reel]).toBeUndefined();
    expect(shot.title).toBe("A.mp4"); // the clip name still names it
  });

  it("falls back to a SHOT NUMBER when nothing names the event", () => {
    /* An AX event with no clip name has no name anywhere, and a blank
     * card would hide a real gap in the list. */
    const p2 = parseEdl(`007  AX V  C  00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00\n`);
    expect(edlToBoard(p2, { rate: r24 }).roots[0].children[0].title).toBe("Shot 7");
  });

  it("mints fresh ids per build, so importing the same file twice cannot collide", () => {
    const a = edlToBoard(p, { rate: r24 });
    const c = edlToBoard(p, { rate: r24 });
    expect(a.id).not.toBe(c.id);
    expect(a.roots[0].children[0].id).not.toBe(c.roots[0].children[0].id);
  });

  it("falls back to a title rather than producing a nameless board", () => {
    const bare = edlToBoard(parseEdl("001  TAPE01 V  C  01:00:00:00 01:00:01:00 01:00:00:00 01:00:01:00\n"), { rate: r24 });
    expect(bare.title).toBe("Imported shots");
    expect(edlToBoard(p, { rate: r24, title: "  My Cut  " }).title).toBe("My Cut");
  });
});

describe("the frame rate is guessed from RECORD timecodes only", () => {
  it("ignores a source timecode from a faster CLIP", () => {
    /* Record timecode is in the SEQUENCE's rate; source timecode is in
     * each source CLIP's own, and those can legitimately differ -- a 50
     * fps clip cut into a 24 fps timeline carries source frame fields up
     * to 49 and says nothing about the sequence.
     *
     * From the owner's second real export (2026-08-27): one event off a
     * `rig-demo.mov` had a source out of 00:00:11:40, so guessing from
     * all four timecodes returned base 50 for a plainly 24-base cut. */
    const p = parseEdl(
      `001  AX V  C  00:00:00:00 00:00:03:02 00:00:00:00 00:00:03:02\n` +
        `002  AX V  C  00:00:08:21 00:00:11:40 00:00:03:02 00:00:08:02\n`,
    );
    expect(p.guessedBase).toBe(24);
    expect(p.suggestedRate.label).toBe("23.976");
  });

  it("still follows the RECORD timecodes up when they need a bigger base", () => {
    /* The guess must not be pinned to 24 -- a PAL list counts to 24 in
     * its record frames and genuinely needs base 25, and forcing 23.976
     * there would make every timecode unparseable. */
    const p = parseEdl(`001  AX V  C  00:00:00:00 00:00:01:00 00:00:00:00 00:00:00:24\n`);
    expect(p.guessedBase).toBe(25);
  });

  it("A WRONG RATE IS INVISIBLE IN A DURATION, which is why it is asked", () => {
    /* A duration is formatted at the same base it was parsed at, so the
     * string round-trips whatever the base -- the error only surfaces in
     * Phase B, where it puts every frame grab in the wrong place. This
     * pins the trap so nobody "simplifies" the rate picker away. */
    const p = parseEdl(`001  AX V  C  00:00:00:00 00:00:03:02 00:00:00:00 00:00:03:02\n`);
    const at24 = edlToBoard(p, { rate: rateFor(24, false) });
    const at50 = edlToBoard(p, { rate: rateFor(50, false) });
    const dur = (b: typeof at24) => b.roots[0].children[0].values?.[EDL_FIELDS.duration];
    expect(dur(at24)).toBe(dur(at50)); // identical string, different reality
    expect(rateFor(24, false).exact).not.toBe(rateFor(50, false).exact);
  });
});

describe("choosing which categories to import", () => {
  const p = parseEdl(BASIC);

  it("counts what each category would actually fill", () => {
    /* The set of categories is fixed by the FORMAT; which of them hold
     * anything is per file. BASIC has no reel placeholders and one
     * dissolve, so: reel on all three, transition on one. */
    const c = edlFieldCounts(p, r24);
    expect(c[EDL_FIELDS.shotNo]).toBe(3);
    expect(c[EDL_FIELDS.recIn]).toBe(3);
    expect(c[EDL_FIELDS.reel]).toBe(3);
    expect(c[EDL_FIELDS.transition]).toBe(1); // only the dissolve
  });

  it("reports 0 for a category this list cannot fill", () => {
    const only = parseEdl(`001  AX V  C  00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00\n`);
    const c = edlFieldCounts(only, r24);
    expect(c[EDL_FIELDS.reel]).toBe(0); // AX is not a reel name
    expect(c[EDL_FIELDS.transition]).toBe(0); // a plain cut
    expect(c[EDL_FIELDS.clip]).toBe(0); // no clip-name comment
  });

  it("omitting `fields` brings in everything, which is what a non-UI caller wants", () => {
    const b = edlToBoard(p, { rate: r24 });
    expect(b.fields?.length).toBe(9);
  });

  it("a chosen set drops both the VALUES and the DEFINITIONS", () => {
    /* Both halves matter: a category defined with nothing filed under it
     * is a row in everyone's metadata panel forever, on every card, for
     * a column this import decided not to carry. */
    const keep = new Set([EDL_FIELDS.shotNo, EDL_FIELDS.recIn]);
    const b = edlToBoard(p, { rate: r24, fields: keep });
    expect(b.fields?.map((f) => f.id)).toEqual([EDL_FIELDS.shotNo, EDL_FIELDS.recIn]);
    for (const shot of b.roots[0].children) {
      expect(Object.keys(shot.values ?? {}).sort()).toEqual(
        [EDL_FIELDS.recIn, EDL_FIELDS.shotNo].sort(),
      );
    }
  });

  it("an empty set imports the cards and no metadata at all", () => {
    const b = edlToBoard(p, { rate: r24, fields: new Set() });
    expect(b.roots[0].children.length).toBe(3); // the shots are still there
    expect(b.fields).toEqual([]);
    for (const shot of b.roots[0].children) expect(shot.values).toEqual({});
  });
});

describe("the shot card is the shape of the footage", () => {
  const p = parseEdl(BASIC);

  it("is 16:9 when no proxy said otherwise", () => {
    const b = edlToBoard(p, { rate: r24 });
    expect(b.levels[b.levels.length - 1].aspect).toBeCloseTo(DEFAULT_SHOT_ASPECT, 5);
  });

  it("takes the proxy's real aspect, so 4:3 and scope come out right", () => {
    expect(edlToBoard(p, { rate: r24, aspect: 4 / 3 }).levels[1].aspect).toBeCloseTo(4 / 3, 5);
    expect(edlToBoard(p, { rate: r24, aspect: 2.39 }).levels[1].aspect).toBeCloseTo(2.39, 5);
  });

  it("refuses a measurement that cannot be a frame", () => {
    /* A zero-height video or a corrupt header would otherwise produce a
     * card that cannot be seen or cannot be escaped. */
    for (const bad of [0, -2, NaN, Infinity]) {
      expect(edlToBoard(p, { rate: r24, aspect: bad }).levels[1].aspect).toBeCloseTo(
        DEFAULT_SHOT_ASPECT,
        5,
      );
    }
    expect(edlToBoard(p, { rate: r24, aspect: 99 }).levels[1].aspect).toBe(4); // clamped
  });

  it("does NOT write the aspect onto the shared ladder constant", () => {
    /* DOC_SHOTLIST_LEVELS is a module constant shared with the landing
     * picker; mutating it would silently re-shape every shot-list board
     * made afterwards in the same session. */
    edlToBoard(p, { rate: r24, aspect: 2.39 });
    expect(edlToBoard(p, { rate: r24 }).levels[1].aspect).toBeCloseTo(DEFAULT_SHOT_ASPECT, 5);
  });

  it("gives each board its OWN levels, not a shared reference", () => {
    const a = edlToBoard(p, { rate: r24 });
    const c = edlToBoard(p, { rate: r24 });
    expect(a.levels).not.toBe(c.levels);
    expect(a.levels[0]).not.toBe(c.levels[0]);
  });
});
