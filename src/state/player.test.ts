import { describe, expect, it } from "vitest";
import {
  captureStamps,
  endChain,
  formatRuntime,
  PLAYHEAD_FIELD,
  seekSecondsFor,
  startFrames,
  TIMECODE_FIELD,
} from "./player";
import { RATES } from "./timecode";
import { board4 } from "../test/fixtures";

const r24 = RATES.find((r) => r.label === "24")!;
const r2397 = RATES.find((r) => r.label === "23.976")!;

describe("the capture stamps", () => {
  it("timecode is the start plus the playhead; runtime is the playhead alone", () => {
    const s = captureStamps(10, r24, { startTC: "01:00:00:00", stampTimecode: true, stampRuntime: true });
    expect(s).toEqual({ timecode: "01:00:10:00", runtime: "0:10" });
  });

  it("each stamp is its own checkbox", () => {
    expect(captureStamps(1, r24, { startTC: "01:00:00:00", stampTimecode: false, stampRuntime: true })).toEqual({
      runtime: "0:01",
    });
    expect(captureStamps(1, r24, { startTC: "01:00:00:00", stampTimecode: true, stampRuntime: false })).toEqual({
      timecode: "01:00:01:00",
    });
  });

  it("a start that does not parse un-offsets rather than blocking", () => {
    expect(startFrames("nonsense", r24)).toBe(0);
    expect(captureStamps(2, r24, { startTC: "", stampTimecode: true, stampRuntime: false })).toEqual({
      timecode: "00:00:02:00",
    });
  });

  it("rounds the playhead to a frame at the real rate", () => {
    // 23.976: one second of wall clock is 23.976 frames -> 24 frames counted
    expect(captureStamps(1, r2397, { startTC: "00:00:00:00", stampTimecode: true, stampRuntime: false })).toEqual({
      timecode: "00:00:01:00",
    });
  });
});

describe("the runtime clock", () => {
  it("reads as a clock with no leading zeros", () => {
    expect(formatRuntime(0)).toBe("0:00");
    expect(formatRuntime(5)).toBe("0:05");
    expect(formatRuntime(317)).toBe("5:17");
    expect(formatRuntime(3917.9)).toBe("1:05:17");
    expect(formatRuntime(36000)).toBe("10:00:00");
  });
});

describe("seeking to a card", () => {
  it("is the inverse of the timecode stamp", () => {
    const s = captureStamps(37.5, r24, { startTC: "01:00:00:00", stampTimecode: true, stampRuntime: false });
    expect(seekSecondsFor(s.timecode!, r24, "01:00:00:00")).toBeCloseTo(37.5, 3);
  });

  it("refuses a value that is not a timecode, and clamps one before the start", () => {
    expect(seekSecondsFor("DAY 06", r24, "01:00:00:00")).toBeNull();
    expect(seekSecondsFor("00:59:00:00", r24, "01:00:00:00")).toBe(0);
  });
});

describe("the end of the board", () => {
  it("is the last card at every tier down the last-child path", () => {
    const b = board4(); // r1 > d1 > s1 (b1 b2 b3), s2 (b4)
    const chain = endChain(b);
    expect(chain.map((n) => n.id)).toEqual(["r1", "d1", "s2", "b4"]);
    expect(chain[0]).toBe(b.roots[b.roots.length - 1]);
  });

  it("stops where the board stops", () => {
    const b = board4();
    const lastScene = endChain(b)[2];
    lastScene.children = [];
    expect(endChain(b).map((n) => n.id)).toEqual(["r1", "d1", "s2"]);
    b.roots = [];
    expect(endChain(b)).toEqual([]);
  });
});

/* THE NAMES THE STAMPS WEAR ON A BOARD. Pinned because they are strings
 * that board/capture.ts matches an existing category by -- a change here
 * points new captures at a different category and leaves everything
 * already written under the old one. The playhead's was "Runtime" until
 * 2026-09-10, and the owner renamed it for claiming the wrong thing:
 * it is a position IN a file, not the length OF one. */
describe("the stamp field names", () => {
  it("are the two the player writes", () => {
    expect(TIMECODE_FIELD).toBe("Timecode");
    expect(PLAYHEAD_FIELD).toBe("Playhead");
  });

  it("are not the same category", () => {
    expect(PLAYHEAD_FIELD).not.toBe(TIMECODE_FIELD);
  });
});
