import type { BoardBg, Settings } from "./settings";
import type { BoardLook } from "./types";

/* ------------------------------------------------------------------ *
 *  WHICH BACKDROP A PANE PAINTS (owner, 2026-09-05).
 *
 *  Three sources, one answer: the BOARD's shared look (Board.look, so a
 *  board reads the same to everyone and can be told from the next at a
 *  glance), YOUR OVERRIDE (settings, per board per browser -- what
 *  every board showed before boards had their own), and the switch that
 *  turns the override on (settings.overrideBackdrop, the Overrides door
 *  by the steering wheel). Pure, so the rule is pinned.
 *
 *   - override ON  -> yours
 *   - override OFF -> the board's, always
 *
 *  AND THAT IS THE WHOLE RULE (owner, 2026-09-10: "please make the
 *  toggle just do what it says it actually does, which is to only apply
 *  changes as a UI change and only when on and not mess with the board's
 *  shared settings"). It used to have a third case -- a board with no
 *  stored `look` fell back to YOURS -- and that was the bug he was
 *  chasing: on such a board your override showed whether the switch was
 *  on or off, so the switch read as broken.
 *
 *  A BOARD ALWAYS HAS A BACKDROP, which is the reality the old rule
 *  missed. His words: "there are choices made on a new board
 *  deliberately by me in choosing defaults. defaults are still
 *  settings." The Options menu's shared group shows a backdrop on every
 *  board whether or not one was ever written, so an absent `look` is not
 *  an undressed board -- it is a board wearing the default. It reads as
 *  that default here now, never as yours.
 * ------------------------------------------------------------------ */

export interface Backdrop {
  bg: BoardBg;
  custom: string;
  grain: boolean;
  /* whether what shows is the board's own (the Options menu edits that;
   * the Overrides menu edits yours) */
  shared: boolean;
}

/* What a board wears when nobody has written a look on it: the app's own
 * default, and the same value the Options menu's shared group shows for
 * such a board -- so what you see and what that control says agree. */
export const DEFAULT_BOARD_LOOK: BoardLook = { bg: "cork" };

export function resolveBackdrop(
  s: Pick<Settings, "boardBg" | "customBg" | "customGrain" | "overrideBackdrop">,
  board: BoardLook | undefined,
): Backdrop {
  if (s.overrideBackdrop) {
    return { bg: s.boardBg, custom: s.customBg, grain: s.customGrain, shared: false };
  }
  const look = board ?? DEFAULT_BOARD_LOOK;
  return {
    bg: look.bg,
    /* a board set to "custom" with no color of its own borrows yours, so
     * the swatch is never blank -- unchanged */
    custom: look.custom ?? s.customBg,
    grain: look.grain ?? false,
    shared: true,
  };
}
