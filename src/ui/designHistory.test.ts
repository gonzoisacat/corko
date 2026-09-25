import { describe, expect, it } from "vitest";
import { RUN_GAP, canRedo, canUndo, emptyHistory, push, redo, undo } from "./designHistory";

/* The designer's own undo: a branch beside the board's (owner, 2026-09-04). */
describe("designHistory", () => {
  it("steps back through discrete edits and forward again", () => {
    let h = emptyHistory<string>();
    h = push(h, "a", null, 0);
    h = push(h, "b", null, 10);
    expect(canUndo(h)).toBe(true);
    const u1 = undo(h, "c")!;
    expect(u1.value).toBe("b");
    const u2 = undo(u1.history, u1.value)!;
    expect(u2.value).toBe("a");
    expect(undo(u2.history, "a")).toBeNull();
    const r = redo(u2.history, "a")!;
    expect(r.value).toBe("b");
    expect(canRedo(r.history)).toBe(true);
  });
  it("coalesces a run of same-key edits close in time into one step", () => {
    let h = emptyHistory<string>();
    h = push(h, "start", "color:pin", 0);
    h = push(h, "mid1", "color:pin", 100);
    h = push(h, "mid2", "color:pin", 300);
    expect(h.past).toEqual(["start"]);
    expect(undo(h, "end")!.value).toBe("start");
  });
  it("ends a run on a different key or after the gap", () => {
    let h = emptyHistory<string>();
    h = push(h, "a", "color:pin", 0);
    h = push(h, "b", "color:board", 100);
    h = push(h, "c", "color:board", 100 + RUN_GAP + 1);
    expect(h.past).toEqual(["a", "b", "c"]);
  });
  it("an edit after undo drops the future", () => {
    let h = emptyHistory<string>();
    h = push(h, "a", null, 0);
    const u = undo(h, "b")!;
    expect(canRedo(u.history)).toBe(true);
    const h2 = push(u.history, u.value, null, 50);
    expect(canRedo(h2)).toBe(false);
  });
});
