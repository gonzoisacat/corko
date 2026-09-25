import type { Board, BoardType, Node, Project } from "./types";

/* ------------------------------------------------------------------ *
 *  NESTED BOARDS -- the pure half.
 *
 *  A node carrying `boardRef` stands in for another board (see the field's
 *  own comment in types.ts, and the DECISIONS section of
 *  docs/explorations/board-shapes.md). Nesting is a REFERENCE: one board
 *  may be nested in many places, deleting a nesting card never touches
 *  its target, and "where is this used" is therefore a real question with
 *  a real answer.
 *
 *  Everything here is a pure function over a Project SNAPSHOT, for the
 *  same reason board/seam.ts and board/boardSort.ts are: `isNested` is a
 *  rule BOTH layers need -- the ops refuse a child under one, the
 *  renderers draw it as a card at any tier and the drag layer lets it
 *  land at any of them -- and two copies of a rule that must agree is
 *  exactly the drift dropPlan.ts exists to prevent.
 *
 *  CYCLES ARE ALLOWED, ON PURPOSE (owner, 2026-08-24: "the 'back
 *  button' in effect is a good option to have"). A board may point at
 *  one that points back at it. This REVERSES the exploration's decision
 *  that a cycle is "refused outright, with a message" -- the argument is
 *  short: a nesting card draws its target's NAME, never its content, so
 *  nothing here recurses and there is no loop to blow up. The useful
 *  case is a back-link out of a section board to the master map.
 *
 *  THE HOST BOARD ITSELF STAYS REFUSED, and not for recursion -- nothing
 *  would break. A nesting card means GO SOMEWHERE ELSE, and yourself is
 *  the only target that isn't somewhere else: the card would wear its
 *  own board's name, rename when that board is renamed, and take you
 *  where you already are. It is also the one case an NLE forbids, and
 *  the audience's model of a nested sequence is why this feature has
 *  that name. `ops.nestNode` is the choke point; the picker greys the
 *  row so the refusal is visible before you click it.
 *
 *  WHAT THAT COSTS, and it is the one thing to remember: anything built
 *  LATER that walks the graph -- search or notes across a nest, a Boards
 *  menu drawn as a tree -- needs a PATH check, stopping when a board
 *  repeats on its own ancestor chain. Not a global `seen` set: one board
 *  may be nested in several places, so a global set would silently drop
 *  the legitimate repeats a DAG is made of.
 * ------------------------------------------------------------------ */

/* A node stands in for another board. The one definition -- ops guard on
 * it, renderers switch on it, the seam and the drop planner ask it
 * whether a node can take a child. */
export const isNested = (n: Node): boolean => Boolean(n.boardRef);

/* What a NESTING CARD needs in order to draw: the target's LIVE title
 * (owner's call -- the card shows the board's own name, not a local
 * label) and its type, for the symbol. Just those two, because the card
 * is boring on purpose: the split view is one click away, and the target
 * may have a different STRUCTURE, so a preview of it would not resemble
 * the thing it stands in for.
 *
 * Indexed by board id and handed to the row tree through the PANE
 * (board/context.ts), never read per card -- the Overview is not
 * virtualized, so a subscription inside a card is thousands of them. */
export interface NestInfo {
  title: string;
  type: BoardType | undefined;
}

/* One place a board is nested: the card, and the board that card is on. */
export interface NestUse {
  boardId: string; // the board the CARD lives on
  boardTitle: string;
  nodeId: string;
  nodeTitle: string; // the card's own (inert) title, for a "where used" list
  depth: number;
}

const walkNodes = (nodes: Node[], depth: number, fn: (n: Node, depth: number) => void) => {
  for (const n of nodes) {
    fn(n, depth);
    if (n.children.length) walkNodes(n.children, depth + 1, fn);
  }
};

/* Every nesting card in the project, grouped by the board it points AT.
 *
 * ONE walk of the project for the whole answer, because both readers want
 * the whole answer: the delete refusal needs the uses of one board, and
 * the cycle check needs the edges of all of them. Callers memoize on the
 * snapshot's identity -- structural sharing keeps an untouched project
 * object stable, so this runs on doc change and not on render. */
