import type { Board, Cell, Edge, Node, Span } from "./types";

/* ------------------------------------------------------------------ *
 *  FREE GRID -- the pure half.
 *
 *  The third board type (docs/explorations/board-shapes.md, DECISIONS
 *  5a/5b): a corkboard with an ANCHOR LATTICE. A card is pinned at a
 *  cell and covers a whole number of cells, and lengths of yarn run
 *  between cards' pins.
 *
 *  WHY A LATTICE RATHER THAN FREE PIXELS, which is the decision the rest
 *  of this file rests on. Free positioning would delete the concept of
 *  "the next card", which Notes view, keyNav, search and the seam all
 *  consume; a lattice keeps the document ordered and merely draws it
 *  somewhere. It also makes a position mergeable: two peers dragging one
 *  card resolve to a cell, not to a smear between two pixel offsets.
 *
 *  CARDS MAY OVERLAP, on purpose. A grid usually implies packing, but a
 *  conspiracy board is photos lying on top of each other, and refusing
 *  an overlap would mean either a collision solver or a fight with the
 *  user over where a card is allowed to go. Document order is paint
 *  order, so the later card is on top -- which is also how the board
 *  avoids needing a z-index per card, one of this type's standing
 *  non-goals.
 * ------------------------------------------------------------------ */

/* The lattice pitch, in px at zoom 1. Fine enough that a card can be
 * nudged rather than snapped a long way, coarse enough that the anchor
 * dots read as points rather than as noise. */
export const CELL = 28;

/* A card's span, in cells. The floor is two cells each way (a 56px card
 * still holds a word); the ceiling is a bit over 600px, which is the
 * "roughly 3x the current range" the owner asked for -- a detail card is
 * ~180px wide today. */
export const SPAN_MIN = 2;
export const SPAN_MAX = 22;
export const DEFAULT_SPAN: Span = { w: 6, h: 4 }; // 168 x 112, near a beat card

export const clampSpan = (s: Span): Span => ({
  w: Math.max(SPAN_MIN, Math.min(SPAN_MAX, Math.round(s.w))),
  h: Math.max(SPAN_MIN, Math.min(SPAN_MAX, Math.round(s.h))),
});

/* Cells are never negative IN THE DOC: the stored origin is the board's
 * top-left, so files, sanitize and every renderer keep one invariant.
 * The board still expands in ANY direction (owner, 2026-08-29) -- a drag
 * released past the top or left edge goes through `landCells` below,
 * which shifts EVERY card so the newcomer lands at zero and the origin
 * follows the content. Expansion is a re-anchoring, not a negative
 * coordinate. */
export const clampCell = (c: Cell): Cell => ({
  x: Math.max(0, Math.round(c.x)),
  y: Math.max(0, Math.round(c.y)),
});

/* A live gesture's cell, unclamped: while the pointer is down a card may
 * sit past the top-left edge -- that is how you ASK for the board to
 * grow that way -- and only the release decides what is written. */
export const roundCell = (c: Cell): Cell => ({ x: Math.round(c.x), y: Math.round(c.y) });

/* WHERE A DRAG LANDS, expansion included -- the pure half of "the board
 * grows in any direction".
 *
 * `moved` maps card ids (existing cards, or copies about to be minted)
 * to their raw target cells, which may be negative. If any are, EVERY
 * card shifts by the same amount so the leftmost/topmost lands at zero:
 * the doc's cells stay non-negative (see clampCell above), nothing
 * changes shape, and an old bundle reading the result sees ordinary
 * cells. The caller compensates the scroll position by `shift` so the
 * board does not appear to jump under the pointer.
 *
 * When nothing went negative, only the moved ids are returned -- a plain
 * drag must not rewrite every card in the doc for no reason. */
