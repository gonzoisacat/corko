import { useEffect, useState, useSyncExternalStore } from "react";
import type { DragEvent } from "react";
import { useBoardUI } from "./context";
import { dropChip, legendDrag } from "./legendDrag";
import { dropTarget } from "./dropTarget";
import { getSnapshot } from "../state/ydoc";

/* ------------------------------------------------------------------ *
 *  Drag + re-parent plumbing (spec Sec 4; ADR 0001).
 *
 *  The dragged node lives in module state, not React state, so starting
 *  a drag doesn't re-render the tree. A drop is accepted only when the
 *  dragged node's tier (depth) matches the drop zone's tier -- that
 *  keeps the ladder invariant (a node stays at its own tier) and, since
 *  tiers are distinct, makes dropping into your own subtree impossible
 *  to express through same-tier zones (moveNode guards it regardless).
 *
 *  An item carries the board it was picked up from, so a drop landing in
 *  a different board (split view) can COPY instead of MOVE -- pulling
 *  from the master cut into a section board leaves the master intact
 *  (see dropMove.ts).
 * ------------------------------------------------------------------ */

export interface DragItem {
  id: string;
  depth: number;
  boardId: string; // the board the drag started in
  /* This card stands in for another board (state/nesting.ts `isNested`),
   * which makes it TIER-FREE: it lands in any tier's gap, on any board.
   *
   * The tier invariant exists to protect the SUBTREE -- a node at depth d
   * has children at d+1, so moving it to another depth silently re-tiers
   * all of them, and the cross-board `sameRole` rule exists because equal
   * depths on different-length ladders are different roles. A nesting
   * card has NO children, so there is nothing for either rule to protect.
   *
   * Not a convenience: it is what makes the card's own color necessary
   * rather than optional (colors.ts `nestedDefault`). A card that can
   * live anywhere must not repaint every time you drop it. */
  nested?: boolean;
}

let current: DragItem | null = null;
/* Every id inside the dragged node, itself included. A node cannot land in
 * its own subtree -- moveNode has always guarded that -- but the ZONES
 * still lit up, so dragging a Day left a trail of candidate gaps sitting
 * in the very rows that were about to move (owner-reported). Computed ONCE
 * at dragstart rather than walked per dragover, which fires constantly. */
let dragged = new Set<string>();
/* Where the dragged node currently SITS. Inserting it back at its own
 * index -- or at index + 1, which is the same slot once it has been
 * lifted out -- changes nothing, and offering a gap there says you are
 * about to do something when you aren't (owner-reported 2026-08-03). */
let origin: { parentId: string | null; index: number } | null = null;
/* Option/Alt held during THIS drag: the gesture leaves the original
 * where it is and lands a copy (owner, 2026-08-14). It rides the same
 * path a cross-board drag already takes -- ops.copyNodes, the green
 * marker, the copy cursor -- so the only new idea is what turns it on. */
let dup = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function locateOrigin(id: string): { parentId: string | null; index: number } | null {
  for (const b of getSnapshot().boards) {
    const walk = (
      nodes: { id: string; children: never[] }[],
      parentId: string | null,
    ): { parentId: string | null; index: number } | null => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) return { parentId, index: i };
        const hit = walk(nodes[i].children, nodes[i].id);
        if (hit) return hit;
      }
      return null;
    };
    const hit = walk(b.roots as never, null);
    if (hit) return hit;
  }
  return null;
}

function subtreeIds(id: string): Set<string> {
  const out = new Set<string>([id]);
  for (const b of getSnapshot().boards) {
    const walk = (nodes: { id: string; children: { id: string }[] }[], inside: boolean): boolean => {
      for (const n of nodes) {
        const here = inside || n.id === id;
        if (here) out.add(n.id);
        if (walk(n.children as never, here) && !here) return true;
        if (here && n.id === id) return true;
      }
      return false;
    };
    walk(b.roots as never, false);
  }
  return out;
}

