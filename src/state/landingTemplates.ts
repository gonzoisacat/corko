import { defaultLegend } from "../colors";
import { uid } from "./ids";
import { FILM_LEVELS, type BoardTemplate } from "./template";
import type { Board, LevelDef, Node } from "./types";

/* ------------------------------------------------------------------ *
 *  The LANDING templates (owner's spec, 2026-08-02): the short list a
 *  new board actually starts from.
 *
 *  The full shelf -- every ladder, the worked examples, the seven story
 *  rubrics -- is still there, one keypress away (`m`, see
 *  board/TemplatePicker.tsx). It's a lot to meet on the way in, so the
 *  door shows three shapes and an invitation to define your own.
 *
 *  Every one seeds exactly ONE node per tier, named for the tier
 *  ("Act 1" / "Scene 1" / "Beat 1") -- enough to see what the rungs ARE
 *  without handing anyone a board to delete first. (starterBoard, the
 *  full shelf's builder, seeds three placeholder cards and a "Cold Open";
 *  that's a different, chattier promise.)
 *
 *  The seed.ts rule holds: nothing here comes from a real production.
 * ------------------------------------------------------------------ */

const fields = (color: boolean): LevelDef["fields"] => ({ color, notes: true });

/* Ladder conventions, same as template.ts: the outermost swimlane is
 * "reel" (light head), any middle swimlane is "section" (dark), the
 * leaf-parent and leaf render as cards and ignore variant. */

// Episode -> Act -> Scene -> Beat
export const DOC_SERIES_LEVELS: LevelDef[] = [
  { id: "episode", name: "Episode", variant: "reel", fields: fields(false) },
  { id: "act", name: "Act", variant: "section", fields: fields(false) },
  { id: "scene", name: "Scene", variant: "scene", fields: fields(false) },
  { id: "beat", name: "Beat", variant: "scene", fields: fields(true) },
];

// Reel -> Shoot Day -> Scene -> Beat: cutting down linear footage, where
// the top of the ladder is the deliverable and the tier under it is how
// the material was shot.
export const DOC_CUTDOWN_LEVELS: LevelDef[] = [
  { id: "reel", name: "Reel", variant: "reel", fields: fields(false) },
  { id: "shootday", name: "Shoot Day", variant: "section", fields: fields(false) },
  { id: "scene", name: "Scene", variant: "scene", fields: fields(false) },
  { id: "beat", name: "Beat", variant: "scene", fields: fields(true) },
];

// Scene -> Shot: the SHALLOWEST beat map, for a shot list or a single
// sequence. A Beat Map is 2+ tiers (owner, 2026-08-16) -- the type is the
// renderer, not the depth, so this is the same board as a four-rung cut
// with two of the rungs missing.
export const DOC_SHOTLIST_LEVELS: LevelDef[] = [
  { id: "scene", name: "Scene", variant: "scene", fields: fields(false) },
  { id: "shot", name: "Shot", variant: "scene", fields: fields(true) },
];

/* One node per tier, each named "<Tier> 1", all the way down. */
export function oneOfEachBoard(levels: LevelDef[], title: string): Board {
  const leaf = levels.length - 1;
  const build = (depth: number): Node => ({
    id: uid(depth === leaf ? "b" : "g"),
    title: `${levels[depth].name} 1`,
    collapsed: false,
    ...(depth === leaf ? { color: "yellow" } : {}),
    children: depth === leaf ? [] : [build(depth + 1)],
  });
  return { id: uid("bd"), title, levels, legend: defaultLegend(levels), roots: [build(0)] };
}

export const LANDING_TEMPLATES: BoardTemplate[] = [
  {
    id: "doc-feature",
    name: "Documentary - Feature",
    description: "The basic building blocks",
    levels: FILM_LEVELS,
    build: () => oneOfEachBoard(FILM_LEVELS, "Untitled Cut"),
  },
  {
    id: "doc-series",
    name: "Documentary - Series",
    description: "Multiple Episodes, with acts for each",
    levels: DOC_SERIES_LEVELS,
    build: () => oneOfEachBoard(DOC_SERIES_LEVELS, "Untitled Series"),
  },
  {
    id: "doc-cutdown",
    name: "Documentary - Linear Footage Cutdown",
    description: "Cataloging captured footage",
    levels: DOC_CUTDOWN_LEVELS,
    build: () => oneOfEachBoard(DOC_CUTDOWN_LEVELS, "Untitled Cut"),
  },
  {
    id: "doc-shotlist",
    name: "Scene - Shot",
    description: "A shot list, or one sequence",
    levels: DOC_SHOTLIST_LEVELS,
    build: () => oneOfEachBoard(DOC_SHOTLIST_LEVELS, "Untitled Board"),
  },
];

/* ---- Custom ladders ------------------------------------------------ *
 * The tiers the "Custom..." builder collects, top-down, turned into a
 * real ladder. Ids are minted rather than slugged from the names: two
 * tiers can be called the same thing, and a duplicate LevelDef id would
 * collide in the legend (its entries are keyed `tier:<id>`) and in the
 * merge-repair pass, which dedupes level ids. */
export function customLevels(names: string[]): LevelDef[] {
  const leaf = names.length - 1;
  return names.map((name, i) => ({
    id: uid("lv"),
    name: name.trim() || `Tier ${i + 1}`,
    variant: i === 0 && leaf > 1 ? "reel" : i < leaf - 1 ? "section" : "scene",
    fields: fields(i === leaf),
  }));
}

export function customTemplate(names: string[]): BoardTemplate {
  const levels = customLevels(names);
  return {
    id: "custom",
    name: "Custom",
    description: names.join(" -> "),
    levels,
    build: () => oneOfEachBoard(levels, "Untitled Board"),
  };
}

/* The most tiers a ladder may have -- the same cap "Add parent category"
 * uses in the Options menu, for the same reason: past six, the swimlane
 * nesting stops reading as structure. */
export const MAX_TIERS = 6;

/* ...and the fewest. Not a taste call: flatten.ts renders the tier ABOVE
 * the leaf as the cards lane, so a one-rung ladder has no lane to put
 * cards in and the walk reads `levels[depth + 1].name` off the end. The
 * builder starts AT this number rather than gating on it -- a form that
 * opens with its confirm grayed out is a form that starts by telling you
 * no. */
export const MIN_TIERS = 2;
