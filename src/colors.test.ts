import { describe, expect, it } from "vitest";
import {
  PALETTES,
  defaultLegend,
  paletteSwatches,
  paletteTierColor,
  NESTED_ENTRY_ID,
  tierDefaultFor,
  tierLabel,
  resolveNodeColor,
  resolveNodeColorId,
  resolveNodeEntry,
  bgTone,
  textColor,
} from "./colors";
import { level } from "./test/fixtures";
import type { LegendEntry } from "./state/types";

const bold = PALETTES.find((p) => p.id === "bold")!;

describe("paletteTierColor", () => {
  it("maps the default 4-tier ladder by role", () => {
    const levels = [
      { ...level("reel"), variant: "reel" as const },
      { ...level("section"), variant: "section" as const },
      level("scene"),
      level("beat"),
    ];
    expect(paletteTierColor(bold, levels, "reel")).toBe(bold.light);
    expect(paletteTierColor(bold, levels, "section")).toBe(bold.dark);
    expect(paletteTierColor(bold, levels, "scene")).toBe(bold.mid);
    expect(paletteTierColor(bold, levels, "beat")).toBe(bold.leaf);
  });

  /* Anchored at the LEAF, so the rungs keep their colors as a ladder
   * gets taller: T4 is `light` in a 4-tier board and in a 6-tier one,
   * and the extras go ABOVE it. (It used to anchor `light` at the top
   * and walk the extras down, which inverted on deep ladders.) */
  it("keeps T1..T4 fixed however tall the ladder is, extras on top", () => {
    const levels = [
      { ...level("show"), variant: "reel" as const },
      { ...level("episode"), variant: "reel" as const },
      { ...level("section"), variant: "section" as const },
      level("scene"),
      level("beat"),
    ];
    expect(paletteTierColor(bold, levels, "beat")).toBe(bold.leaf); // T1
    expect(paletteTierColor(bold, levels, "scene")).toBe(bold.mid); // T2
    expect(paletteTierColor(bold, levels, "section")).toBe(bold.dark); // T3
    expect(paletteTierColor(bold, levels, "episode")).toBe(bold.light); // T4
    expect(paletteTierColor(bold, levels, "show")).toBe(bold.extras[0]); // T5
  });

  it("ignores `variant` -- a custom ladder of all-sections still steps", () => {
    const levels = [
      { ...level("a"), variant: "section" as const },
      { ...level("b"), variant: "section" as const },
      { ...level("c"), variant: "section" as const },
      level("d"),
    ];
    expect(paletteTierColor(bold, levels, "a")).toBe(bold.light); // T4
    expect(paletteTierColor(bold, levels, "b")).toBe(bold.dark); // T3
    expect(paletteTierColor(bold, levels, "c")).toBe(bold.mid); // T2
  });

  it("a 2-tier ladder is just mid + leaf", () => {
    const levels = [level("scene"), level("card")];
    expect(paletteTierColor(bold, levels, "scene")).toBe(bold.mid);
    expect(paletteTierColor(bold, levels, "card")).toBe(bold.leaf);
  });

  it("every palette previews exactly 6 swatches", () => {
    for (const p of PALETTES) expect(paletteSwatches(p)).toHaveLength(6);
  });

  /* The picker's row and the board must be the same list read two ways,
   * or the swatches advertise colors the tiers don't get. */
  it("the preview row IS the tier ladder, T1 first", () => {
    const levels = [level("t4"), level("t3"), level("t2"), level("t1")];
    const row = paletteSwatches(bold);
    expect(row.slice(0, 4)).toEqual(
      ["t1", "t2", "t3", "t4"].map((id) => paletteTierColor(bold, levels, id)),
    );
    expect(row[0]).toBe(bold.leaf); // T1 leads
  });
});

/* The id a card advertises as `data-color`. The legend's hover-highlight
 * matches on it in CSS, so it must name the entry that actually PAINTED the
 * card -- including when the card only inherits its tier's default. If the
 * two resolutions ever diverge, hovering a swatch lights the wrong cards. */