export const dragStore = {
  get: (): DragItem | null => current,
  /* True for the dragged node and everything under it -- a zone in there
   * must refuse, or you are offered a drop that cannot happen. */
  isSelf: (id: string | null | undefined): boolean => Boolean(id && dragged.has(id)),
  /* Same set, MINUS the dragged card itself while duplicating.
   *
   * The two questions look alike and aren't. "Is this row INSIDE the
   * thing in my hand?" (asked of a row's parent) must always refuse --
   * that is the subtree rule, kept at the owner's word. "Am I AIMING at
   * the thing in my hand?" (asked of a row's own node) is a refusal only
   * for a MOVE, where it would change nothing. Duplicating, it is the
   * likeliest gesture there is: another one of these, right here
   * (owner, 2026-08-14: "i will want to be able to do that"). */
  isSelfTarget: (id: string | null | undefined): boolean =>
    Boolean(id && dragged.has(id) && !(dup && id === current?.id)),
  /* `source` is the element the gesture started on, and passing it is
   * what makes a CANCELLED drag recoverable.
   *
   * The detail list is virtualized and auto-scrolls during a drag, so
   * the dragged row can UNMOUNT mid-gesture. Escape (or a release over
   * nothing) then fires `dragend` on a detached element -- and React
   * delegates events at the root container, so a detached node's events
   * reach no React handler at all. The store stayed set: `.app` kept
   * `.dragging`, every seam and gap chip stayed `display: none`, and the
   * board offered no inserts until the next drag happened to reset it.
   *
   * A NATIVE listener on the element itself still fires, attached or
   * not, because the event is dispatched directly at it. `once` so it
   * cleans itself up; ending twice is harmless (end() is idempotent),
   * which is what happens on a normal drop -- dragend follows drop. */
  start(item: DragItem, source?: HTMLElement) {
    current = item;
    dragged = subtreeIds(item.id);
    origin = locateOrigin(item.id);
    source?.addEventListener("dragend", () => dragStore.end(), { once: true });
    emit();
  },
  /* True when landing here would put the node back exactly where it is.
   * Both `index` and `index + 1` name the same slot: the node is lifted
   * out before it is re-inserted, so the sibling after it slides up. */
  isNoOp(parentId: string | null, index: number, sameBoard: boolean): boolean {
    /* A DUPLICATE has no no-op: dropping a copy exactly where the
     * original sits is not only legal, it is the likeliest gesture --
     * "another one of these, right here". The refusal exists because a
     * MOVE to its own slot changes nothing. */
    if (!origin || !sameBoard || dup) return false;
    return origin.parentId === parentId && (index === origin.index || index === origin.index + 1);
  },
  /* ---- Option/Alt: duplicate instead of move -------------------------- *
   * Held at DROP time, but tracked continuously from dragover because the
   * preview has to follow the modifier: press Option mid-drag and the
   * marker should turn copy-green without waiting for the release. The
   * browser fires dragover a few times a second even with the pointer
   * still, so this stays honest on its own; the keydown/keyup listeners
   * below make it instant. */
  dup: (): boolean => dup,
  /* Published straight to the DOM, NEVER through emit(). This runs from
   * `dragover`, which fires several times a second for the whole
   * gesture, and a store emit here re-renders App -> every pane -> the
   * virtualized list. Swapping the row under the cursor mid-drag is how
   * you LOSE a drop: the browser dispatches `drop` at the element it was
   * over, and a replaced one takes it nowhere (the same delegation trap
   * that made a cancelled drag unrecoverable, see start()). Owner
   * reported exactly that -- the card flickering as Option went down and
   * up, and the drop refusing.
   *
   * So this is the legendHighlight / noteMarks idiom: one attribute on a
   * root, the browser does the matching, no React pass at all. The green
   * marker and the copy cursor do not need it either -- each zone reads
   * `dragStore.dup()` in its own dragover, which is already running. */
  setDup(on: boolean) {
    if (dup === on) return;
    dup = on;
    const app = document.querySelector(".app");
    if (on) app?.setAttribute("data-drag-dup", "on");
    else app?.removeAttribute("data-drag-dup");
  },
  end() {
    current = null;
    dragged = new Set();
    origin = null;
    dragStore.setDup(false); // clears the attribute too
    emit();
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/* Same ROLE, not just same depth. Within one board, depth IS the role.
 * A cross-board drag can pair boards with DIFFERENT ladder lengths, where
 * equal depths mean different things -- a 4-tier board's scene and a
 * 3-tier board's beat are both depth 2 -- and accepting that drop cloned
 * a node with children BELOW the destination's leaf tier: content nothing
 * can render or reach (observed as "moving between differently-tiered
 * boards misbehaves"). Role = height above the leaf, the same bottom-up
 * on every ladder (a beat is 0, its lane 1, ...).
 *
 * Height-based matching is the LAW now (owner's call, 2026-08-02):
 * cross-ladder drops between same-height tiers at DIFFERENT depths are
 * accepted -- see zoneAccepts below, which this feeds. */
export function sameRole(
  itemBoardId: string,
  itemDepth: number,
  zoneBoardId: string,
  zoneDepth: number,
  /* A nesting card has no role to match: no children, so no rung is
   * wrong for it (see DragItem.nested). */
  nested = false,
): boolean {
  if (nested) return true;
  // no zone board (an overlay-rendered zone outside a pane's context) is
  // not a cross-board situation -- keep the plain depth rule
  if (!zoneBoardId || itemBoardId === zoneBoardId) return true;
  const boards = getSnapshot().boards;
  const src = boards.find((b) => b.id === itemBoardId);
  const dst = boards.find((b) => b.id === zoneBoardId);
  if (!src || !dst) return false;
  return src.levels.length - 1 - itemDepth === dst.levels.length - 1 - zoneDepth;
}

/* The dragged node's role height, and whether it overtops a whole board.
 * A one-or-more-taller node can't land at any existing rung -- instead a
 * TOP-tier drop grows the destination's ladder (ops.extendBoardWithNode;
 * owner's refinement 2026-08-02). */
export function itemHeight(item: DragItem): number {
  const src = getSnapshot().boards.find((b) => b.id === item.boardId);
  return src ? src.levels.length - 1 - item.depth : -1;
}

export function overtops(item: DragItem, zoneBoardId: string): boolean {
  if (!zoneBoardId || item.boardId === zoneBoardId) return false;
  const dst = getSnapshot().boards.find((b) => b.id === zoneBoardId);
  if (!dst) return false;
  return itemHeight(item) > dst.levels.length - 1;
}

/* One predicate for what a zone takes (dragover/enter/drop must agree):
 * same board -> plain depth match; cross-board -> same ROLE at any
 * depths, or a taller-than-the-board node over a TOP-tier zone (which
 * grows the ladder on drop). */
/* EXPORTED for the Free Grid, which has no `useDropZone` of its own --
 * it drags with pointer events -- but still has to answer the same
 * question when a card arrives from ANOTHER board. Same rule, one
 * definition: a grid asking it with zoneDepth 0 gets the height match,
 * the nesting-card exception and the overtops case for free. */
export function acceptsOne(item: DragItem, zoneBoardId: string, zoneDepth: number): boolean {
  /* A nesting card takes any rung of any ladder (see DragItem.nested),
   * bounded only by the destination's leaf: past that is the STOWED
   * region, where content exists and nothing renders it. The drop
   * TARGETS at those tiers already exist -- a seam publishes a staircase
   * of them and a lane row publishes its own tier, its child tier and
   * its whole ancestor chain -- so this is a refusal being lifted rather
   * than new machinery. */
  if (item.nested) {
    const board = getSnapshot().boards.find((b) => b.id === (zoneBoardId || item.boardId));
    if (!board) return false;
    return zoneDepth >= 0 && zoneDepth <= board.levels.length - 1;
  }
  if (!zoneBoardId || item.boardId === zoneBoardId) return item.depth === zoneDepth;
  if (itemHeight(item) === -1) return false;
  const dst = getSnapshot().boards.find((b) => b.id === zoneBoardId);
  if (!dst) return false;
  const dstHeight = dst.levels.length - 1 - zoneDepth;
  if (itemHeight(item) === dstHeight) return true;
  return zoneDepth === 0 && overtops(item, zoneBoardId);
}

/* A zone may offer SEVERAL tiers, and which one matched changes what the
 * drop means. A container band takes its own tier (reorder me among my
 * siblings) AND its child tier (put it inside me) -- which is what makes
 * dropping a scene into an empty reel work at all, rather than needing a
 * sibling scene to aim at. Returns the matched depth, or null. */
function zoneMatch(item: DragItem, zoneBoardId: string, depths: number[]): number | null {
  for (const d of depths) if (acceptsOne(item, zoneBoardId, d)) return d;
  return null;
}

const asDepths = (d: number | number[]): number[] => (Array.isArray(d) ? d : [d]);

/* Give the drag a HALF-SIZE ghost (owner's call, 2026-08-02: the
 * full-size ghost covered the very cards you're aiming between). The
 * browser captures whatever element you hand setDragImage as it is
 * painted, so: clone the card into a half-size wrapper, scale the clone
 * inside it (the wrapper's own size is what sizes the ghost; a transform
 * on the handed element itself is unreliably honoured), park it
 * off-screen, and let it go a tick later -- setDragImage only needs it
 * alive at capture time. Cursor sits at the ghost's center. */
export function liftDragImage(e: { dataTransfer: DataTransfer }, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const wrap = document.createElement("div");
  wrap.className = "drag-ghost-wrap";
  Object.assign(wrap.style, {
    position: "fixed",
    top: "-10000px",
    left: "0",
    width: `${r.width / 2}px`,
    height: `${r.height / 2}px`,
    overflow: "visible",
    pointerEvents: "none",
  } as Partial<CSSStyleDeclaration>);
  const clone = el.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, {
    width: `${r.width}px`,
    height: `${r.height}px`,
    margin: "0",
    transform: "scale(0.5)", // replaces any tilt -- the ghost flies straight
    transformOrigin: "top left",
    opacity: "1", // never inherit a mid-lift source's fade
  } as Partial<CSSStyleDeclaration>);
  wrap.appendChild(clone);
  /* Inside .app, NOT on body: the clone is a real card and only renders as
   * one within the app's cascade -- the inherited font family, the .app-
   * scoped CSS variables, the data-attribute looks (pins, shadows). Parked
   * on body it fell back to the browser's default font, which is exactly
   * how the ghost's type stopped matching the card it was a picture of. */
  (el.closest(".app") ?? document.body).appendChild(wrap);
  e.dataTransfer.setDragImage(wrap, r.width / 4, r.height / 4);
  window.setTimeout(() => wrap.remove(), 0);
}

/* Whether a drag is in progress -- drives the grabbing cursor. */
/* Option pressed or released MID-DRAG, so the marker flips the moment
 * you decide rather than on the next dragover. Registered once at module
 * load and a no-op while nothing is in flight -- the same shape as
 * legendHighlight's Escape listener. `altKey` on the key event covers
 * both the press and the release (on release the flag is already false). */
if (typeof window !== "undefined") {
  const track = (e: KeyboardEvent) => {
    if (current) dragStore.setDup(e.altKey);
  };
  window.addEventListener("keydown", track);
  window.addEventListener("keyup", track);
}

export function useIsDragging(): boolean {
  return useSyncExternalStore(
    dragStore.subscribe,
    () => current !== null,
    () => false,
  );
}

/* Props for an element that accepts drops at tier `depth`. `over` gives
 * a local highlight. Reads the live drag at event time so it stays
 * correct without subscribing to the store.
 *
 * With `split` set, the zone also reports which half the cursor is over
 * (`side`: "before" | "after") along that axis -- "x" for a horizontal row
 * of cards (left/right), "y" for a vertical stack (top/bottom) -- used to
 * drop before/after a hovered card and show an insertion marker on that edge.
 *
 * `copy` says this drop would clone rather than relocate (the drag came
 * from another board) -- it drives the cursor and the marker's styling.
 *
 * `tagTarget` (a node id) also makes the zone accept a TAG dragged out of
 * the legend, applying it to that node (ADR 0002). It rides along here so
 * every card that can already receive a drop can receive a tag, at any
 * tier -- tags aren't tier-bound the way nodes are. */
export function useDropZone(
  /* One tier, or several. With several, `onDrop` is told which one matched
   * so a container can distinguish "reorder me" from "take this inside". */
  depth: number | number[],
  onDrop: (item: DragItem, side: "before" | "after", depth: number) => void,
  split?: "x" | "y",
  tagTarget?: string,
) {
  const depths = asDepths(depth);
  const { boardId } = useBoardUI(); // the board this zone belongs to
  const [over, setOver] = useState(false);
  const [copy, setCopy] = useState(false);
  const [tagOver, setTagOver] = useState(false);
  const [side, setSide] = useState<"before" | "after">("before");
  // a legend chip (tag or color) in flight, over a card that takes them
  const legendOver = () => Boolean(tagTarget) && legendDrag.get() !== null;
  /* A drop CLONES when it lands in a different board (the split view's
   * master-to-section workflow) -- or when Option is held, which is the
   * same thing asked for deliberately. */
  const isCopy = (item: DragItem) =>
    dragStore.dup() || (Boolean(boardId) && Boolean(item.boardId) && item.boardId !== boardId);
  const sideFor = (e: DragEvent): "before" | "after" => {
    const r = e.currentTarget.getBoundingClientRect();
    return split === "y"
      ? e.clientY < r.top + r.height / 2
        ? "before"
        : "after"
      : e.clientX < r.left + r.width / 2
        ? "before"
        : "after";
  };

  // Clear the highlight whenever any drag ends -- covers the case where the
  // drag finishes over a different zone (or off-board) and this zone never
  // got its own dragleave/drop, which would otherwise leave it stuck on.
  useEffect(
    () =>
      dragStore.subscribe(() => {
        if (!dragStore.get()) setOver(false);
      }),
    [],
  );
  useEffect(
    () =>
      legendDrag.subscribe(() => {
        if (!legendDrag.get()) setTagOver(false);
      }),
    [],
  );

  return {
    over,
    side,
    copy,
    tagOver,
    props: {
      onDragOver: (e: DragEvent) => {
        if (legendOver()) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!tagOver) setTagOver(true);
          return;
        }
        const item = dragStore.get();
        if (!item || zoneMatch(item, boardId ?? "", depths) === null) return;
        e.preventDefault();
        dragStore.setDup(e.altKey); // Option = duplicate; tracked live
        const c = isCopy(item);
        e.dataTransfer.dropEffect = c ? "copy" : "move";
        if (split) {
          const s = sideFor(e);
          setSide((prev) => (prev === s ? prev : s));
        }
        if (copy !== c) setCopy(c);
        if (!over) setOver(true);
      },
      onDragEnter: (e: DragEvent) => {
        if (legendOver()) {
          e.preventDefault();
          setTagOver(true);
          return;
        }
        const item = dragStore.get();
        if (!item || zoneMatch(item, boardId ?? "", depths) === null) return;
        e.preventDefault();
        setCopy(isCopy(item));
        setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        setOver(false);
        setTagOver(false);
      },
      onDrop: (e: DragEvent) => {
        if (tagTarget && legendDrag.get()) {
          e.preventDefault();
          e.stopPropagation();
          setTagOver(false);
          /* The apply rule lives in ONE place now (legendDrag.dropChip):
           * selection-wide when the target is part of one, extracted
           * when the Free Grid turned out to have no chip target at all
           * and a second copy was the drift waiting to happen. */
          dropChip(tagTarget);
          return;
        }
        const item = dragStore.get();
        const matched = item ? zoneMatch(item, boardId ?? "", depths) : null;
        if (!item || matched === null) return;
        // the release is the last word on the modifier -- dragover may have
        // been a moment ago, and Option can be pressed or let go in between
        dragStore.setDup(e.altKey);
        /* If a slot is showing, the CONTAINER owns the drop
         * (board/dropCatcher.ts) -- let this bubble rather than acting on
         * a second, private reading of the cursor. Two handlers doing the
         * same arithmetic is how "the preview said one thing and it
         * landed somewhere else" happens; there is one answer now and
         * this isn't where it lives. */
        const published = dropTarget.get();
        if (published && published.boardId === (boardId ?? "")) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onDrop(item, split ? sideFor(e) : "before", matched);
        // A drop reparents the dragged node, which can unmount the source
        // before its dragEnd fires -- clear the store here so no zone stays lit.
        dragStore.end();
      },
    },
  };
}
