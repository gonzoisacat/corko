import { DEFAULT_MAX_ROW_BEATS, type Board, type LegendEntry, type LevelDef, type Node, type Span } from "./types";
import { GRID_LEVELS } from "./boardTypes";
import { tierDefaultFor } from "../colors";
import { SPAN_MAX } from "./gridBoard";
import { uid } from "./ids";

/* ------------------------------------------------------------------ *
 *  A FREE GRID FROM A BEAT MAP (owner, 2026-09-11): "converting a beat
 *  map to a Free Grid from the Overview mode". A NEW board, never a
 *  change to this one -- a grid has one rung and no hierarchy, so the
 *  Beat Map stays what it is and the grid is a copy laid out flat. (This
 *  answers a question board-shapes.md left open on purpose: a board's
 *  type does not change after creation. You make another board.)
 *
 *  WYSIWYG IN STRUCTURE, his words. The layout is the Overview's RULE
 *  re-derived on the lattice rather than its pixels copied: one column
 *  per node at the tier the Overview is columned by, each column its
 *  head card with its descendants stacked beneath, the leaf tier packed
 *  two to a row, and the tiers ABOVE the columns -- the Overview's
 *  spines -- as wide cards at the head of their run. Nothing deeper
 *  than the Overview's Detail level comes across. The grid's cards are
 *  many times the size of the Overview's proxies, so pixel positions
 *  would have had to be rescaled anyway; deriving from the tree is
 *  exact, testable, and needs no view to be mounted.
 *
 *  WHAT THE HIERARCHY BECOMES, with one rung to hold it: POSITION (the
 *  columns and stacks are the tree), and COLOR (each card that took its
 *  tier's color now carries that color as an override, since the tier
 *  is not there to inherit from). NOT yarn -- his call, "no yarn on
 *  creation at all and no options. probably ever." A grid's strings are
 *  the ones you tie.
 *
 *  Pure: a Board in, a Board out, no ids regenerated -- the op does that
 *  (regenBoardIds), exactly as duplicateBoard does.
 * ------------------------------------------------------------------ */

export interface GridFromOptions {
  /* The Overview's "1 column per" tier, as a depth. */
  columnDepth: number;
  /* The Overview's "Detail level", as a depth: nothing deeper comes. */
  detailDepth: number;
}

/* THE GEOMETRY, in cells:
 *   - EVERY CARD IS A 3x5 NOTECARD (owner, 2026-09-11: "lets default to
 *     3x5 cards (standard notecard size)") -- five cells wide, three
 *     tall, 140x84px, the index card a real corkboard is made of. Scenes
 *     and beats alike: on cork they are the same card, and it is the
 *     column and the row that say which is which. (The first cut sized
 *     heads 6x4 and leaves 4x3, borrowing the Beat Map's two sizes.)
 *   - a band above the columns is the same height, a label for a run
 *     rather than a card to read;
 *   - the beats wrap where the BOARD wraps them (maxRowBeats), which is
 *     what makes the grid the Overview's shape rather than an
 *     approximation of it;
 *   - a gutter of one cell everywhere, which is the grid's own parking
 *     gutter (gridBoard.ts placedCell). */
export const GUTTER = 1;
export const NOTECARD: Span = { w: 5, h: 3 };
export const LEAF_SPAN: Span = NOTECARD;
export const HEAD_SPAN: Span = NOTECARD;
export const BAND_H = 3;
export const BAND_PITCH = BAND_H + GUTTER;

/* A title for the copy that says what it is and where it came from. */
export const gridTitleFor = (src: Board): string => `${src.title || "Untitled"} (Free Grid)`;

/* THE COLORS, which need one step a plain copy does not (found in the
 * scoping): a card with no color of its own takes its TIER's, and that
 * tier does not exist on the grid. So each source tier becomes an OPTION
 * entry on the new board -- no `tier` field, so it is an ordinary color
 * override that the palette hoist lifts to the project -- and the cards
 * that inherited it now name it. A card with a color of its own keeps
 * it: that is a project palette id and resolves on every board.
 *
 * Deduped against what the project already has, by fill: converting a
 * second Beat Map with the same tier colors reuses the first one's
 * entries rather than minting "Scene" twice. The source's projected
 * legend carries the palette, which is what is searched. */
