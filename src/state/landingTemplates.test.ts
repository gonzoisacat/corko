import { describe, expect, it } from "vitest";
import {
  LANDING_TEMPLATES,
  MAX_TIERS,
  MIN_TIERS,
  customLevels,
  customTemplate,
  oneOfEachBoard,
} from "./landingTemplates";
import { sanitizeBoard } from "./validate";

/* ------------------------------------------------------------------ *
 *  The landing screen's short list (board/LandingPicker.tsx). What is
 *  pinned here is the PROMISE: every option seeds exactly one node per
 *  tier, named for the tier, and a custom ladder is a real ladder --
 *  unique ids, a leaf that takes color, and it survives the sanitizer.
 * ------------------------------------------------------------------ */

const spine = (board: ReturnType<typeof oneOfEachBoard>) => {
  const out: string[] = [];
  let nodes = board.roots;
  while (nodes.length) {
    out.push(nodes[0].title);
    nodes = nodes[0].children;
  }
  return out;
};

describe("LANDING_TEMPLATES", () => {
  /* These are LADDERS for one shape (the Beat Map), not shapes -- the
   * shapes are state/boardStyles.ts. They are what the picker's SECOND
   * row offers once Beat Map is picked. */
  it("offers the Beat Map's ladders, shallowest included", () => {
    expect(LANDING_TEMPLATES.map((t) => t.name)).toEqual([
      "Documentary - Feature",
      "Documentary - Series",
      "Documentary - Linear Footage Cutdown",
      "Scene - Shot",
    ]);
    expect(LANDING_TEMPLATES.map((t) => t.levels.map((l) => l.name).join(" > "))).toEqual([
      "Act > Scene > Beat",
      "Episode > Act > Scene > Beat",
      "Reel > Shoot Day > Scene > Beat",
      "Scene > Shot",
    ]);
  });

  /* A Beat Map is 2+ tiers (owner, 2026-08-16): the type is the
   * RENDERER, not the depth, so the shallowest offered ladder sits at
   * the floor rather than above it. */
  it("bottoms out at MIN_TIERS, not at three", () => {
    const depths = LANDING_TEMPLATES.map((t) => t.levels.length);
    expect(Math.min(...depths)).toBe(MIN_TIERS);
  });

  it("seeds exactly one node per tier, named for the tier", () => {
    for (const t of LANDING_TEMPLATES) {
      const board = t.build();
      expect(spine(board)).toEqual(t.levels.map((l) => `${l.name} 1`));
      // ...one node per tier means one node per tier: no stray siblings
      const count = (ns: typeof board.roots): number =>
        ns.reduce((sum, n) => sum + 1 + count(n.children), 0);
      expect(count(board.roots)).toBe(t.levels.length);
    }
  });

  it("mints fresh node ids per build, so two boards can't collide", () => {
    const a = LANDING_TEMPLATES[0].build();
    const b = LANDING_TEMPLATES[0].build();
    expect(a.roots[0].id).not.toBe(b.roots[0].id);
    expect(a.id).not.toBe(b.id);
  });

  it("gives every tier a legend default", () => {
    for (const t of LANDING_TEMPLATES) {
      const board = t.build();
      for (const l of t.levels) {
        expect(board.legend.some((e) => e.tier === l.id)).toBe(true);
      }
    }
  });
});

describe("customLevels", () => {
  it("names the rungs in order and mints unique ids", () => {
    const levels = customLevels(["Chapter", "Sequence", "Shot"]);
    expect(levels.map((l) => l.name)).toEqual(["Chapter", "Sequence", "Shot"]);
    expect(new Set(levels.map((l) => l.id)).size).toBe(3);
  });

  it("mints ids even for tiers with the SAME name", () => {
    // a duplicate LevelDef id would collide in the legend (tier:<id>) and
    // get deduped by the merge-repair pass
    const levels = customLevels(["Part", "Part", "Beat"]);
    expect(new Set(levels.map((l) => l.id)).size).toBe(3);
  });

  it("only the leaf takes a color, and the top of a deep ladder is a reel", () => {
    const levels = customLevels(["Chapter", "Sequence", "Shot"]);
    expect(levels.map((l) => l.fields?.color)).toEqual([false, false, true]);
    expect(levels[0].variant).toBe("reel");
  });

  it("falls back to a name rather than an empty rung", () => {
    expect(customLevels(["  ", "Beat"])[0].name).toBe("Tier 1");
  });

  it("builds a board the sanitizer accepts", () => {
    const t = customTemplate(["Chapter", "Sequence", "Shot"]);
    const clean = sanitizeBoard(t.build());
    expect(clean).not.toBeNull();
    expect(clean!.levels.map((l) => l.name)).toEqual(["Chapter", "Sequence", "Shot"]);
    expect(spine(clean!)).toEqual(["Chapter 1", "Sequence 1", "Shot 1"]);
  });

  it("caps at six tiers -- past that the swimlanes stop reading", () => {
    expect(MAX_TIERS).toBe(6);
  });

  /* The floor isn't taste: flatten.ts renders the tier ABOVE the leaf as
   * the cards lane, so a one-rung ladder has no lane and its walk reads
   * levels[depth + 1] off the end. The builder opens AT this number, so
   * nothing in the UI can produce a shorter one -- this pins the reason
   * the number exists. */
  it("floors at two tiers, and a two-tier ladder is a real board", () => {
    expect(MIN_TIERS).toBe(2);
    const t = customTemplate(["Scene", "Beat"]);
    expect(t.levels).toHaveLength(2);
    expect(spine(t.build())).toEqual(["Scene 1", "Beat 1"]);
    // the leaf's PARENT is the cards lane -- levels[leaf - 1] must exist
    expect(t.levels[t.levels.length - 2]).toBeDefined();
  });
});
