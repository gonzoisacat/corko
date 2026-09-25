import { describe, expect, it } from "vitest";
import { parseEdl } from "./edl";
import { GRAB_MAX, GRAB_MIN, contactSample, defaultStartFrames, grabOffsetFrames, planGrabs } from "./shotGrab";
import { rateFor } from "./timecode";

/* ------------------------------------------------------------------ *
 *  WHICH FRAME BELONGS TO WHICH SHOT.
 *
 *  Pinned because this is the part that goes wrong SILENTLY: nothing
 *  throws when the arithmetic is off, the board just quietly wears the
 *  wrong pictures, and on a 500-shot import nobody checks all of them.
 * ------------------------------------------------------------------ */

const r24 = rateFor(24, false);

describe("grabOffsetFrames: never land ON the cut", () => {
  it("steps a quarter into the shot, within bounds", () => {
    expect(grabOffsetFrames(24)).toBe(6); // a 1s shot at 24
    expect(grabOffsetFrames(200)).toBe(GRAB_MAX); // a long shot is capped
    expect(grabOffsetFrames(12)).toBe(3);
  });

  it("clears the cut even on a very short shot", () => {
    /* Seeking exactly to a record-in can return the last frame of the
     * OUTGOING shot, so a whole board comes back one shot late. This is
     * the line that prevents it. */
    expect(grabOffsetFrames(4)).toBe(GRAB_MIN);
    expect(grabOffsetFrames(8)).toBe(GRAB_MIN);
  });

  it("never runs past the shot's own out point", () => {
    /* A 3-frame shot must get frame 1, not frame 2 -- reaching into the
     * NEXT shot is the same bug in the other direction. */
    expect(grabOffsetFrames(3)).toBe(2);
    expect(grabOffsetFrames(2)).toBe(1);
    expect(grabOffsetFrames(1)).toBe(0);
    expect(grabOffsetFrames(0)).toBe(0);
  });

  it("survives junk rather than producing NaN seconds", () => {
    expect(grabOffsetFrames(NaN)).toBe(0);
    expect(grabOffsetFrames(-5)).toBe(0);
  });
});

describe("planGrabs: record timecode -> seconds into the proxy", () => {
  const p = parseEdl(
    `001  AX V  C  00:00:00:00 00:00:02:00 01:00:00:00 01:00:02:00\n` +
      `002  AX V  C  00:00:00:00 00:00:04:00 01:00:02:00 01:00:06:00\n`,
  );

  it("subtracts the sequence start, so shot 1 sits near zero", () => {
    /* The video begins at 0 and the record timecodes are absolute
     * sequence positions -- getting this wrong by an hour is the classic
     * failure, and it is what the nudge exists to fix in one move. */
    const start = defaultStartFrames(p.events, r24);
    expect(start).toBe(86400); // 01:00:00:00 at base 24
    const g = planGrabs(p.events, { rate: r24, startFrames: start });
    /* Shot 1 runs 48 frames, so a quarter is 12 -- capped at GRAB_MAX,
     * which is the point of the cap: past ten frames you are drifting
     * into the shot rather than clearing its head. */
    expect(g[0].frames).toBe(GRAB_MAX);
    expect(g[0].seconds).toBeCloseTo(GRAB_MAX / r24.exact, 6);
  });

  it("uses the EXACT rate, so 23.976 is not 24", () => {
    const g = planGrabs(p.events, { rate: r24, startFrames: 86400 });
    /* 10 frames of 23.976 is fractionally LONGER than 10 of 24 -- small
     * here and 3.6 seconds by the end of an hour, which is why this goes
     * through framesToSeconds rather than dividing by 24. */
    expect(g[0].seconds).toBeGreaterThan(GRAB_MAX / 24);
    expect(g[0].seconds).toBeCloseTo((GRAB_MAX * 1001) / 24000, 9);
  });

  it("applies ONE nudge to every shot, because the error is uniform", () => {
    const a = planGrabs(p.events, { rate: r24, startFrames: 86400 });
    const b = planGrabs(p.events, { rate: r24, startFrames: 86400, nudgeFrames: 7 });
    a.forEach((x, i) => expect(b[i].frames - x.frames).toBe(7));
  });

  it("clamps a backwards nudge at the head instead of going negative", () => {
    /* Reached the moment someone nudges back past the start of the file.
     * The first shot still gets a picture and the nudge stays
     * reversible. */
    const g = planGrabs(p.events, { rate: r24, startFrames: 86400, nudgeFrames: -500 });
    expect(g[0].seconds).toBe(0);
    expect(g[0].frames).toBeLessThan(0); // the intent is kept, only the seek is clamped
  });

  it("DROPS an event it cannot read rather than guessing at it", () => {
    /* A record timecode that will not parse means the rate is wrong. A
     * missing still says so; a guessed one would put a wrong picture on
     * a card and say nothing. */
    const bad = parseEdl(`001  AX V  C  00:00:00:00 00:00:01:00 00:00:00:29 00:00:01:29\n`);
    expect(planGrabs(bad.events, { rate: r24, startFrames: 0 })).toEqual([]);
    expect(planGrabs(bad.events, { rate: rateFor(30, false), startFrames: 0 }).length).toBe(1);
  });

  it("carries the event INDEX, not the shot number", () => {
    /* A list can skip and repeat event numbers; the index is the only
     * thing guaranteed to match one card. */
    expect(planGrabs(p.events, { rate: r24, startFrames: 0 }).map((g) => g.index)).toEqual([0, 1]);
  });
});

describe("defaultStartFrames", () => {
  it("takes the first event's record-in", () => {
    const p = parseEdl(`003  AX V  C  00:00:00:00 00:00:01:00 01:00:05:00 01:00:06:00\n`);
    expect(defaultStartFrames(p.events, r24)).toBe(86400 + 5 * 24);
  });

  it("skips a leading event it cannot read, rather than answering 0", () => {
    const p = parseEdl(
      `001  AX V  C  00:00:00:00 00:00:01:00 00:00:00:29 00:00:01:29\n` +
        `002  AX V  C  00:00:00:00 00:00:01:00 01:00:00:00 01:00:01:00\n`,
    );
    expect(defaultStartFrames(p.events, r24)).toBe(86400);
  });

  it("answers 0 for an empty list rather than throwing", () => {
    expect(defaultStartFrames([], r24)).toBe(0);
  });
});

describe("contactSample: spread across the WHOLE list", () => {
  it("returns everything when the list is short", () => {
    expect(contactSample([1, 2, 3], 12).map((x) => x.item)).toEqual([1, 2, 3]);
  });

  it("spans first to last, so a compounding error is visible", () => {
    /* The first twelve of a 500-shot board are its first two minutes. A
     * head offset looks the same at both ends; a WRONG RATE does not --
     * it compounds with distance, so it is invisible early and obvious
     * at the end. Sampling across is what lets the sheet tell the two
     * mistakes apart. */
    const items = Array.from({ length: 500 }, (_, i) => i);
    const s = contactSample(items, 12);
    expect(s.length).toBe(12);
    expect(s[0].index).toBe(0);
    expect(s[11].index).toBe(499);
    // and monotonic, so the sheet reads left-to-right as the cut does
    for (let i = 1; i < s.length; i++) expect(s[i].index).toBeGreaterThan(s[i - 1].index);
  });

  it("keeps each item's original index, for numbering the frames", () => {
    const items = Array.from({ length: 100 }, (_, i) => `shot${i}`);
    for (const x of contactSample(items, 12)) expect(x.item).toBe(`shot${x.index}`);
  });
});
