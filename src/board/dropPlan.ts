import type { DropAt } from "./dropTarget";

/* ------------------------------------------------------------------ *
 *  WHERE A DROP LANDS, as pure arithmetic -- both statements of it, in
 *  one file on purpose.
 *
 *  The detail view and the Overview answer the same question two
 *  different ways, because they have different things to ask with: a
 *  detail ROW knows its own (parent, index) and which half of itself the
 *  cursor is in; the Overview has no rows to ask, so it tiles measured
 *  boxes and takes the nearest. Three separate "the slot drew in the
 *  wrong place" bugs in one session were the SAME rule drifting between
 *  those two statements, twice as a side effect of fixing the other one.
 *
 *  So they live side by side and are pinned together (dropPlan.test.ts),
 *  including a cross-check that one gesture resolves to one landing in
 *  both. The callers keep the impure half -- reading the drag store,
 *  measuring boxes, publishing to dropTarget -- and nothing else.
 *
 *  THE INVARIANT everything here serves (owner, 2026-08-03):
 *
 *    ONE reorder = ONE slot, drawn where the thing lands, and releasing
 *    ANYWHERE while it shows puts it there.
 * ------------------------------------------------------------------ */

/* What both resolvers produce: a DropAt minus the two things only the
 * caller knows -- which board the zone belongs to, and whether crossing
 * boards makes this a copy. */
export type Landing = Omit<DropAt, "boardId" | "copy">;

/* A plain slot, everywhere except the column tier (which measures a whole
 * column and asks for half its width). */
export const SLOT_ROOM = 34;

/* What the dragged node is, as far as the arithmetic cares. Height above
 * the leaf rather than depth, so a cross-board drag from a longer ladder
 * lands at the matching ROLE (drag.ts `sameRole`). */
export interface DragFacts {
  height: number; // the dragged node's height above ITS OWN board's leaf
  ladder: number; // levels.length of the DESTINATION board
  overtops: boolean; // taller than the whole destination ladder
  /* "Is this INSIDE the thing in my hand?" -- always a refusal. */
  isSelf: (id: string | null | undefined) => boolean;
  /* "Am I AIMING at the thing in my hand?" -- a refusal for a move, but
   * not while duplicating, where landing beside yourself is the point.
   * Optional: absent, it is isSelf, which is the move-only behavior. */
  isSelfTarget?: (id: string | null | undefined) => boolean;
  isNoOp: (parentId: string | null, index: number) => boolean;
}

/* ------------------------------------------------------------------ *
 *  DETAIL: a row is asked what it would take.
 * ------------------------------------------------------------------ */

export interface RowAsk {
  depth: number;
  parentId: string | null;
  index: number;
  /* Set for a lane: the tier it can also take INSIDE it, so a scene can
   * go into an empty Day without a sibling to aim at. */
  childDepth?: number;
  nodeId?: string;
  /* The cursor is past this row's own vertical midpoint. */
  lower: boolean;
  /* The lanes this row sits INSIDE, outermost first (flatten's LaneAbove).
   * What makes an unfurled section droppable along its whole height --
   * see the `above` branch in planRow. */
  above?: { id: string; parentId: string | null; index: number; depth: number }[];
}

/* THREE ANSWERS, NOT TWO, and the third one is a bug fix (owner-reported
 * 2026-08-05: a scene "will then only allow one or the other of those
 * options", a Day "locks being able to make a drop zone appear").
 *
 * A row returning a bare null conflated two very different situations,
 * and the caller could only leave the last slot showing:
 *
 *   neutral -- this row IS the tier in play, and deliberately has nothing
 *              to offer: it is the card's own origin (rule 4), or it sits
 *              inside the thing being dragged. The slot must go OUT.
 *              That is the "change your mind mid-drag" area, and without
 *              it the preview froze on whichever side you approached from.
 *   none    -- this row is not involved at all (a Day dragged over a
 *              scene's strip). A DESCENDANT may well have published for
 *              this same event, so the caller must not clobber it
 *              blindly -- but nor may a slot from two rows back survive.
 *
 * `neutral` also has to out-rank the event's own defaultPrevented: a
 * scene card's zone accepts the dragover to keep the cursor right without
 * publishing anything, so asking the event whether anybody answered gives
 * the wrong answer exactly over a card's own origin. */
export type RowPlan = { kind: "at"; at: Landing } | { kind: "neutral" } | { kind: "none" };

