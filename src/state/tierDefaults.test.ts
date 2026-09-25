import { describe, expect, it } from "vitest";
import { TIER_DEFAULTS, tierDefault, withTierDefaults, targetFontSize } from "./tierDefaults";
import { LANDING_TEMPLATES, customLevels } from "./landingTemplates";
import { level } from "../test/fixtures";
import type { LevelDef } from "./types";

/* ------------------------------------------------------------------ *
 *  Per-tier defaults are keyed by HEIGHT ABOVE THE LEAF, so a rung keeps
 *  its shape whatever else the ladder does -- the same leaf-anchored
 *  rule as graduation, cross-board drops and the palette.
 * ------------------------------------------------------------------ */

const ladder = (n: number) => Array.from({ length: n }, (_, i) => level(`t${n - i}`));

describe("withTierDefaults", () => {
  it("gives T1 and T2 their own sizes, counting from the leaf", () => {
    const out = withTierDefaults(ladder(4));
    expect(out[3]).toMatchObject({ height: 80, aspect: 1.85, textSize: 20 }); // T1
    expect(out[2]).toMatchObject({ height: 90, aspect: 1.85, textSize: 30 }); // T2
  });

  it("keys off the LEAF, not the top -- T1 is T1 in any ladder", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const out = withTierDefaults(ladder(n));
      expect(out[out.length - 1].height).toBe(TIER_DEFAULTS[0].height);
      if (n >= 2) expect(out[out.length - 2].height).toBe(TIER_DEFAULTS[1].height);
    }
  });

  it("everything above T3 is the same shape", () => {
    const out = withTierDefaults(ladder(6));
    expect(out[2]).toMatchObject({ height: 125, aspect: 3, bandHeight: 90 }); // T4
    expect(out[1]).toMatchObject({ height: 125, aspect: 3, bandHeight: 90 }); // T5
    expect(out[0]).toMatchObject({ height: 125, aspect: 3, bandHeight: 90 }); // T6
    expect(tierDefault(99)).toBe(TIER_DEFAULTS[TIER_DEFAULTS.length - 1]);
  });

  /* expandText retired 2026-08-14: textSize is the TARGET size, and the
   * leaf is deliberately smaller than the rest -- a beat card is small
   * and carries the longest titles per pixel. */
  it("targets 30px everywhere, 20 on the leaf", () => {
    const out = withTierDefaults(ladder(5));
    expect(out[out.length - 1].textSize).toBe(20); // T1, the leaf
    for (const l of out.slice(0, -1)) expect(l.textSize).toBe(30);
  });

  it("stamps no expandText -- the flag is retired", () => {
    for (const l of withTierDefaults(ladder(5))) expect(l.expandText).toBeUndefined();
  });

  /* Both are stamped on a header tier even though only one applies at a
   * time -- that's why bandHeight is its own field. Turning "Full width"
   * off has to land on a real card, not a 90px-tall one. */
  it("a header tier carries BOTH its band height and its card size", () => {
    const t3 = withTierDefaults(ladder(4))[1];
    expect(t3.fullWidth).toBe(true);
    expect(t3.bandHeight).toBe(70);
    expect(t3.height).toBe(130);
    expect(t3.aspect).toBe(2.6);
  });

  it("never puts a band on the leaf or its lane", () => {
    const out = withTierDefaults(ladder(4));
    expect(out[3].fullWidth).toBeUndefined(); // T1
    expect(out[3].bandHeight).toBeUndefined();
    expect(out[2].fullWidth).toBeUndefined(); // T2 -- the cards lane
    // ...and a two-tier ladder is nothing BUT leaf and lane
    for (const l of withTierDefaults(ladder(2))) expect(l.fullWidth).toBeUndefined();
  });

  it("only FILLS GAPS -- a template that sets a size keeps it", () => {
    const levels = ladder(4);
    levels[3] = { ...levels[3], height: 200, textSize: 12 };
    const out = withTierDefaults(levels);
    expect(out[3].height).toBe(200);
    expect(out[3].textSize).toBe(12);
    expect(out[3].aspect).toBe(1.85); // ...but the rest still land
  });

  it("applies to every landing template and to a custom ladder", () => {
    for (const t of LANDING_TEMPLATES) {
      const out = withTierDefaults(t.levels);
      expect(out[out.length - 1].height).toBe(80);
      expect(out.every((l) => (l.textSize ?? 0) > 0)).toBe(true);
    }
    const custom = withTierDefaults(customLevels(["Chapter", "Sequence", "Shot"]));
    expect(custom[2].height).toBe(80); // T1
    expect(custom[0]).toMatchObject({ fullWidth: true, bandHeight: 70 }); // T3
  });
});

/* ------------------------------------------------------------------ *
 *  targetFontSize -- the expandText retirement's compatibility rule.
 *  See its header: while that flag was on, a title grew to fill its card
 *  and `textSize` was INERT, so a level still carrying it never chose a
 *  target and must read as unset. Without this, ~10 colleagues' boards
 *  would silently drop from filling the card to the 15px fallback that
 *  was stamped for a mode they never switched on.
 * ------------------------------------------------------------------ */
describe("targetFontSize", () => {
  const lvl = (over: Partial<LevelDef>): LevelDef => ({ ...level("X"), ...over });

  it("uses a chosen size when the tier opted out of expand", () => {
    expect(targetFontSize(lvl({ expandText: false, textSize: 30 }), true)).toBe(30);
    expect(targetFontSize(lvl({ textSize: 12 }), false)).toBe(12);
  });

  it("ignores the size a still-expanding tier carries -- it was never chosen", () => {
    expect(targetFontSize(lvl({ expandText: true, textSize: 15 }), true)).toBe(20);
    expect(targetFontSize(lvl({ expandText: true, textSize: 25 }), false)).toBe(30);
  });

  it("falls back per role when nothing is set", () => {
    expect(targetFontSize(lvl({}), true)).toBe(20);
    expect(targetFontSize(lvl({}), false)).toBe(30);
  });
});
