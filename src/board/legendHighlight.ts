import { useSyncExternalStore } from "react";
import { paneFocus, type PaneSlot } from "./paneFocus";

/* ------------------------------------------------------------------ *
 *  Hovering something in the legend lights every card it applies to and
 *  dims the rest, in BOTH views. Tags first (ADR 0002), colors too now:
 *  the owner wants the legend to BE the board's filter, rather than a
 *  separate filter UI bolted on beside it.
 *
 *  Done in CSS, not React: the Overview isn't virtualized, so a board can
 *  have thousands of cards mounted at once and a render pass per hover
 *  would stutter. Every card already carries what's needed --
 *  `data-tags="id1 id2"` (a list, matched with ~=) and `data-color="<id>"`
 *  (the RESOLVED legend entry that paints it, so hovering a tier-default
 *  swatch lights every card using that default). The injected rules name
 *  the hovered id and dim everything that doesn't match; hover rewrites
 *  them and the browser does the matching.
 *
 *  PER PANE as of 2026-08-03 (owner-reported). It used to be one global
 *  latch on `.app`, which meant hovering a tag in one split panel dimmed
 *  the OTHER panel too -- a different board, with different tags, filtered
 *  by an id it may not even have. Each panel now holds its own hover and
 *  its own latch, including when both show the same board: a filter is
 *  something you're doing to a view, not to the document.
 *
 *  Panes are the scope because they already are one -- `.pane[data-slot]`,
 *  the same element the per-board looks hang off (board/lookScope.tsx).
 *  The mechanism is unchanged and still costs no React pass: it is just
 *  two rule sets in one stylesheet instead of one.
 *
 *  Still exactly one live highlight PER PANE. Two latched swatches in one
 *  panel would have to mean AND or OR, and this is one :not() rule --
 *  combining is a different mechanism, not a bigger version of this one.
 *
 *  LATCHING. Hover alone made this a filter you couldn't hold: let go and
 *  it's gone, so you can't keep one lit while you scroll the board looking
 *  for what it hit. Clicking a swatch PINS it; clicking the same one again,
 *  or Escape, releases. Hover still previews on top of a latch and falls
 *  back to it on mouse-out, so pointing at a second swatch to compare
 *  doesn't lose the one you were holding.
 * ------------------------------------------------------------------ */

const CARDS = [
  ".beat",
  ".scene-label",
  ".lane-card",
  ".reel-head",
  ".section-head",
  ".ov-mini",
  ".ov-cell",
  ".ov-band",
];

const SLOTS: PaneSlot[] = ["a", "b"];

/* `key` identifies the selection (so re-entering the same swatch is a
 * no-op); `miss` is the :not(...) that picks the cards to dim. */
interface Sel {
  key: string;
  miss: string;
  /* the opacity the misses drop to; the legend's is 0.22 */
  dim?: number;
}

interface PaneState {
  hovered: Sel | null;
  latched: Sel | null;
  /* THE NOTES COLUMN'S SPOTLIGHT (owner, 2026-09-08): hovering a note
   * row, or standing on one with the arrows, dims every card but the
   * note's -- "like we do with tags, but like half the opacity
   * reduction". Under the legend's own hover, over the latch. */
  noteFocus: Sel | null;
  /* Un-latching leaves the pointer sitting on the swatch you just clicked,
   * so the hover would light it straight back up and the click would read
   * as having done nothing. Suppress hover until the pointer leaves. */
  suppressHover: boolean;
  painted: string | null; // what this pane's rules currently say
}

const blank = (): PaneState => ({ hovered: null, latched: null, noteFocus: null, suppressHover: false, painted: null });
const panes: Record<PaneSlot, PaneState> = { a: blank(), b: blank() };

let styleEl: HTMLStyleElement | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function sheet(): HTMLStyleElement {
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.dataset.corko = "legend-highlight";
    document.head.appendChild(styleEl);
  }
  return styleEl;
}

const scope = (slot: PaneSlot) => `.pane[data-slot="${slot}"][data-legend-hover]`;

/* Rebuild the whole stylesheet from every pane's resolved selection, and
 * mark each pane element. One sheet with up to two rule sets: the panels
 * can hold different filters, or the same one, or one and none. */
function paint(): void {
  const blocks: string[] = [];
  let changed = false;
  for (const slot of SLOTS) {
    const st = panes[slot];
    const sel = st.hovered ?? st.noteFocus ?? st.latched; // hover wins; the latch is underneath
    const key = sel?.key ?? null;
    if (key !== st.painted) changed = true;
    st.painted = key;

    const el = document.querySelector(`.pane[data-slot="${slot}"]`);
    if (key && sel) {
      // !important: cards carry an INLINE opacity (the search dim), which a
      // stylesheet rule would otherwise lose to. Cards that do match are
      // left alone rather than forced to 1, so a search dim shows through.
      blocks.push(
        `${CARDS.map((c) => `${scope(slot)} ${c}${sel.miss}`).join(",\n")} { opacity: ${sel.dim ?? 0.22} !important; }`,
      );
      el?.setAttribute("data-legend-hover", key);
    } else {
      el?.removeAttribute("data-legend-hover");
    }
  }
  if (changed) sheet().textContent = blocks.join("\n");
}