export function planRow(ask: RowAsk, drag: DragFacts): RowPlan {
  const { depth, parentId, index, childDepth, nodeId, lower } = ask;
  /* Inside the thing being dragged: neutral, not none. You are over your
   * own card (or its subtree), which is precisely where letting go should
   * mean "never mind". */
  const aimsAtSelf = drag.isSelfTarget ?? drag.isSelf;
  if (aimsAtSelf(nodeId) || drag.isSelf(parentId)) return { kind: "neutral" };
  /* TWO SENTINELS, both -1, and they must not meet. itemHeight() returns
   * -1 for "the source board isn't in the snapshot" (a board deleted
   * mid-drag, a collaborator removing it under you); `child` below is -1
   * for "this row has no child tier". Left to collide, an unresolvable
   * drag would match the come-inside branch on every childless row and
   * offer to drop a node INSIDE a leaf. Not reachable through either
   * call site today -- the cards lane passes no nodeId, which the branch
   * also requires -- but drag.ts's acceptsOne already refuses this exact
   * value one line in, and the two should not disagree. */
  if (drag.height < 0) return { kind: "none" };

  const mine = drag.ladder - 1 - depth;
  const child = childDepth === undefined ? -1 : drag.ladder - 1 - childDepth;

  // same tier as this row -> reorder among my siblings
  if (drag.height === mine || (depth === 0 && drag.overtops)) {
    const to = lower ? index + 1 : index;
    /* ...unless that slot is the one it already occupies. A gap opening
     * to say "drop it back where it is" reads as an edit about to
     * happen, and none is. Refusing outright rather than accepting-and-
     * doing-nothing, so the cursor shows no-drop too. */
    if (drag.isNoOp(parentId, to)) return { kind: "neutral" };
    /* Landing BEFORE this row draws the gap above it; landing after it
     * belongs to the NEXT SIBLING, which the detail view resolves by
     * index (hence the null id) and the Overview by id. Same rule as
     * pickSlot's canonical home, stated in the terms a row has. */
    return {
      kind: "at",
      at: {
        parentId,
        index: to,
        beforeId: lower ? null : (nodeId ?? null),
        side: "before",
        axis: "y",
        scope: "node",
        room: SLOT_ROOM,
      },
    };
  }

  // my child's tier -> come inside me, at the top
  if (drag.height === child && nodeId) {
    if (drag.isNoOp(nodeId, 0)) return { kind: "neutral" };
    return {
      kind: "at",
      at: {
        parentId: nodeId,
        index: 0,
        beforeId: null,
        side: "before",
        axis: "y",
        scope: "node",
        room: SLOT_ROOM,
      },
    };
  }

  /* INSIDE AN UNFURLED SECTION (owner-reported 2026-08-05, for T3 and T4
   * alike: "the drop zone should not go away when you get closer to it
   * than the bottom of the header above it").
   *
   * A lane's own row is just its HEADER BAR, so "after this Day" could
   * only be expressed in the bottom ~22px of it. Unfurl the Day and its
   * scenes fill the screen below -- rows which answered `none`, cleared
   * the slot, and made the zone impossible to hold. For the LAST lane in
   * a parent that is the only way to reach "after it" at all, which is
   * why it read as "no drop zone past the final element".
   *
   * So a row inside lane A, when A is at the dragged tier, offers AFTER
   * A. That makes the whole unfurled section one continuous zone, and it
   * is monotonic down the page: A's header top half is before A, and
   * everything from its midpoint down -- header and body alike -- is
   * after A. No gap in the middle to fall through.
   *
   * "Before A" stays a thin target on purpose. It is the same insertion
   * point as "after A's previous sibling", which IS a whole section tall,
   * so every gap is reachable from a large area; only the very first lane
   * under a parent is header-only, exactly as before.
   *
   * The NEAREST enclosing lane wins (the chain is outermost first, so
   * this reads from the end): dragging a Day while inside Reel 2 > Day 5
   * means after Day 5, not after Reel 2 -- Reel 2 is not at the dragged
   * tier anyway, but a deeper chain must never let an outer lane answer
   * for an inner one. */
  if (ask.above?.length) {
    for (let i = ask.above.length - 1; i >= 0; i--) {
      const lane = ask.above[i];
      if (drag.ladder - 1 - lane.depth !== drag.height) continue;
      // inside the very thing being dragged: nothing to offer, and say so
      if (aimsAtSelf(lane.id)) return { kind: "neutral" };
      if (drag.isNoOp(lane.parentId, lane.index + 1)) return { kind: "neutral" };
      return {
        kind: "at",
        at: {
          parentId: lane.parentId,
          index: lane.index + 1,
          /* Resolved by index, like every other "after" in detail: the
           * row that DRAWS it is the next sibling's, not this one. */
          beforeId: null,
          side: "before",
          axis: "y",
          scope: "node",
          room: SLOT_ROOM,
        },
      };
    }
  }

  return { kind: "none" };
}

/* ------------------------------------------------------------------ *
 *  OVERVIEW: the whole surface is tiled, and the nearest box wins.
 * ------------------------------------------------------------------ */