function tierOptions(src: Board): Map<string, LegendEntry> {
  const out = new Map<string, LegendEntry>();
  const options = src.legend.filter((e) => !e.tier && e.id !== "role:nested");
  for (const lvl of src.levels) {
    const own = src.legend.find((e) => e.tier === lvl.id) ?? tierDefaultFor(src.levels, lvl.id);
    const existing = options.find((e) => e.bg.toLowerCase() === own.bg.toLowerCase());
    out.set(
      lvl.id,
      existing ?? { id: uid("lg"), label: own.label || lvl.name, bg: own.bg, border: own.border },
    );
  }
  return out;
}

/* One flat card from one tree node. Children go (the grid draws none);
 * so do the fold, the hide and the manual break, which are Beat Map
 * facts. */
function flatCard(n: Node, color: string | undefined, cell: { x: number; y: number }, span: Span): Node {
  const { children: _c, collapsed: _f, hidden: _h, breakAfter: _b, ...rest } = n;
  void _c; void _f; void _h; void _b;
  return {
    ...rest,
    color: rest.color ?? color,
    // a side sit with no picture behind it (sidePair handles the real
    // ones) means nothing here; a picture added later takes the default
    imageFit: rest.imageFit === "side" ? undefined : rest.imageFit,
    collapsed: false,
    children: [],
    cell,
    span,
  };
}

/* A SIDE-BY-SIDE CARD BECOMES TWO CARDS (owner, 2026-09-11: "you could
 * also just translate side by side pictures into a picture and a card,
 * right? we should do that. that's the simplest probably"). It is: the
 * picture pinned beside the words is what side-by-side LOOKS like, and a
 * grid can pin two things beside each other without learning anything.
 *
 * The picture half is a card with no words wearing the picture as FILL;
 * the text half is the card without its picture -- and without the text
 * overrides that were written for type over a photograph, which is what
 * the Beat Map itself does for a side card (board/cardText.ts plainText:
 * the words are on paper, so the shadow and the white go). The tier's
 * edge says which side the picture stands on. */
const isSide = (n: Node): boolean => n.imageFit === "side" && !!(n.image || n.still);

function sidePair(
  n: Node,
  color: string | undefined,
  edge: "left" | "right",
  cell: { x: number; y: number },
  span: Span,
): [Node, Node] {
  const { image, still, imageFit: _fit, imageTile: _t, imageMirror: _m, imageAlign: _a, textColor: _tc, textSize: _ts, textShadow: _tsh, ...words } = n;
  void _fit; void _t; void _m; void _a; void _tc; void _ts; void _tsh;
  const picX = edge === "left" ? cell.x : cell.x + span.w + GUTTER;
  const txtX = edge === "left" ? cell.x + span.w + GUTTER : cell.x;
  const picture: Node = {
    id: uid("pic"),
    title: "",
    collapsed: false,
    children: [],
    image,
    still,
    imageFit: "fill",
    color: n.color ?? color,
    cell: { x: picX, y: cell.y },
    span,
  };
  const text = flatCard({ ...words, children: [], collapsed: false }, color, { x: txtX, y: cell.y }, span);
  return [picture, text];
}

interface Placed {
  node: Node;
  depth: number;
  cell: { x: number; y: number };
  span: Span;
  /* set when this is a side-by-side card: it becomes TWO cards, the
     picture on this edge */
  side?: "left" | "right";
}

