import { describe, expect, it } from "vitest";
import { pinColor, tilt } from "./tilt";

const STEPS = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];

describe("tilt", () => {
  it("is deterministic per id", () => {
    expect(tilt("b-abc-1")).toBe(tilt("b-abc-1"));
  });

  it("only ever lands on the half-degree steps between -2 and +2", () => {
    for (let i = 0; i < 200; i++) {
      expect(STEPS).toContain(tilt("b-ms4c0ytoxbrl-" + i.toString(36)));
    }
  });

  it("hits every step (including 0) roughly uniformly", () => {
    const counts = new Map<number, number>(STEPS.map((s) => [s, 0]));
    for (let i = 0; i < 900; i++) {
      const t = tilt("n-" + i.toString(36) + "-x");
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    // 900 ids over 9 steps: expect ~100 each; allow a generous band
    for (const s of STEPS) {
      const c = counts.get(s)!;
      expect(c, `step ${s} count`).toBeGreaterThan(50);
      expect(c, `step ${s} count`).toBeLessThan(160);
    }
  });

  it("varies across sequential ids (no same-tilt runs)", () => {
    const tilts = Array.from({ length: 12 }, (_, i) => tilt("b-ms4c0ytoxbrl-" + i.toString(36)));
    expect(new Set(tilts).size).toBeGreaterThanOrEqual(5);
  });
});

const hue = (id: string): number => Number(/hsl\((\d+),/.exec(pinColor(id))![1]);

describe("pinColor", () => {
  it("is deterministic per id", () => {
    expect(pinColor("b-abc-1")).toBe(pinColor("b-abc-1"));
  });

  it("spreads sequential ids across the hue wheel (no same-color runs)", () => {
    // cards created in sequence share everything but the trailing counter --
    // the old hash gave such ids hues ~1 degree apart, so a freshly typed
    // row wore near-identical pins
    const ids = Array.from({ length: 10 }, (_, i) => "b-ms4c0ytoxbrl-" + i.toString(36));
    const hues = ids.map(hue);
    const gaps = hues.slice(1).map((h, i) => {
      const d = Math.abs(h - hues[i]);
      return Math.min(d, 360 - d);
    });
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(20); // neighbors never look alike
    const buckets = new Set(hues.map((h) => Math.floor(h / 60)));
    expect(buckets.size).toBeGreaterThanOrEqual(4); // and the row spans the wheel
  });
});
