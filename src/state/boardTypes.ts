import { tierDefaultFor } from "../colors";
import { uid } from "./ids";
import type { BoardTemplate } from "./template";
import type { Board, LevelDef, Node } from "./types";

/* ------------------------------------------------------------------ *
 *  BOARD TYPES -- the starting points for board shapes that are not the
 *  cut board (owner, 2026-08-15; see the DECISIONS section of
 *  docs/explorations/board-shapes.md).
 *
 *  A type is whole and firm: you do not get a kanban board inside a cut
 *  board's tiers. What makes it cheap is that the DATA MODEL does not
 *  move -- a type is a renderer over the same recursive Node tree and
 *  the same ladder. Everything a card can carry (color, tags, notes,
 *  metadata values, display slots, selection, drag) works in every type
 *  for free, because it is the same card.
 *
 *  These live apart from landingTemplates.ts on purpose. Those are
 *  LADDERS -- different rungs for the same shape. These are SHAPES. The
 *  picker shows them as their own labelled shelf for the same reason.
 * ------------------------------------------------------------------ */

const fields = (color: boolean): LevelDef["fields"] => ({ color, notes: true });

/* Board > Column > Card, which is TWO rungs and not three: the board
 * itself is the outer container, so the ROOTS are the columns. That is
 * also MIN_TIERS, the floor flatten needs (a ladder must have a lane
 * tier to put cards in) -- so a kanban board is exactly the smallest
 * ladder the app already supports, drawn sideways.
 *
 * The tiers are named for the SHAPE rather than for a documentary
 * ("Column"/"Card"), because unlike the landing ladders this one carries
 * no opinion about what it is being used for -- the owner's own example
 * was acts of a film, which is a rename away. Every string in the UI
 * reads the tier's own name, so renaming Column to Act relabels the
 * board's controls with it. */
/* THE GEOMETRY IS SET HERE, NOT LEFT TO tierDefaults (owner-reported
 * 2026-08-15: "I'd like the tier controls to do something on tier 2").
 * `withTierDefaults` only FILLS GAPS, so naming these keeps them -- and
 * the cut board's T2 defaults (a 90px-tall card) are wrong for a column
 * HEAD, which is a bar across the top of a stack rather than a card. A
 * 44px bar at 3.7 aspect is ~163px wide, so the column comes out a
 * little wider than the cards it holds.
 *
 * These are the numbers the tier's own sliders move, which is the point:
 * height anchors the head and (with aspect) sets the COLUMN's width, so
 * dragging Height or Aspect on the Column tier now visibly re-sizes the
 * board. No stretch-to-fill anywhere -- the sizes are the sizes (owner:
 * "no reason to have stretch to fill behavior on this one"). */
export const KANBAN_LEVELS: LevelDef[] = [
  {
    id: "column",
    name: "Column",
    variant: "scene",
    fields: fields(true),
    height: 44,
    aspect: 3.7,
    textSize: 17,
  },
  {
    id: "card",
    name: "Card",
    variant: "scene",
    fields: fields(true),
    height: 80,
    aspect: 1.85,
    textSize: 20,
  },
];

/* The canonical example of the form, which is what a template is for:
 * three columns says "this is a kanban board" in a way one column
 * cannot. Cards in the first so there is something to drag on arrival.
 * Generic by design and generic by RULE -- state/seed.ts's header: no
 * sample content may come from a real production. */
const KANBAN_COLUMNS = ["To do", "Doing", "Done"];
const KANBAN_CARDS = ["Card 1", "Card 2", "Card 3"];

export function kanbanBoard(
  title: string,
  columns: string[] = KANBAN_COLUMNS,
  seedCards = true,
): Board {
  const roots: Node[] = columns.map((name, i) => ({
    id: uid("g"),
    title: name,
    collapsed: false,
    children:
      i === 0 && name && seedCards
        ? KANBAN_CARDS.map((t) => ({
            id: uid("b"),
            title: t,
            collapsed: false,
            color: "yellow",
            children: [],
          }))
        : [],
  }));
  return {
    id: uid("bd"),
    title,
    type: "kanban",
    /* TIER DEFAULTS ONLY -- no color overrides (owner, 2026-08-16).
     * `defaultLegend` bolts on four ready-made ones (B-roll / visual,
     * Confirmed, Needs review, Music / archival), which are a cut
     * board's vocabulary and say nothing about a board of columns. The
     * ROW stays, so any can be added; the board just doesn't arrive
     * carrying somebody else's. */
    levels: KANBAN_LEVELS,
    legend: KANBAN_LEVELS.map((l) => tierDefaultFor(KANBAN_LEVELS, l.id)),
    roots,
  };
}