/* THE OVERVIEW'S SHAPE, which the first cut got wrong (owner, with two
 * screenshots: "this is not a good first pass. it should at least be the
 * same layout as in the overview. the cards should appear orthogonally in
 * relationship to each other the exact same way they do in the
 * overview"). It had stacked a scene's beats BENEATH the scene. The
 * Overview draws a scene as a ROW: the scene card at the left and its
 * beats running to the RIGHT, wrapping at the board's maxRowBeats --
 * the detail view's scene label and beat strip, in miniature. Everything
 * above the scene tier stacks DOWN its column.
 *
 * So one recursive rule. A node at the leaf-parent tier is a ROW: its
 * card, then its leaves to the right in rows of maxRowBeats (a manual
 * break still breaks). A node above that, from the column tier down, is
 * a HEAD with its children stacked beneath it. A column is the head at
 * the column tier and whatever that yields; it is as wide as its widest
 * row. Leaves never stand alone -- the column tier is at most the
 * leaf-parent, so a leaf is always inside its parent's row.
 *
 * A side-by-side card is a PAIR standing where the card would: the
 * picture, then the words (or the other way, per the tier's edge), and
 * a scene's beats begin after both. */
function packNode(
  n: Node,
  depth: number,
  src: Board,
  detailDepth: number,
  x: number,
  y: number,
  out: Placed[],
): { height: number; width: number } {
  const leafDepth = src.levels.length - 1;
  const leafParent = leafDepth - 1;
  if (depth > detailDepth) return { height: 0, width: 0 };
  const edge: "left" | "right" = src.levels[depth]?.imageEdge ?? "left";
  const side = isSide(n);
  const cardW = side ? 2 * HEAD_SPAN.w + GUTTER : HEAD_SPAN.w;
  /* A FULL-WIDTH tier -- the Overview's black band across a column, the
   * detail view's band across the page -- is a band here too: as wide as
   * the column it heads (capped by what a card may span) and shorter, a
   * label for what is under it rather than a card to read. Its children
   * are packed FIRST so the width is known; the card is then placed
   * above them. */
  const band = !!src.levels[depth]?.fullWidth && !side && depth < leafParent;
  if (!band) {
    out.push(side ? { node: n, depth, cell: { x, y }, span: HEAD_SPAN, side: edge } : { node: n, depth, cell: { x, y }, span: HEAD_SPAN });
  }

  if (depth === leafParent || depth === leafDepth) {
    /* A ROW: the leaves to the right, wrapping at maxRowBeats. (depth ===
     * leafDepth is a one-rung source, whose only card is its own row.) */
    if (leafDepth > detailDepth || depth === leafDepth) return { height: HEAD_SPAN.h, width: cardW };
    const perRow = Math.max(1, Math.min(10, src.maxRowBeats ?? DEFAULT_MAX_ROW_BEATS));
    const bx = x + cardW + GUTTER;
    let col = 0;
    let row = 0;
    let widest = 0;
    for (const leaf of n.children) {
      if (col >= perRow) {
        col = 0;
        row++;
      }
      const cell = { x: bx + col * (LEAF_SPAN.w + GUTTER), y: y + row * (LEAF_SPAN.h + GUTTER) };
      if (isSide(leaf)) {
        /* a side leaf is two leaf cards wide; if that does not fit the
           row, it starts the next one */
        if (col + 2 > perRow && col > 0) {
          col = 0;
          row++;
          cell.x = bx;
          cell.y = y + row * (LEAF_SPAN.h + GUTTER);
        }
        out.push({ node: leaf, depth: depth + 1, cell, span: LEAF_SPAN, side: src.levels[depth + 1]?.imageEdge ?? "left" });
        col += 2;
      } else {
        out.push({ node: leaf, depth: depth + 1, cell, span: LEAF_SPAN });
        col++;
      }
      widest = Math.max(widest, col);
      if (leaf.breakAfter) {
        col = 0;
        row++;
      }
    }
    const rows = n.children.length ? (col === 0 && row > 0 ? row : row + 1) : 0;
    const beatsH = rows ? rows * (LEAF_SPAN.h + GUTTER) - GUTTER : 0;
    const beatsW = widest ? widest * (LEAF_SPAN.w + GUTTER) - GUTTER : 0;
    return {
      height: Math.max(HEAD_SPAN.h, beatsH),
      width: beatsW ? cardW + GUTTER + beatsW : cardW,
    };
  }

  /* A HEAD: children stacked beneath it. */
  const headH = band ? BAND_H : HEAD_SPAN.h;
  let cy = y + headH + GUTTER;
  let width = cardW;
  for (const c of n.children) {
    const r = packNode(c, depth + 1, src, detailDepth, x, cy, out);
    if (r.height === 0) continue;
    cy += r.height + GUTTER;
    width = Math.max(width, r.width);
  }
  if (band) out.push({ node: n, depth, cell: { x, y }, span: { w: Math.min(SPAN_MAX, width), h: BAND_H } });
  return { height: cy - y - GUTTER, width };
}

