import { useLayoutEffect, type RefObject } from "react";

/* ------------------------------------------------------------------ *
 *  WHAT A NARROW TOPBAR SHEDS, in order (owner, 2026-09-04), and WHEN.
 *
 *  The pane bar sheds by container query at measured thresholds. The
 *  topbar cannot: its width is spent on things whose size swings with
 *  the state -- the project name (up to 34vw), the presence chips (one
 *  per person here), the sync note ("offline, saved to this browser"
 *  is twice "synced"). A threshold measured against one state is wrong
 *  in the next. So the bar measures ITSELF: after any resize or any
 *  change to its contents it walks this ladder from the top, stamping
 *  each step on `data-shed` (a cumulative token list, so the CSS keys
 *  on `[data-shed~="pile"]`) until the bar no longer overflows. Six
 *  synchronous layouts at most, on a bar of a dozen elements.
 *
 *  The order is his: the free space goes first on its own (the grid's
 *  1fr tracks), then the peers' chips fold into the pile and take the
 *  count with them, then Usage (its ellipsis stands in), then the
 *  Project View label, then the sync note's words, then the Project
 *  Name label. The bar overflows past that; nothing else is spare.
 * ------------------------------------------------------------------ */

export const SHED_STEPS = ["pile", "usage", "view-label", "sync-text", "name-label"] as const;

/* the token list for a level: level 2 -> "pile usage" */
export const shedTokens = (level: number): string => SHED_STEPS.slice(0, level).join(" ");

/* walk the ladder on an element until it fits, and return the level */
export function fitShed(el: HTMLElement): number {
  let level = 0;
  for (;;) {
    el.dataset.shed = shedTokens(level);
    if (el.scrollWidth <= el.clientWidth || level === SHED_STEPS.length) return level;
    level++;
  }
}

export function useTopbarShed(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => fitShed(el);
    fit();
    // the window (and so the bar) changing width
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    // the bar's contents changing: a rename, a peer arriving, the sync
    // note's words. Attributes are NOT watched -- fit() writes one.
    const mo = new MutationObserver(fit);
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [ref]);
}
