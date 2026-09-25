import { afterEach, describe, expect, it } from "vitest";
import { gridDrag, ownGesture } from "./gridDrag";

/* The live gesture store is one per app; a board open in BOTH columns of
 * a split must not let column B read, steer or end column A's drag. */
describe("a grid gesture belongs to the column that started it", () => {
  afterEach(() => gridDrag.end());

  it("is visible only to its owner", () => {
    gridDrag.start({ kind: "resize", owner: "a", id: "c1", span: { w: 6, h: 4 } });
    expect(ownGesture("a")?.kind).toBe("resize");
    expect(ownGesture("b")).toBeNull();
    gridDrag.update({ span: { w: 7, h: 4 } });
    expect(ownGesture("b")).toBeNull();
    expect((ownGesture("a") as { span: { w: number } }).span.w).toBe(7);
  });

  it("a yarn in flight is not drawn by the other column either", () => {
    gridDrag.start({ kind: "yarn", owner: "b", from: "c1", x: 1, y: 1, over: null });
    expect(ownGesture("a")).toBeNull();
    expect(ownGesture("b")?.kind).toBe("yarn");
  });
});