describe("resolveNodeColorId", () => {
  const levels = [level("reel"), level("section"), level("scene"), level("beat")];
  const legend = defaultLegend(levels);

  it("names the tier default when the card has no explicit color", () => {
    expect(resolveNodeColorId(legend, undefined, "beat")).toBe("tier:beat");
    expect(resolveNodeColorId(legend, "", "scene")).toBe("tier:scene");
  });

  it("names the explicit entry when the card has one", () => {
    // a color someone ADDED -- a new board seeds none, so mint one here
    const withOption = [...legend, { id: "mine", label: "Archival", bg: "#cfe3f4", border: "#a9cbe8" }];
    expect(resolveNodeColorId(withOption, "mine", "beat")).toBe("mine");
  });

  it("falls back to the tier default when an explicit id is dangling", () => {
    expect(resolveNodeColorId(legend, "deleted-entry", "beat")).toBe("tier:beat");
  });

  it("always names the entry that painted the card", () => {
    const cases: [string | undefined, string][] = [
      [undefined, "beat"],
      ["green", "beat"],
      ["deleted-entry", "beat"],
      [undefined, "section"],
    ];
    for (const [colorId, levelId] of cases) {
      const id = resolveNodeColorId(legend, colorId, levelId);
      const entry = legend.find((e) => e.id === id)!;
      const paint = resolveNodeColor(legend, colorId, levelId);
      expect({ bg: entry.bg, border: entry.border }).toEqual(paint);
    }
  });

  it("survives an empty legend with an id that matches no swatch", () => {
    expect(resolveNodeColorId([], undefined, "beat")).toBe("tier:beat");
  });
});

/* ------------------------------------------------------------------ *
 *  A tier's DESCRIPTOR: what its default color means, shown only beside
 *  its legend swatch. Kept off the tier's NAME, which is used in counts,
 *  add buttons and the graduation menu.
 * ------------------------------------------------------------------ */
describe("tierLabel", () => {
  it("is just the name when there's no descriptor", () => {
    expect(tierLabel("Scene")).toBe("Scene");
    expect(tierLabel("Scene", "")).toBe("Scene");
    expect(tierLabel("Scene", "   ")).toBe("Scene");
  });

  it("parenthesises the descriptor", () => {
    expect(tierLabel("Scene", "Linear")).toBe("Scene (Linear)");
    expect(tierLabel("Beat", " Verite ")).toBe("Beat (Verite)");
  });

  it("labels the tier's default legend entry, name and all", () => {
    const levels = [
      { ...level("scene"), name: "Scene", descriptor: "Linear" },
      { ...level("beat"), name: "Beat" },
    ];
    expect(tierDefaultFor(levels, "scene").label).toBe("Scene (Linear)");
    expect(tierDefaultFor(levels, "beat").label).toBe("Beat");
  });
});

/* ------------------------------------------------------------------ *
 *  bgTone -- the backdrop's tone, for chrome that sits on it.
 *
 *  Written with the fix (owner, 2026-08-05): the add chips were right on
 *  cork, faint on the dark grid and shouty on the lite grid. The MIDDLE
 *  band is the one that must not move, so cork's membership in it is the
 *  assertion that matters most here.
 * ------------------------------------------------------------------ */
describe("bgTone", () => {
  /* These are the four backdrops index.css actually paints. If one is
   * ever recolored, this is the test that should fail. */
  it("places each shipped backdrop in the band its look was tuned for", () => {
    expect(bgTone("#f5f5f2")).toBe("light"); // lite grid
    expect(bgTone("#65686c")).toBe("dark"); // dark grid
    expect(bgTone("#b17c48")).toBe("mid"); // cork -- must NOT move
  });

  /* The reason bgTone exists rather than reusing textColor's cutoff:
   * textColor flips at 140 and cork is 134, so sharing it would drop the
   * one backdrop we must leave alone into the dark band. */
  it("does not share textColor's threshold, which would recolor cork", () => {
    expect(textColor("#b17c48")).toBe("#ffffff"); // textColor calls it dark
    expect(bgTone("#b17c48")).toBe("mid"); // ...and this deliberately does not
  });

  it("judges a custom backdrop on its own color", () => {
    expect(bgTone("#ffffff")).toBe("light");
    expect(bgTone("#000000")).toBe("dark");
    expect(bgTone("#12305a")).toBe("dark"); // a deep blue board
    expect(bgTone("#c8a97e")).toBe("mid"); // a tan one
  });

  it("falls back to mid on anything it cannot read", () => {
    // mid leaves the chip exactly as it shipped, so a bad value is inert
    expect(bgTone("")).toBe("mid");
    expect(bgTone("not-a-color")).toBe("mid");
    expect(bgTone("#abc")).toBe("mid");
  });
});