/* THE STORED TYPE STAYS "kanban" while the TYPE is called Columns
 * (owner, 2026-08-16): displayed name and persisted id are separate
 * decisions, and only the displayed one is free -- boards already carry
 * `type: "kanban"` and renaming it would buy a migration for a string
 * nobody sees.
 *
 * "Kanban" survives as the name of one SEED, which is where the word
 * actually belongs: it names a workflow (to do / doing / done), not a
 * shape. The shape is Columns.
 *
 * The seeds are what STEP 2 offers for this style. Unlike a Beat Map's
 * row, these are not ladders -- the rungs are always Column > Card --
 * so they differ only in what the columns are CALLED. */
const columnsTemplate = (
  id: string,
  name: string,
  description: string,
  columns: string[],
  seedCards = false,
): BoardTemplate => ({
  id,
  name,
  description,
  levels: KANBAN_LEVELS,
  build: () => kanbanBoard("Untitled Board", columns, seedCards),
});

export const KANBAN_TEMPLATE = columnsTemplate(
  "kanban",
  "Kanban",
  "To do, Doing, Done -- with cards to drag",
  KANBAN_COLUMNS,
  true,
);

/* The owner's own example for this type was organizing a film into acts,
 * with the detail living in boards nested off each one. */
export const ACT_OVERVIEW_TEMPLATE = columnsTemplate(
  "cols-acts",
  "Act Overview",
  "One column per act",
  ["Act 1", "Act 2", "Act 3"],
);

export const EPISODE_OVERVIEW_TEMPLATE = columnsTemplate(
  "cols-episodes",
  "Episode Overview",
  "One column per episode",
  ["Episode 1", "Episode 2", "Episode 3", "Episode 4"],
);

export const REEL_OVERVIEW_TEMPLATE = columnsTemplate(
  "cols-reels",
  "Reel Overview",
  "One column per reel",
  ["Reel 1", "Reel 2", "Reel 3", "Reel 4"],
);

/* Nothing written in it: somebody else's words are a worse start than
 * three blanks you name yourself. */
export const KANBAN_BLANK_TEMPLATE = columnsTemplate(
  "kanban-blank",
  "Blank columns",
  "Three columns to name yourself",
  ["", "", ""],
);

export const TYPE_TEMPLATES: BoardTemplate[] = [
  ACT_OVERVIEW_TEMPLATE,
  EPISODE_OVERVIEW_TEMPLATE,
  REEL_OVERVIEW_TEMPLATE,
  KANBAN_TEMPLATE,
  KANBAN_BLANK_TEMPLATE,
];

/* ---- FREE GRID ---------------------------------------------------- *
 *
 *  ONE RUNG, and that is the type's whole pitch made structural:
 *  "maximum flexibility, minimum structure". The roots ARE the cards, so
 *  there is no container tier to fill in and no hierarchy to maintain --
 *  what organizes this board is WHERE things sit and WHAT is strung
 *  between them, which is a different axis entirely.
 *
 *  A one-rung ladder is legal everywhere it matters: MIN_TIERS is a
 *  floor the custom-ladder BUILDER enforces (flatten needs a lane tier
 *  to put cards in), and this type does not go through flatten. The card
 *  menu's Promote and Demote hide themselves on a ladder with nowhere to
 *  go, so nothing offers a gesture the shape cannot take.
 *
 *  The geometry is set here for the same reason the Columns one is:
 *  `withTierDefaults` only fills gaps, and a grid card's size is its own
 *  SPAN in cells, so the tier's height/aspect would only mislead. What
 *  the tier still owns is the TYPE -- font, color, target size.
 */
export const GRID_LEVELS: LevelDef[] = [
  {
    id: "card",
    name: "Card",
    variant: "scene",
    fields: fields(true),
    textSize: 20,
  },
];

function gridBoardSeed(title: string): Board {
  return {
    id: uid("bd"),
    title,
    type: "grid",
    levels: GRID_LEVELS,
    legend: GRID_LEVELS.map((l) => tierDefaultFor(GRID_LEVELS, l.id)),
    roots: [],
  };
}

/* An EMPTY board on purpose. Every other type seeds a rung or two so the
 * shape is legible before you have typed anything; here the shape IS the
 * empty board, and the surface says in words how to put the first card
 * on it. Somebody else's three cards in somebody else's arrangement
 * would be the first thing to drag away. */
export const FREE_GRID_TEMPLATE: BoardTemplate = {
  id: "freegrid",
  name: "Blank corkboard",
  description: "An empty wall to pin things to",
  levels: GRID_LEVELS,
  build: () => gridBoardSeed("Untitled Corkboard"),
};

export const GRID_TEMPLATES: BoardTemplate[] = [FREE_GRID_TEMPLATE];