export function landCells(
  cards: GridCard[],
  moved: ReadonlyMap<string, Cell>,
): { cells: Record<string, Cell>; shift: Cell } {
  let minX = 0;
  let minY = 0;
  for (const c of moved.values()) {
    minX = Math.min(minX, Math.round(c.x));
    minY = Math.min(minY, Math.round(c.y));
  }
  const shift = { x: Math.max(0, -minX), y: Math.max(0, -minY) };
  const cells: Record<string, Cell> = {};
  for (const [id, c] of moved) {
    cells[id] = { x: Math.round(c.x) + shift.x, y: Math.round(c.y) + shift.y };
  }
  if (shift.x || shift.y) {
    for (const card of cards) {
      /* PLACED cards move with the origin. A card nobody has placed is
       * drawn at a parking spot computed from its index; giving it a
       * real cell here would turn somebody else's re-anchor into a
       * position it never chose (2026-09-01 audit). It stays parked,
       * and its parking spot is re-derived after the shift like before.
       *
       * The cost this cannot remove: a re-anchor rewrites every placed
       * card, so a colleague's concurrent single-card drag is resolved
       * by Yjs on client id -- one of the two loses, and either way the
       * loser's card sits one shift off the rest. Inherent to cells that
       * must stay non-negative; a board-level origin would fix it and is
       * a doc-shape change for another day. */
      if (!moved.has(card.node.id) && card.node.cell) {
        cells[card.node.id] = { x: card.cell.x + shift.x, y: card.cell.y + shift.y };
      }
    }
  }
  return { cells, shift };
}

export const spanOf = (n: Node): Span => (n.span ? clampSpan(n.span) : DEFAULT_SPAN);

/* Where a card sits, or where it should be PARKED if nobody has placed
 * it yet. An unplaced card is not an error -- it is what every card
 * looks like the moment it is added, and what every card imported from
 * another board type looks like -- so the renderer needs an answer
 * rather than a blank.
 *
 * Parking is by document INDEX, laid left to right and wrapping, so a
 * board that has never been arranged still reads in its own order. */
export function placedCell(n: Node, index: number, perRow: number): Cell {
  if (n.cell) return clampCell(n.cell);
  const cols = Math.max(1, perRow);
  const s = DEFAULT_SPAN;
  return { x: (index % cols) * (s.w + 1), y: Math.floor(index / cols) * (s.h + 1) };
}

/* Every card on a grid board, with the cell it draws at. Roots ARE the
 * cards: this type ships a ONE-rung ladder, because "minimum structure"
 * is the whole pitch and a container tier would be a hierarchy nobody
 * asked for. Children are tolerated (an imported subtree, a board whose
 * ladder someone deepened) and simply not drawn -- the same bargain the
 * stowed region makes below a cut board's leaf. */
export interface GridCard {
  node: Node;
  index: number;
  cell: Cell;
  span: Span;
}

export function gridCards(board: Board, perRow = 6): GridCard[] {
  return board.roots.map((node, index) => ({
    node,
    index,
    cell: placedCell(node, index, perRow),
    span: spanOf(node),
  }));
}

/* THE ORDER A PERSON READS THIS BOARD IN -- top down, then left to
 * right (owner, 2026-08-30).
 *
 * Every other board type has an order for free: document order IS cut
 * order, the sequence you would watch. A wall of clues has no sequence,
 * and on this type document order is STACKING order -- dragging one
 * card onto another moves it in `roots` so it paints on top (see
 * GridView's drop). So the two features that read a board as a list --
 * Notes view's worklist and search prev/next -- silently reshuffled
 * every time somebody tidied the wall.
 *
 * Position is the only reading a spatial board has, and it is stable
 * under stacking. NOTHING HERE REORDERS `roots`: paint order, and
 * therefore what sits on top, is untouched. This is a view of the same
 * array.
 *
 * It resolves cells through `gridCards`, not `n.cell`, so an unplaced
 * card sorts where it is PARKED rather than sorting as a blank -- the
 * same answer the renderer draws, which is the whole point of them
 * sharing one function.
 *
 * KNOWN AND ACCEPTED: nothing on a free grid is row-aligned, so two
 * cards sitting visually side by side with one a single cell lower sort
 * into different "rows" -- the lower one comes after everything to the
 * right of the higher one. It reads slightly oddly in a list and is
 * never wrong. The fix would be banding y into tolerance rows, which
 * needs a magic number that is wrong at some card size; that waits for
 * a real complaint rather than being guessed at now.
 *
 * Ties break on document index, so two cards stacked at the identical
 * cell still have a stable, deterministic order. */
export function readingOrder(board: Board): Node[] {
  if (board.type !== "grid") return board.roots;
  return gridCards(board)
    .sort((a, b) => a.cell.y - b.cell.y || a.cell.x - b.cell.x || a.index - b.index)
    .map((c) => c.node);
}

/* How many cells the board has to cover to hold everything, plus room to
 * drag into. The surface is always at least this big, so there is
 * somewhere to put the next card without hunting for an edge. */