/* WHAT A NEW BOARD SHIPS. Pinned because it is a taste decision the
 * legend's own copy now depends on: the Color Overrides row explains
 * what an override is, on the premise that you define your own rather
 * than inheriting four of somebody else's (owner, 2026-08-24). */
describe("the starter legend", () => {
  const levels = [level("reel"), level("section"), level("scene"), level("beat")];
  const legend = defaultLegend(levels);

  it("ships NO ready-made overrides -- you name your own", () => {
    const overrides = legend.filter((e) => !e.tier);
    // the nesting fill rides in that row, but it is a DEFAULT, not one
    // of the colors you define -- so the row is not empty either
    expect(overrides.filter((e) => !e.role)).toEqual([]);
    expect(overrides.map((e) => e.id)).toEqual([NESTED_ENTRY_ID]);
  });

  /* The one thing about a nesting card that must not shift underfoot: it
   * can be dragged to any tier on any board, so a palette must not be
   * able to repaint it. True by construction -- setTierColor matches on
   * `tier` and this entry has none -- and pinned here so it stays true. */
  it("...and the nesting fill is the same color whatever the palette", () => {
    const seeds = PALETTES.map((p) => {
      const painted = levels.map((l) => paletteTierColor(p, levels, l.id));
      return { palette: p.id, tiers: painted };
    });
    // every palette repaints every TIER...
    expect(new Set(seeds.flatMap((s) => s.tiers)).size).toBeGreaterThan(1);
    // ...and none of them names the nesting entry's id
    expect(legend.find((e) => e.role === "nested")!.bg).toBe("#adffb3");
  });

  it("...and one tier default per rung, plus the nesting fill", () => {
    expect(legend.filter((e) => e.tier)).toHaveLength(levels.length);
    expect(legend.filter((e) => e.role === "nested")).toHaveLength(1);
  });
});

describe("the nested-board default (owner, 2026-08-24)", () => {
  const legend: LegendEntry[] = [
    { id: "tier:beat", label: "Beat", bg: "#fcecad", border: "#efd98a", tier: "beat" },
    { id: "tier:scene", label: "Scene", bg: "#e3d9f2", border: "#c9bce3", tier: "scene" },
    { id: "role:nested", label: "Nested boards", bg: "#c9d4e4", border: "#a8b7cd", role: "nested" },
    { id: "blue", label: "B-roll", bg: "#cfe3f4", border: "#a9cbe8" },
  ];

  it("a nesting card takes the nested default instead of its tier's", () => {
    expect(resolveNodeEntry(legend, undefined, "beat", true)!.id).toBe("role:nested");
    expect(resolveNodeEntry(legend, undefined, "beat", false)!.id).toBe("tier:beat");
  });

  /* Which is the point: the card can be dragged to any tier, so its
   * color must not depend on where it sits. */
  it("...and the SAME color at every tier", () => {
    for (const tier of ["beat", "scene", "reel"]) {
      expect(resolveNodeEntry(legend, undefined, tier, true)!.id).toBe("role:nested");
    }
  });

  it("an explicit per-card color still wins, exactly as over a tier default", () => {
    expect(resolveNodeEntry(legend, "blue", "beat", true)!.id).toBe("blue");
  });

  it("falls back to the tier when the board has no nested entry yet", () => {
    const older = legend.filter((e) => !e.role);
    expect(resolveNodeEntry(older, undefined, "scene", true)!.id).toBe("tier:scene");
  });

  /* The attribute the legend highlight matches must name the entry that
   * PAINTED the card, or hovering the swatch lights the wrong ones --
   * the invariant this suite already pins for tier defaults. */
  it("data-color names the entry that painted it", () => {
    expect(resolveNodeColorId(legend, undefined, "beat", true)).toBe("role:nested");
    expect(resolveNodeColor(legend, undefined, "beat", true).bg).toBe("#c9d4e4");
  });
});