/* CSS.escape on both: ids are generated, but a hand-edited file could
 * carry anything, and these strings go straight into a selector. */

function tagSel(id: string): Sel {
  return { key: "tag:" + id, miss: `:not([data-tags~="${CSS.escape(id)}"])` };
}

/* colors.ts's resolveNodeColorId is what stamps `data-color`, so a
 * tier-default entry spotlights every card merely INHERITING it, not just
 * the ones that name it. */
function colorSel(id: string): Sel {
  return { key: "color:" + id, miss: `:not([data-color="${CSS.escape(id)}"])` };
}

function hover(slot: PaneSlot, sel: Sel | null): void {
  const st = panes[slot];
  if (sel && st.suppressHover) return;
  if (!sel) st.suppressHover = false; // the pointer left; hover works again
  st.hovered = sel;
  paint();
}

/* Pass a tag id to spotlight the cards carrying it, or null to clear. */
export function highlightTag(slot: PaneSlot, id: string | null): void {
  hover(slot, id ? tagSel(id) : null);
}

/* Pass a legend ENTRY id to spotlight the cards that entry paints -- by an
 * explicit per-card color, or as their tier's default. */
export function highlightColor(slot: PaneSlot, id: string | null): void {
  hover(slot, id ? colorSel(id) : null);
}

/* The notes column's spotlight on ONE card: its note is under the
 * pointer, or under the cursor while the column drives the arrows. Half
 * the legend's dimming -- the legend's misses drop to 0.22 (a 0.78
 * reduction), so these drop to 0.61. Pass null to clear. */
export function focusNote(slot: PaneSlot, nodeId: string | null): void {
  const st = panes[slot];
  st.noteFocus = nodeId ? { key: "note:" + nodeId, miss: `:not([data-node="${CSS.escape(nodeId)}"])`, dim: 0.61 } : null;
  paint();
}

/* Drop the hover and STAY dropped until the pointer actually leaves
 * something (any `highlight*(null)`, i.e. a real mouseleave).
 *
 * For opening a settings panel from a legend chip. Adding a tag or a color
 * grows the row, which slides the Add button out from under a stationary
 * cursor and puts the just-created chip there instead -- and Chrome fires
 * mouseenter on an element that moves under the pointer, not just on
 * pointer movement. So a brand-new tag, which no card carries yet, dims the
 * entire board the instant you add it, which reads as a fault. Clearing on
 * the click alone doesn't hold: the re-render's mouseenter lands after it.
 *
 * Only the hover. A latch is a filter you're holding on purpose and may
 * well be opening the panel to inspect. */
export function stopHover(slot: PaneSlot): void {
  const st = panes[slot];
  st.hovered = null;
  st.suppressHover = true;
  paint();
}

/* ---- the latch -------------------------------------------------------- */

function toggle(slot: PaneSlot, sel: Sel): void {
  const st = panes[slot];
  if (st.latched?.key === sel.key) {
    st.latched = null;
    st.hovered = null;
    st.suppressHover = true;
  } else {
    st.latched = sel;
  }
  paint();
  emit();
}

export function latchTag(slot: PaneSlot, id: string): void {
  toggle(slot, tagSel(id));
}

export function latchColor(slot: PaneSlot, id: string): void {
  toggle(slot, colorSel(id));
}

/* Used by the legend's own unmount cleanups: a latch names an entry on a
 * particular board, so closing a pane or switching boards must drop it
 * rather than leave the next board dimmed by an id it doesn't have. Per
 * pane now, which also retires the old accepted wart -- closing one split
 * panel used to release the latch the OTHER panel was holding, because
 * there was only ever one. */
export function releaseLatch(slot: PaneSlot): void {
  const st = panes[slot];
  if (!st.latched) return;
  st.latched = null;
  st.hovered = null;
  st.suppressHover = false;
  paint();
  emit();
}

export function hasAnyLatch(): boolean {
  return SLOTS.some((s) => panes[s].latched !== null);
}

/* The latched key ("tag:<id>" / "color:<id>") for ONE pane, for the chip
 * that should show itself as held. Only the LEGEND subscribes -- the board
 * is still painted by the injected rules above, so latching never costs a
 * render pass over the cards, which is the whole reason this module
 * exists. */
export function useLatchedKey(slot: PaneSlot): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => panes[slot].latched?.key ?? null,
    () => null,
  );
}

/* Escape releases from anywhere, which is what makes the latch safe to
 * click: you never have to find the swatch again to get your board back.
 * Registered once, at module load -- a no-op while nothing is latched.
 *
 * With two panels it releases the FOCUSED one's latch, and only falls
 * back to releasing every latch when the focused panel isn't holding one
 * -- so Escape always does something visible, without nuking a filter you
 * deliberately left holding in the panel you aren't working in. Each
 * legend also has its own Release button, which is the precise way.
 *
 * A float panel's Escape wins while one is open, the same two-stage
 * Escape FloatPanel already does for a focused text field: one keypress
 * shouldn't both close the panel you're reading and drop the highlight you
 * opened it to inspect. */
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !hasAnyLatch()) return;
    if (document.querySelector(".float-panel")) return;
    const focused = paneFocus.get();
    if (panes[focused].latched) releaseLatch(focused);
    else for (const s of SLOTS) releaseLatch(s);
  });
}
