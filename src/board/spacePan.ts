import { playerDrive } from "./cardPanels";
import { useEffect } from "react";

/* ------------------------------------------------------------------ *
 *  HOLD SPACE AND DRAG TO PAN, on every surface that scrolls.
 *
 *  The idiom every canvas tool shares (Figma, Illustrator, Photoshop,
 *  Miro), and the one gesture that works the same whatever the board
 *  type is -- which is why this is ONE document-level listener rather
 *  than something each view wires up. It finds the scroller under the
 *  pointer and moves it; the Beat Map's virtualized list, the Overview's
 *  viewport, a Columns board and a Free Grid all just work, and the next
 *  board type inherits it with nothing to remember.
 *
 *  SPACE WAS ALREADY TAKEN -- it opens the card menu on the keyboard
 *  cursor (keyNav.ts). The two coexist as TAP vs HOLD: pressing Space
 *  arms panning, and releasing it without having dragged is what fires
 *  the menu. That moves the menu from keydown to keyup, which for a tap
 *  is imperceptible, and it is the same split every tool with a
 *  space-pan uses.
 *
 *  "WHEN THERE'S SLACK" is literal: the walk up from the pointer looks
 *  for an ancestor that actually OVERFLOWS on some axis. A board that
 *  fits its pane has nothing to pan, so nothing arms, the cursor does
 *  not change, and the press falls through to whatever it would normally
 *  do.
 * ------------------------------------------------------------------ */

let armed = false;
let panned = false;
let target: HTMLElement | null = null;
let last = { x: 0, y: 0 };

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/* The nearest ancestor that scrolls AND has somewhere to go. Both halves
 * matter: an element can be `overflow: auto` with nothing overflowing,
 * which is the "no slack" case the owner asked about. */
function scrollerAt(x: number, y: number): HTMLElement | null {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    const scrolls = /(auto|scroll|overlay)/.test(cs.overflowY + " " + cs.overflowX);
    const slackY = el.scrollHeight - el.clientHeight > 1;
    const slackX = el.scrollWidth - el.clientWidth > 1;
    if (scrolls && (slackY || slackX)) return el;
    el = el.parentElement;
  }
  return null;
}

/* Typing must keep its space bar, without exception. */
const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

function setArmed(on: boolean) {
  if (armed === on) return;
  armed = on;
  /* One root attribute for the cursor, rather than a class per surface:
   * the CSS then names the two states in one place and nothing
   * re-renders on a key press. */
  const app = document.querySelector(".app");
  if (on) app?.setAttribute("data-space-pan", "on");
  else {
    app?.removeAttribute("data-space-pan");
    app?.removeAttribute("data-space-panning");
  }
  emit();
}

export const spacePan = {
  /* Whether the CURRENT hold has actually moved anything -- keyNav asks
   * on keyup, so a tap can still open the card menu and a drag cannot. */
  panned: () => panned,
  armed: () => armed,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useSpacePan() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      if (isTyping(e.target)) return;
      if (playerDrive.get()) return; // the player's play / pause (cardPanels.ts)
      /* Not while a menu or panel owns the keyboard -- Space there
       * belongs to whatever is focused inside it. */
      if (document.querySelector(".ctx-menu, .float-panel:not(.keys-panel), .confirm-backdrop")) return;
      /* EVERY keydown, REPEATS INCLUDED, and that is the whole point of
       * doing it before the repeat check below.
       *
       * Holding a key does not fire one keydown -- after about half a
       * second the OS starts sending repeats, and Space's default action
       * on a scrollable element is PAGE DOWN. Returning early on
       * `e.repeat` left every one of those unprevented, so a hold panned
       * correctly for a moment and then the browser paged the scroller
       * to the bottom underneath it (owner-reported). */
      e.preventDefault();
      /* Only the FIRST arms and resets the drag flag: a repeat mid-pan
       * must not clear `panned`, or releasing would open the card menu
       * on top of the pan you just did. */
      if (e.repeat) return;
      panned = false;
      setArmed(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      setArmed(false);
      target = null;
    };
    /* If the window loses focus mid-hold the keyup never arrives, so the
     * cursor would stick as a grab hand forever. */
    const onBlur = () => {
      setArmed(false);
      target = null;
    };

    const onDown = (e: PointerEvent) => {
      if (!armed || e.button !== 0) return;
      const el = scrollerAt(e.clientX, e.clientY);
      if (!el) return; // no slack here: leave the press alone
      target = el;
      last = { x: e.clientX, y: e.clientY };
      /* CAPTURE + stopPropagation, or a card underneath would start its
       * own drag: the grid's move gesture and the Beat Map's HTML5 drag
       * both begin on the press. */
      e.stopPropagation();
      e.preventDefault();
      document.querySelector(".app")?.setAttribute("data-space-panning", "on");
    };
    const onMove = (e: PointerEvent) => {
      if (!target) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      if (dx || dy) panned = true;
      /* The content follows the pointer, so the SCROLL goes the other
       * way -- grabbing the board and moving it, not moving a viewport
       * over it. */
      target.scrollLeft -= dx;
      target.scrollTop -= dy;
      last = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    };
    const onUp = () => {
      target = null;
      document.querySelector(".app")?.removeAttribute("data-space-panning");
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setArmed(false);
    };
  }, []);
}