/* THE CONTENT'S BOX, in cells: where the cards actually are. The sheet
 * still starts at (0,0) -- cells never go negative -- but the VIEW
 * starts here, so the empty run between the origin and the first card
 * is neither scrolled through nor fitted (2026-09-04: a five-card board
 * had 86 blank cells above its first card, and Fit paid for every one).
 * Zero-sized at the origin for an empty board. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number; // exclusive: the right edge of the rightmost card
  maxY: number;
}
export function gridBounds(cards: GridCard[]): Bounds {
  if (!cards.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = 0;
  let maxY = 0;
  for (const c of cards) {
    minX = Math.min(minX, c.cell.x);
    minY = Math.min(minY, c.cell.y);
    maxX = Math.max(maxX, c.cell.x + c.span.w);
    maxY = Math.max(maxY, c.cell.y + c.span.h);
  }
  return { minX, minY, maxX, maxY };
}
/* The margin of cork the view keeps around the content, in cells. */
export const VIEW_MARGIN = { x: 8, y: 6 };
/* Where the view's window starts, in cells: the content's corner less
 * the margin -- and that may be BEFORE the sheet's own origin (owner,
 * 2026-09-11: "i need more padding built into the edge of what's
 * zoomable. the left side is right up against the side of the pane
 * currently and the top right up against the canvas as well"). It
 * used to clamp at zero, so content that began at cell (0,0) -- every
 * converted board, and any board whose first card was dragged to the
 * corner -- got the margin on the right and bottom only and sat flush
 * against the pane on the other two sides. A negative origin means the
 * SHEET is offset INTO the window by that much, which is where the
 * margin comes from; cards themselves still never go negative
 * (clampCell), so the slack is view, not lattice. The lattice's dots
 * are painted on the window and the offset is whole cells, so they stay
 * in phase. */
/* `margin` is the view's slack; the FRAMED board passes none (owner,
 * 2026-09-04): inside a frame the cork between the cards and the band
 * is the frame's own padding, and a right-click there is about the
 * frame, not a place to put a card. */
export const viewOrigin = (b: Bounds, margin: Span = VIEW_MARGIN_SPAN): Cell => ({
  x: b.minX - margin.w,
  y: b.minY - margin.h,
});
export const VIEW_MARGIN_SPAN: Span = { w: VIEW_MARGIN.x, h: VIEW_MARGIN.y };
export const NO_MARGIN: Span = { w: 0, h: 0 };

export function gridExtent(cards: GridCard[], margin: Span = VIEW_MARGIN_SPAN): Span {
  let w = 0;
  let h = 0;
  for (const c of cards) {
    w = Math.max(w, c.cell.x + c.span.w);
    h = Math.max(h, c.cell.y + c.span.h);
  }
  return { w: w + margin.w, h: h + margin.h };
}

/* WHERE THE PUSHPIN SITS, in px from the card's top edge -- the center
 * of the dot `.beat::before` draws on every other surface (top: 4px on a
 * 4.5px dot). Shared so the pin the eye sees and the point the yarn ties
 * to are THE SAME PLACE: they were 14px apart when the grid drew its own
 * pin on the card's edge, and a string that meets the cork just above
 * its own pin reads as broken (owner-reported). */
export const PIN_INSET = 6.25;

/* The PIN of a card, in cells (fractional). Both ends of every piece of
 * yarn are one of these. */
export const pinOf = (c: GridCard): { x: number; y: number } => ({
  x: c.cell.x + c.span.w / 2,
  y: c.cell.y + PIN_INSET / CELL,
});

/* Yarn whose endpoints both still exist. The renderer asks for this
 * rather than filtering inline so that a half-synced board -- one card
 * arrived, the other has not -- draws no half-string, and so the rule
 * has one statement. */
export function liveEdges(board: Board): Edge[] {
  if (!board.edges?.length) return [];
  const ids = new Set(board.roots.map((r) => r.id));
  return board.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
}

/* Is there already a string between these two cards? Yarn is
 * UNDIRECTED for the purpose of "are these connected" -- two cards
 * joined twice is a mistake, not a stronger connection -- while the
 * stored edge keeps its from/to so the drawing has a direction to sag
 * along. */
export const edgeBetween = (edges: Edge[], a: string, b: string): Edge | undefined =>
  edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));

/* The default yarn palette. Red first, because that is the string
 * everyone pictures. */
