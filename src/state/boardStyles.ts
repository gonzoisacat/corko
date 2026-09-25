import type { BoardType } from "./types";
import type { BoardTemplate } from "./template";
import { LANDING_TEMPLATES } from "./landingTemplates";
import { GRID_TEMPLATES, TYPE_TEMPLATES } from "./boardTypes";

/* ------------------------------------------------------------------ *
 *  THE BOARD-CREATION DOOR, IN TWO STEPS (owner's design, 2026-08-16).
 *
 *  Row 1 picks the STYLE -- which renderer the board gets. Row 2 picks
 *  its STRUCTURE -- which rungs, or which seed. That split is the whole
 *  point: tier count is NOT the style. A Beat Map is a Beat Map at two
 *  rungs (Scene -> Shot) or at four (Reel -> Day -> Scene -> Beat); the
 *  renderer is the same and only the ladder differs. The old single-grid
 *  picker blurred that -- three ladders of one shape sat beside a
 *  different shape under a heading.
 *
 *  Each style carries a SYMBOL, and it is meant to be reused wherever a
 *  board has to identify itself: the Boards menu, and eventually a
 *  nested-board card, which has to say what it points at. Board type has
 *  no surface in the UI today, which is the gap this closes.
 *
 *  Row 2 legitimately means different things per style, and that is not
 *  an inconsistency to design out: a Beat Map is choosing a LADDER, a
 *  Columns board is choosing a SEED (its rungs are always Column ->
 *  Card), and Free Grid has one shape and so needs no second row at all.
 * ------------------------------------------------------------------ */

export type BoardStyleId = "beatmap" | "columns" | "freegrid";

export interface BoardStyle {
  id: BoardStyleId;
  name: string;
  /* The line on the card in row 1. A `\n` is honoured (the card is
   * `white-space: pre-line`), which is how a parenthetical is kept whole
   * on its own line instead of wrapping mid-phrase. */
  blurb: string;
  /* row 2. Empty = this style has one shape and needs no second choice. */
  structures: BoardTemplate[];
  /* whether row 2 offers the tier builder ("Custom...") */
  custom: boolean;
  /* whether row 2 offers "Import EDL..." -- an edit list builds a
   * Scene > Shot board, which is a Beat Map and nothing else */
  edl?: boolean;
  /* what STEP 2 is called for this style -- it genuinely differs: a Beat
   * Map is choosing a ladder, a Columns board is choosing a seed. The
   * header carries this, so the structure grid needs no label of its
   * own. */
  step2: string;
  /* built yet? Free Grid is named here before it exists so the set reads
   * as the three it is, but it cannot be created. */
  ready: boolean;
}

export const BOARD_STYLES: BoardStyle[] = [
  {
    id: "beatmap",
    name: "Beat Map",
    blurb: "Lay out your full\nFilm/Shotlist/Timeline\nin sequential order",
    structures: LANDING_TEMPLATES,
    custom: true,
    edl: true,
    step2: "Choose a starting structure",
    ready: true,
  },
  {
    id: "columns",
    name: "Columns",
    blurb: "Good for organizing\nthe broad strokes",
    structures: TYPE_TEMPLATES,
    custom: false,
    step2: "Choose your starting columns",
    ready: true,
  },
  {
    id: "freegrid",
    name: "Free Grid",
    blurb: "Maximum flexibility,\nminimum structure.\n(conspiracy corkboard)",
    /* One seed, and it is empty -- see FREE_GRID_TEMPLATE. Step 2 still
       exists rather than being skipped, because the two choices UNDER it
       (card colors, board appearance) are the ones this type cares
       about most: it is the type you look at. */
    structures: GRID_TEMPLATES,
    custom: false,
    step2: "Start with a blank wall",
    ready: true,
  },
];

/* WHICH STYLE A BOARD IS, from its stored type. Two vocabularies on
 * purpose (DECISIONS 5a): the persisted id stays `"kanban"`, while the
 * name a person reads is "Columns" -- displayed name and stored id are
 * separate decisions and only the displayed one is free.
 *
 * Here rather than in types.ts because it is a RENDER-side mapping: it
 * exists so a board can identify itself with a symbol and a word, which
 * is what a nested-board card has to do without drawing the board. */
export const styleOf = (type: BoardType | undefined): BoardStyleId =>
  type === "kanban" ? "columns" : type === "grid" ? "freegrid" : "beatmap";

export const styleName = (type: BoardType | undefined): string =>
  BOARD_STYLES.find((s) => s.id === styleOf(type))?.name ?? "Beat Map";
