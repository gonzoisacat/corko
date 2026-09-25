import { describe, expect, it } from "vitest";
import { NOTE_STATES, isClosed, noteStateDef, readNoteState } from "./noteStates";

/* The owner's legend as data: six states, and the open/closed split the
 * dot and the filter both read. */
describe("note states", () => {
  it("is the legend, in the legend's order, open first", () => {
    expect(NOTE_STATES.map((s) => s.id)).toEqual(["open", "done", "caveat", "declined", "later", "discuss", "other"]);
  });

  it("closed is answered one way or another; open is still somebody's to do", () => {
    expect(NOTE_STATES.filter((s) => isClosed(s.id)).map((s) => s.id)).toEqual(["done", "caveat", "declined"]);
    expect(NOTE_STATES.filter((s) => !isClosed(s.id)).map((s) => s.id)).toEqual(["open", "later", "discuss", "other"]);
  });

  it("reads the old pair: resolved is done, open is open", () => {
    expect(readNoteState("resolved")).toBe("done");
    expect(readNoteState("open")).toBe("open");
  });

  it("reads every current state as itself and anything else as open", () => {
    for (const s of NOTE_STATES) expect(readNoteState(s.id)).toBe(s.id);
    expect(readNoteState("nonsense")).toBe("open");
    expect(readNoteState(undefined)).toBe("open");
    expect(readNoteState(3)).toBe("open");
  });

  it("an unknown id falls back to open rather than throwing", () => {
    expect(noteStateDef("bogus" as never).id).toBe("open");
  });
});