/* HOW THICK A STRING IS, as presets rather than a free number.
 *
 * Presets because the menu they live in is tiny and already a ROW of
 * choices (the color swatches) -- a slider would be a second kind of
 * control in a popup the size of a postage stamp, and "somewhere between
 * 3 and 4" is not a distinction anyone needs from string.
 *
 * THE RANGE IS 2.5 TO 5, narrowed from 2-7.5 (owner, 2026-08-26): the
 * thinnest is what the yarn shipped at before he asked for 30% more, and
 * the top is what used to be the second step. The first cut's 7.5 read
 * as rope rather than string, and 2 was thinner than the board had ever
 * drawn. Four steps across that span, near-evenly spaced by RATIO
 * (1.30 / 1.23 / 1.25) rather than by difference, since that is how
 * thickness is actually judged.
 *
 * DEFAULT_YARN_WIDTH is what an edge with no `width` draws at, which is
 * every edge that existed before this -- still 3.25, the "30% bigger"
 * weight, so the default did not move when the range around it did. */
export const YARN_WIDTHS = [2.5, 3.25, 4, 5];
export const DEFAULT_YARN_WIDTH = YARN_WIDTHS[1];

/* The shadow and the picked state both ride the line's own width, so a
 * thick string keeps the same proportions a thin one has -- these were
 * hardcoded ratios in CSS until width went per string. */
export const YARN_SHADOW_RATIO = 1.6;
export const YARN_PICKED_RATIO = 1.6;

/* The offered width closest to `n`. Used instead of a fall-back-to-default
 * because a width that is not on the list is usually one somebody CHOSE
 * -- a preset this build has retired (the range was 2-7.5 for an hour on
 * 2026-08-26), or one a newer build offers. Snapping a deliberately fat
 * string to the fattest one available keeps the intent; resetting it to
 * the default throws the intent away, which is what it did at first and
 * is how a live string quietly went back to normal under its owner. */
export function nearestYarnWidth(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_YARN_WIDTH;
  return YARN_WIDTHS.reduce((best, w) =>
    Math.abs(w - n) < Math.abs(best - n) ? w : best,
  );
}

export const yarnWidth = (e: { width?: number }): number =>
  e.width === undefined ? DEFAULT_YARN_WIDTH : nearestYarnWidth(e.width);

export const YARN_COLORS = [
  "#c0392b",
  "#2d6cdf",
  "#e0a021",
  "#2e9e5b",
  "#8e44ad",
  "#2b2b2b",
];
export const DEFAULT_YARN = YARN_COLORS[0];

/* ------------------------------------------------------------------ *
 *  STACKING -- which card is on top.
 *
 *  DOCUMENT ORDER IS PAINT ORDER, so stacking needs no `z` on a Node and
 *  never has: the later card wins, which is the whole reason "arbitrary
 *  z-order" stayed one of this type's non-goals. The automatic rule is
 *  therefore an ordinary reorder of `board.roots` via `ops.moveNodes`.
 *
 *  THE FOUR EXPLICIT CONTROLS ARE CUT (owner, 2026-08-27: "lets just axe
 *  the layering options for now -- the dragging of cards onto each other
 *  should work, i think"). Bring to front / forward / backward / send to
 *  back were built and worked; he watched them and decided the drag says
 *  it well enough on its own. `stackNeighbour` -- which found the next
 *  card a step would actually pass, so a step always did something
 *  visible -- went with them rather than sit untested-in-anger. It is in
 *  git if they come back.
 *
 *  THE COST, stated because it is easy to miss: document order is also
 *  READING order. Notes view lists a board's notes in it and search
 *  prev/next walks it. That is why the automatic rule fires only on an
 *  actual OVERLAP (owner's call) rather than on every drag -- tidying a
 *  board should not churn the order its notes are worked in.
 * ------------------------------------------------------------------ */

/* Do these two cards cover any of the same cork? Touching edges do not
 * count: cards sit flush against each other all the time on a lattice,
 * and shuffling the order for a neighbour you did not cover would be the
 * churn the overlap rule exists to avoid. */
export const cardsOverlap = (a: GridCard, b: GridCard): boolean =>
  a.cell.x < b.cell.x + b.span.w &&
  b.cell.x < a.cell.x + a.span.w &&
  a.cell.y < b.cell.y + b.span.h &&
  b.cell.y < a.cell.y + a.span.h;

/* Every card the given ones now cover, excluding themselves. The drop
 * handler asks this to decide whether a drag earned a reorder. */
export function overlappedBy(cards: GridCard[], ids: Set<string>): GridCard[] {
  const moved = cards.filter((c) => ids.has(c.node.id));
  if (!moved.length) return [];
  return cards.filter(
    (c) => !ids.has(c.node.id) && moved.some((m) => cardsOverlap(m, c)),
  );
}

