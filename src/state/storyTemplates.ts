import { defaultLegend } from "../colors";
import { uid } from "./ids";
import { FILM_LEVELS, type BoardTemplate } from "./template";
import type { Board, LevelDef, Node } from "./types";

/* ------------------------------------------------------------------ *
 *  Story-structure templates -- the classic prose/screenplay rubrics as
 *  sparse starting boards (owner's ask, 2026-08-01: "the Acts or
 *  Sections depending on the rubric, and a few blank scenes with no
 *  beats"). The seven are the set surveyed in Reedsy's story-structure
 *  guide; the stage names are each framework's own standard terms
 *  (Freytag, Campbell/Vogler, Harmon, Snyder, Wells) -- no guide prose
 *  is reproduced here, only the structures themselves.
 *
 *  DELIBERATELY SPARSE: every rubric maps onto the Act -> Scene -> Beat
 *  ladder with the named stages as EMPTY scene lanes -- the structure is
 *  the scaffolding you fill, not somebody's finished movie (the worked
 *  examples, Godfather and Die Hard, cover "show me a full board").
 *  Where a rubric doesn't define acts, its stages group under the
 *  halves/phases the rubric itself implies, and the top tier takes the
 *  rubric's own word for them (Stage, Phase) via `levelsNamed`.
 *
 *  The seed.ts rule applies here too: nothing from a real production.
 *  And the same trademark care as state/dieHard.ts: the 15-beat sheet's
 *  BRAND name stays out of the template name; the beat terms themselves
 *  are the industry's everyday vocabulary.
 * ------------------------------------------------------------------ */

/* An empty scene lane: named for a stage, no beats -- the point. */
const stage = (title: string): Node => ({ id: uid("s"), title, collapsed: false, children: [] });
const act = (title: string, scenes: Node[]): Node => ({
  id: uid("g"),
  title,
  collapsed: false,
  children: scenes,
});

/* The film ladder with the top tier called what the rubric calls it. */
const levelsNamed = (top: string): LevelDef[] =>
  FILM_LEVELS.map((l) => (l.id === "act" ? { ...l, name: top } : l));

const storyBoard = (title: string, levels: LevelDef[], roots: Node[]): Board => ({
  id: uid("bd"),
  title,
  levels,
  legend: defaultLegend(levels),
  roots,
});

const FREYTAG_LEVELS = levelsNamed("Stage");
const FICHTEAN_LEVELS = levelsNamed("Phase");

export const STORY_TEMPLATES: BoardTemplate[] = [
  {
    id: "story-three-act",
    name: "Three-Act Structure",
    description: "Setup, confrontation, resolution -- the workhorse.",
    levels: FILM_LEVELS,
    build: () =>
      storyBoard("Untitled Three-Act Story", FILM_LEVELS, [
        act("Act 1 -- Setup", [stage("Exposition"), stage("Inciting Incident"), stage("Plot Point One")]),
        act("Act 2 -- Confrontation", [stage("Rising Action"), stage("Midpoint"), stage("Plot Point Two")]),
        act("Act 3 -- Resolution", [stage("Pre-Climax"), stage("Climax"), stage("Denouement")]),
      ]),
  },
  {
    id: "story-hero",
    name: "The Hero's Journey",
    description: "Vogler's twelve stages, in three acts.",
    levels: FILM_LEVELS,
    build: () =>
      storyBoard("Untitled Hero's Journey", FILM_LEVELS, [
        act("Act 1 -- Departure", [
          stage("The Ordinary World"),
          stage("The Call of Adventure"),
          stage("Refusal of the Call"),
          stage("Meeting the Mentor"),
          stage("Crossing the First Threshold"),
        ]),
        act("Act 2 -- Initiation", [
          stage("Tests, Allies, Enemies"),
          stage("Approach to the Inmost Cave"),
          stage("The Ordeal"),
          stage("Reward (Seizing the Sword)"),
        ]),
        act("Act 3 -- Return", [
          stage("The Road Back"),
          stage("Resurrection"),
          stage("Return with the Elixir"),
        ]),
      ]),
  },
  {
    id: "story-freytag",
    name: "Freytag's Pyramid",
    description: "Five stages rising to the climax and falling to catastrophe.",
    levels: FREYTAG_LEVELS,
    build: () =>
      storyBoard("Untitled Tragedy", FREYTAG_LEVELS, [
        // tragedy's shape has no acts; each stage carries two unnamed
        // scenes so the lanes are ready to fill
        act("Introduction", [stage(""), stage("")]),
        act("Rise", [stage(""), stage("")]),
        act("Climax", [stage(""), stage("")]),
        act("Return (Fall)", [stage(""), stage("")]),
        act("Catastrophe", [stage(""), stage("")]),
      ]),
  },
  {
    id: "story-circle",
    name: "The Story Circle",
    description: "Harmon's eight steps: comfort, want, chaos, change.",
    levels: FILM_LEVELS,
    build: () =>
      storyBoard("Untitled Story Circle", FILM_LEVELS, [
        act("Order", [stage("You (a zone of comfort)"), stage("Need (but they want something)")]),
        act("Chaos", [
          stage("Go (an unfamiliar situation)"),
          stage("Search (adapting to it)"),
          stage("Find (getting what they wanted)"),
          stage("Take (paying a heavy price)"),
        ]),
        act("New Order", [
          stage("Return (back to the familiar)"),
          stage("Change (having changed)"),
        ]),
      ]),
  },
  {
    id: "story-fichtean",
    name: "Fichtean Curve",
    description: "Straight into rising action -- crisis after crisis to the climax.",
    levels: FICHTEAN_LEVELS,
    build: () =>
      storyBoard("Untitled Fichtean Story", FICHTEAN_LEVELS, [
        act("Rising Action", [
          stage("Inciting Incident"),
          stage("First Crisis"),
          stage("Second Crisis"),
          stage("Third Crisis"),
        ]),
        act("Climax", [stage("The Climax")]),
        act("Falling Action", [stage("Resolution")]),
      ]),
  },
  {
    /* The fifteen-beat screenplay sheet. The beat names are the trade's
     * shared vocabulary; the BRAND that popularized them is trademarked
     * and stays out of the template name (same care as dieHard.ts). */
    id: "story-15-beats",
    name: "The 15-Beat Sheet",
    description: "The screenplay beat sheet, act by act.",
    levels: FILM_LEVELS,
    build: () =>
      storyBoard("Untitled Beat Sheet", FILM_LEVELS, [
        act("Act One", [
          stage("Opening Image"),
          stage("Set-Up"),
          stage("Theme Stated"),
          stage("Catalyst"),
          stage("Debate"),
        ]),
        act("Act Two", [
          stage("Break into Two"),
          stage("B Story"),
          stage("The Promise of the Premise"),
          stage("Midpoint"),
          stage("Bad Guys Close In"),
          stage("All Is Lost"),
          stage("Dark Night of the Soul"),
        ]),
        act("Act Three", [stage("Break into Three"), stage("Finale"), stage("Final Image")]),
      ]),
  },
  {
    id: "story-seven-point",
    name: "Seven-Point Structure",
    description: "Hook to resolution across two pinch points.",
    levels: FILM_LEVELS,
    build: () =>
      storyBoard("Untitled Seven-Point Story", FILM_LEVELS, [
        act("Beginning", [stage("The Hook"), stage("Plot Point 1")]),
        act("Middle", [stage("Pinch Point 1"), stage("Midpoint"), stage("Pinch Point 2")]),
        act("End", [stage("Plot Point 2"), stage("Resolution")]),
      ]),
  },
];