/* One insertion point, paired to the on-screen box it hangs off. */
export interface SlotBox {
  parentId: string | null;
  index: number;
  id: string; // the node this slot sits before
  x: number;
  y: number;
  w: number;
  h: number;
  axis: "x" | "y";
  /* At the column tier the whole COLUMN moves aside, so the measured box
   * -- and the room asked for -- is the column's, not the header's. */
  scope: GapScope;
  room: number;
}

/* WHAT moves aside to make the room, which is also which element the
 * Overview's injected rule has to target. Three, because the Overview's
 * DOM nests a node's element differently at three points in the ladder --
 * see gapSelector. */
export type GapScope = "node" | "column" | "cell";

/* The Overview paints its gap through ONE injected CSS rule keyed on the
 * node id (it is not virtualized, so a subscription per proxy would be
 * thousands -- the legendHighlight reason). That makes the selector a
 * piece of logic, and an unmatchable one fails SILENTLY: the class lands,
 * the arithmetic is right, and nothing paints. That exact shape of bug
 * cost two days in the detail view (an orphaned `.look[data-shadow]`
 * prefix) and shipped again here for beats, so the selector is built in
 * one pure place and pinned by tests.
 *
 * The three cases are the three ways the Overview nests a node:
 *
 *   column -> the header's proxy is INSIDE `.ov-column`, and the whole
 *             column shifts, so match the ancestor that has it;
 *   node   -> a band sits directly in `.ov-block`, a scene card directly
 *             in `.ov-scene`; the gap hangs on that wrapper, never on the
 *             5px bar itself (rule 2);
 *   cell   -> a beat's element is buried in `.ov-cell-row` / `.ov-cells`,
 *             so there IS no wrapper of its own -- the cell is the whole
 *             node, and the gap hangs on it directly. `:has(>` would find
 *             nothing here, which is why beats never painted.
 */
export function gapSelector(scope: GapScope, beforeId: string): string {
  const node = `[data-node="${cssEscape(beforeId)}"]`;
  if (scope === "column") return `.ov-viewport .ov-column:has(${node})`;
  if (scope === "cell") return `.ov-viewport ${node}`;
  return `.ov-viewport :is(.ov-block, .ov-scene):has(> ${node})`;
}

/* CSS.escape isn't in jsdom or node, and this runs in tests. Ids are
 * minted by uid() so they are already selector-safe; this is belt. */
function cssEscape(s: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
}

export type SlotPick =
  /* the landing, ready to publish */
  | { kind: "at"; at: Landing }
  /* every candidate is the thing in your hand -- nothing to publish, and
   * nothing to clear either (leave whatever was showing) */
  | { kind: "self" }
  /* the nearest landing is where the node already sits: clear, so no gap
   * promises an edit that isn't one */
  | { kind: "noop" };

/* Distance from a point to a BOX, zero inside it -- so the card you are
 * actually over always wins over a nearer-by-center neighbour. */
function distance(s: SlotBox, px: number, py: number): number {
  const dx = px < s.x ? s.x - px : px > s.x + s.w ? px - (s.x + s.w) : 0;
  const dy = py < s.y ? s.y - py : py > s.y + s.h ? py - (s.y + s.h) : 0;
  return Math.hypot(dx, dy);
}

export function pickSlot(
  slots: SlotBox[],
  px: number,
  py: number,
  drag: Pick<DragFacts, "isSelf" | "isSelfTarget" | "isNoOp">,
): SlotPick {
  let best: SlotBox | null = null;
  let bestD = Infinity;
  for (const s of slots) {
    // never aim at the thing in your hand -- unless duplicating, when
    // landing beside yourself is exactly the gesture
    if ((drag.isSelfTarget ?? drag.isSelf)(s.id)) continue;
    const d = distance(s, px, py);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (!best) return { kind: "self" };

  const after = best.axis === "x" ? px >= best.x + best.w / 2 : py >= best.y + best.h / 2;
  const index = after ? best.index + 1 : best.index;
  if (drag.isNoOp(best.parentId, index)) return { kind: "noop" };

  /* ONE SLOT PER INSERTION POINT, and it has a canonical home.
   *
   * "After Day 1" and "before Day 2" are the same reorder. Anchoring to
   * whichever card the cursor happens to be nearest painted them in two
   * different places -- a slot above AND below every header -- which is
   * the duplication the detail view was fixed for earlier.
   *
   * So the slot always hangs BEFORE the next sibling when there is one.
   * The "after" form exists only for the end of a run, where there is no
   * next sibling to hang it on -- which is the case that had no slot at
   * all until now. Every insertion point is expressible, and each has
   * exactly one place it can appear. */
  const next = slots.find((s) => s.parentId === best.parentId && s.index === index);
  return {
    kind: "at",
    at: {
      parentId: best.parentId,
      index,
      beforeId: (next ?? best).id,
      side: next ? "before" : "after",
      axis: best.axis,
      scope: best.scope,
      room: best.room,
    },
  };
}
