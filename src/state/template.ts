import type { Board, LevelDef } from "./types";

/* ------------------------------------------------------------------ *
 *  Tier ladders (templates). A ladder is just a LevelDef[] -- the tier
 *  model is recursive (ADR 0001), so a board is defined by its ladder
 *  plus its node tree. Render rule: the leaf tier (last entry) renders
 *  as cards; the tier above it is the sticky-label "cards lane"; tiers
 *  above that are vertical swimlanes. A swimlane's `variant` picks its
 *  look ("reel" = light head, "section" = dark head); the leaf-parent
 *  and leaf ignore `variant`.
 *
 *  Convention across the built-in templates: the outermost swimlane is
 *  "reel" (light), any middle swimlane is "section" (dark); the leaf
 *  always enables `color`. (The per-tier subtitle/tag capabilities went
 *  when display SLOTS landed -- card-face metadata is a category now.)
 * ------------------------------------------------------------------ */

const fields = (color: boolean): LevelDef["fields"] => ({ color, notes: true });

// Reel -> Section -> Scene -> Beat (the original documentary ladder).
export const DEFAULT_LEVELS: LevelDef[] = [
  { id: "reel", name: "Reel", variant: "reel", fields: fields(false) },
  { id: "section", name: "Section", variant: "section", fields: fields(false) },
  { id: "scene", name: "Scene", variant: "scene", fields: fields(false) },
  // leaf: variant unused (renders as a card), kept for shape
  { id: "beat", name: "Beat", variant: "scene", fields: fields(true) },
];

// Act -> Scene -> Beat (three tiers).
export const FILM_LEVELS: LevelDef[] = [
  { id: "act", name: "Act", variant: "reel", fields: fields(false) },
  { id: "scene", name: "Scene", variant: "scene", fields: fields(false) },
  { id: "beat", name: "Beat", variant: "scene", fields: fields(true) },
];

// Season -> Episode -> Scene -> Beat (four tiers).
export const SERIES_LEVELS: LevelDef[] = [
  { id: "season", name: "Season", variant: "reel", fields: fields(false) },
  { id: "episode", name: "Episode", variant: "section", fields: fields(false) },
  { id: "scene", name: "Scene", variant: "scene", fields: fields(false) },
  { id: "beat", name: "Beat", variant: "scene", fields: fields(true) },
];

// Section -> Card (two tiers): a flat set of card lists. The root tier is
// itself the leaf-parent (renders as a sticky-label cards lane).
export const SIMPLE_LEVELS: LevelDef[] = [
  { id: "section", name: "Section", variant: "scene", fields: fields(false) },
  { id: "card", name: "Card", variant: "scene", fields: fields(true) },
];

/* A named starting point offered at board creation (only at creation --
 * see the Board-structure plan). `build()` returns the initial Board so a
 * template can ship sample content (Documentary) or a blank scaffold. */
export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  levels: LevelDef[];
  build: () => Board;
}