export function gridFromBoard(src: Board, opts: GridFromOptions): Board {
  const leafDepth = src.levels.length - 1;
  /* at most the leaf-parent, as the Overview clamps it: a leaf is never
   * a column, it is always inside its parent's row */
  const columnDepth = Math.max(0, Math.min(opts.columnDepth, Math.max(0, leafDepth - 1)));
  const detailDepth = Math.max(columnDepth, Math.min(opts.detailDepth, leafDepth));
  const colors = tierOptions(src);

  const placed: Placed[] = [];
  /* The bands: one row per tier above the columns, outermost at the top,
   * so a Reel's card sits above its Days' cards which sit above the
   * columns -- the Overview's spines, laid down. */
  const bandRows = columnDepth;
  const columnsY = bandRows * BAND_PITCH;
  /* Columns are laid at a CUMULATIVE x, each as wide as its own content
   * asks (a side-by-side head widens its column), rather than at a fixed
   * pitch -- so a picture beside one scene does not push every column on
   * the board apart. */
  let x = 0;
  let col = 0;

  /* A depth-first walk that hands each ancestor the x where its run
   * starts and, once the run is walked, where it ended -- which is what
   * its band spans, capped by what a card may span. */
  const walk = (n: Node, depth: number): void => {
    if (depth === columnDepth) {
      const { width } = packNode(n, depth, src, detailDepth, x, columnsY, placed);
      x += width + GUTTER;
      col++;
      return;
    }
    const startX = x;
    const startCol = col;
    for (const c of n.children) walk(c, depth + 1);
    const extent = col > startCol ? x - startX - GUTTER : HEAD_SPAN.w;
    const w = Math.min(SPAN_MAX, extent);
    placed.push({ node: n, depth, cell: { x: startX, y: depth * BAND_PITCH }, span: { w, h: BAND_H } });
  };
  for (const r of src.roots) walk(r, 0);

  /* Reading order on a grid is by position (gridBoard.readingOrder), so
   * the roots' order only decides PAINT order. Bands first so a column's
   * cards paint over the band they sit under, then everything in cut
   * order. */
  placed.sort((a, b) => a.depth - b.depth || 0);
  const levelOf = (d: number): LevelDef | undefined => src.levels[d];
  const roots = placed.flatMap((p) => {
    const color = colors.get(levelOf(p.depth)?.id ?? "")?.id;
    return p.side ? sidePair(p.node, color, p.side, p.cell, p.span) : [flatCard(p.node, color, p.cell, p.span)];
  });

  /* Only the tier entries some card actually names come across. */
  const used = new Set(roots.map((r) => r.color));
  const optionEntries = [...colors.values()].filter((e, i, arr) => used.has(e.id) && arr.findIndex((o) => o.id === e.id) === i);
  const ownOptions = src.legend.filter((e) => !e.tier && e.id !== "role:nested" && used.has(e.id));

  return {
    id: uid("bd"),
    title: gridTitleFor(src),
    type: "grid",
    levels: GRID_LEVELS,
    legend: [
      ...GRID_LEVELS.map((l) => tierDefaultFor(GRID_LEVELS, l.id)),
      ...ownOptions.filter((e) => !optionEntries.some((o) => o.id === e.id)),
      ...optionEntries,
    ],
    roots,
    folder: src.folder,
    edges: [],
  };
}