export function nestUses(project: Project): Map<string, NestUse[]> {
  const out = new Map<string, NestUse[]>();
  for (const b of project.boards) {
    walkNodes(b.roots, 0, (n, depth) => {
      if (!n.boardRef) return;
      const list = out.get(n.boardRef) ?? [];
      list.push({
        boardId: b.id,
        boardTitle: b.title,
        nodeId: n.id,
        nodeTitle: n.title,
        depth,
      });
      out.set(n.boardRef, list);
    });
  }
  return out;
}

/* The board a nesting card points at, or null when the target is gone.
 *
 * Deliberately NOT healed, guessed at or repaired away. A dangling ref
 * is usually a board that has not ARRIVED yet -- a peer holding the card
 * before the board syncs in -- so stripping it would delete a live link
 * over a race, and sync it back to everyone. The card draws a tombstone
 * instead (see `boardRefTitle`), which resolves itself the moment the
 * board lands, and Cmd-Z after a delete restores the board with its id
 * intact. What it does NOT survive is an export/import round trip, since
 * importBoard mints fresh board ids on purpose. */
export const nestTarget = (project: Project, node: Node): Board | null =>
  node.boardRef ? project.boards.find((b) => b.id === node.boardRef) ?? null : null;

/* The board index the panes hand down, rebuilt only when a board is
 * added, removed, RENAMED or re-typed -- never on an edit to a card.
 * The cache key is what buys that: `getSnapshot()` rebuilds the Project
 * object on every doc change (only the individual Board objects are
 * identity-stable), so memoizing on `project.boards` would make a new
 * map per keystroke and churn the context value for the whole row tree.
 *
 * Module-level rather than a hook's useMemo, so the two panes of a split
 * share one map and one comparison. */
let indexKey = "";
let indexMap: Map<string, NestInfo> = new Map();

export function boardIndex(project: Project): Map<string, NestInfo> {
  const key = project.boards.map((b) => `${b.id}\u0000${b.title}\u0000${b.type ?? ""}`).join("\u0001");
  if (key !== indexKey) {
    indexKey = key;
    indexMap = new Map(project.boards.map((b) => [b.id, { title: b.title, type: b.type }]));
  }
  return indexMap;
}

/* ------------------------------------------------------------------ *
 *  WHAT A NESTING CARD IS CALLED, and therefore what a search matches.
 *
 *  A nesting card draws its TARGET board's live title and leaves its own
 *  `title` written but unread (board/NestedFace.tsx says why). Search,
 *  meanwhile, tested `node.title` everywhere -- so a nesting card was
 *  findable by a name that appears NOWHERE on it, and not findable by
 *  the name it actually shows. Owner-reported 2026-08-26 as "it should
 *  all be searchable".
 *
 *  THE DISPLAYED NAME WINS, AND THE HIDDEN ONE STOPS COUNTING. Matching
 *  both was considered and dropped: a hit you cannot see is exactly the
 *  bug, and the app's rule everywhere else is that a match is a card
 *  whose own title matches -- for a nesting card, the title anyone can
 *  read IS the target's. Un-nesting hands the old name back, and it
 *  becomes searchable again at that moment.
 *
 *  It lives in this file because nesting is the ONLY reason a node's
 *  searchable text ever differs from `node.title`.
 * ------------------------------------------------------------------ */

/* The name a nesting card shows, or null if this is an ordinary card.
 * ONE statement of it, shared with `nestFace` -- if the two drifted, a
 * card would be findable by one name and labelled with another, which is
 * the bug this exists to fix wearing a different hat. */
export function nestTitle(node: Node, nests: Map<string, NestInfo>): string | null {
  if (!node.boardRef) return null;
  /* A dangling ref falls back to the tombstone, because that is what the
   * card is DRAWING (usually a board that has not synced in yet). */
  return nests.get(node.boardRef)?.title || node.boardRefTitle || "Untitled board";
}

/* The text any search should test for this node.
 *
 * `nests` is optional and the fallback is `node.title`, which is the
 * pre-nesting behavior -- so a caller that cannot reach the board index
 * degrades instead of breaking. Every real call site threads it; the
 * default exists for the pure tests and for `hit`'s own idiom of an
 * optional trailing argument. */
export const searchTitle = (node: Node, nests?: Map<string, NestInfo>): string =>
  (nests && nestTitle(node, nests)) || node.title;
