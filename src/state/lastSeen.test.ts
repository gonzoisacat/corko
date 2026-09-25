import { describe, expect, it } from "vitest";
import { FRESH_MS, isFresh } from "./lastSeen";

/* The whole rule of the Open Board door: a stamp inside the window means
 * this is the same sitting, so restore silently; anything else asks. */
describe("isFresh", () => {
  const now = 1_700_000_000_000;

  it("a stamp from moments ago is the same sitting", () => {
    expect(isFresh(now - 1000, now)).toBe(true);
  });

  it("a stamp from just inside the window still is", () => {
    expect(isFresh(now - (FRESH_MS - 1), now)).toBe(true);
  });

  it("a stamp older than the window is not", () => {
    expect(isFresh(now - FRESH_MS, now)).toBe(false);
    expect(isFresh(now - 24 * 60 * 60 * 1000, now)).toBe(false);
  });

  /* A browser that has never been here gets asked, rather than dropped
   * onto whichever board sorted first. */
  it("no stamp at all is not fresh", () => {
    expect(isFresh(null, now)).toBe(false);
  });

  /* Garbage in storage reads as absent, never as a number that happens
   * to be inside the window. */
  it("a stamp that is not a number is not fresh", () => {
    expect(isFresh(NaN, now)).toBe(false);
    expect(isFresh(Infinity, now)).toBe(false);
  });

  /* A clock that moved backwards (a laptop waking, a timezone fix) must
   * not strand somebody behind the door forever. */
  it("a stamp from the future reads as fresh", () => {
    expect(isFresh(now + 60_000, now)).toBe(true);
  });

  it("the window is adjustable for a caller that wants a different one", () => {
    expect(isFresh(now - 5000, now, 1000)).toBe(false);
    expect(isFresh(now - 5000, now, 10_000)).toBe(true);
  });
});
