import { useEffect, useRef } from "react";
import { MAX_GAMMA, MIN_GAMMA } from "../state/types";
import { ops } from "../state/useBoard";

/* ------------------------------------------------------------------ *
 *  THE GAMMA BAR -- the image gamma knob, behind a key instead of in a
 *  menu (owner, 2026-09-09: "i kind of want it hidden for now. can we
 *  make it a hotkey with like command+g? and take it out of the menu").
 *
 *  IT IS A SLIDER, NOT A CYCLE. The value is continuous and the point of
 *  it is taste -- a key that steps through three stops would be a
 *  different, worse control. So the key OPENS the knob and the knob is
 *  the same one that was in the menu; hidden means unlisted, not
 *  reduced.
 *
 *  THE SLIDER TAKES THE FOCUS on open, so the arrow keys drive it the
 *  instant it appears and the gesture is Cmd+G, arrows, Escape without
 *  the mouse ever moving. Escape closes; so does a click anywhere else.
 *
 *  IT CHANGES THE BOARD, FOR EVERYONE (owner, 2026-09-10: "I want it per
 *  board not per user"). So the bar names the board it is about to
 *  change, and with two panes open it takes the one the keyboard is
 *  driving -- a shared edit must never land on whichever board the app
 *  happened to pick.
 * ------------------------------------------------------------------ */

export function GammaBar({
  boardId,
  gamma,
  name,
  onClose,
}: {
  /* WHICH BOARD. The curve is the board's now and shared, so with two
   * panes open the key adjusts the one the KEYBOARD is driving, and the
   * bar names it -- otherwise a shared change would land on whichever
   * board the app felt like. */
  boardId: string;
  gamma: number;
  name: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    /* A click ANYWHERE else takes it down. A frame late, or the very
     * keystroke that opened it would be caught closing it. */
    const t = window.setTimeout(() => document.addEventListener("mousedown", onClose), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onClose);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="gamma-bar" onMouseDown={(e) => e.stopPropagation()} role="group" aria-label="Image gamma">
      <span className="gamma-bar-label mono">IMAGE GAMMA</span>
      {/* the board it will change, since it changes it for everyone */}
      <span className="gamma-bar-board">{name || "this board"}</span>
      <input
        ref={ref}
        type="range"
        min={MIN_GAMMA}
        max={MAX_GAMMA}
        step={0.05}
        value={gamma}
        aria-label="Image gamma"
        onChange={(e) => ops.setBoardGamma(boardId, Number(e.target.value))}
      />
      <span className="mono gamma-bar-val">{gamma === 1 ? "off" : gamma.toFixed(2)}</span>
      {/* RESET IS A BUTTON, not a double-click on the slider: nothing on
          screen would have told you the gesture existed, and this bar has
          no menu row to hide behind. */}
      <button
        className="pane-btn"
        disabled={gamma === 1}
        onClick={() => ops.setBoardGamma(boardId, 1)}
      >
        Reset
      </button>
      <span className="gamma-bar-hint">esc</span>
    </div>
  );
}
