import { describe, expect, it } from "vitest";
import { driverSlot, type DrivingInfo } from "./DrivingWheel";
import type { PaneSlot } from "./paneFocus";
import type { DriverMode } from "../state/panes";

/* ------------------------------------------------------------------ *
 *  driverSlot is the ONE statement of who drives, with two callers that
 *  must agree: the wheel lights on it (fed the focused slot) and
 *  App.steerSibling gates on it (fed the gesture's own slot). This suite
 *  pins the rule itself, and then pins that it matches the inline gate
 *  steerSibling used to carry -- the drift the shared function exists to
 *  prevent.
 * ------------------------------------------------------------------ */

const info = (over: Partial<DrivingInfo>): DrivingInfo => ({
  twoUp: true,
  sameBoard: true,
  on: true,
  driver: "active",
  ...over,
});

describe("driverSlot", () => {
  it("a lone panel drives nothing", () => {
    expect(driverSlot(info({ twoUp: false }), "a")).toBeNull();
    expect(driverSlot(info({ twoUp: false }), "b")).toBeNull();
  });

  it("two different boards drive nothing (steering would be meaningless)", () => {
    expect(driverSlot(info({ sameBoard: false }), "a")).toBeNull();
  });

  it("driving off drives nothing, whatever the mode", () => {
    for (const driver of ["active", "a", "b"] as const) {
      expect(driverSlot(info({ on: false, driver }), "a")).toBeNull();
    }
  });

  it("active mode: the acting panel is the driver, by definition", () => {
    expect(driverSlot(info({}), "a")).toBe("a");
    expect(driverSlot(info({}), "b")).toBe("b");
  });

  it("a pinned mode names its panel regardless of who acts", () => {
    expect(driverSlot(info({ driver: "a" }), "a")).toBe("a");
    expect(driverSlot(info({ driver: "a" }), "b")).toBe("a"); // b acts, a still drives
    expect(driverSlot(info({ driver: "b" }), "a")).toBe("b");
    expect(driverSlot(info({ driver: "b" }), "b")).toBe("b");
  });

  /* The refactor's parity proof: before driverSlot was shared,
   * steerSibling's gate was `driving && (driver === "active" || driver
   * === from)` plus the two-panels-one-board condition its handle check
   * enforced. "May the acting panel steer?" must answer identically
   * through driverSlot for every combination. */
  it("steering is allowed exactly where the old inline gate allowed it", () => {
    const bools = [true, false];
    const drivers: DriverMode[] = ["active", "a", "b"];
    const slots: PaneSlot[] = ["a", "b"];
    for (const twoUp of bools)
      for (const sameBoard of bools)
        for (const on of bools)
          for (const driver of drivers)
            for (const acting of slots) {
              const d = info({ twoUp, sameBoard, on, driver });
              const shared = driverSlot(d, acting) === acting;
              const legacy =
                twoUp && sameBoard && on && (driver === "active" || driver === acting);
              expect(shared, JSON.stringify({ twoUp, sameBoard, on, driver, acting })).toBe(
                legacy,
              );
            }
  });
});
