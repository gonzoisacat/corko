import { useEffect, useRef, useState } from "react";
import { Paintbrush } from "lucide-react";
import { setSetting, useSettings } from "../state/settings";
import { BackdropControls } from "./BackdropControls";

/* ------------------------------------------------------------------ *
 *  OVERRIDES -- what YOU see instead of what the board says.
 *
 *  A board's backdrop is the board's (Board.look, shared, edited in the
 *  Options menu's shared group). This is the door for ignoring it: the
 *  button beside the steering wheel (owner, 2026-09-05: "a toggle that
 *  lives next to the steering wheel. and it opens a submenu with all
 *  the styling overrides"), lit while an override is on, opening a
 *  menu in the Drive Modes idiom -- a group per thing the board owns
 *  that you can override, a switch, and the rows the switch turns on.
 *  "Overrides" is the app's word for exactly this everywhere else: a
 *  card's Text overrides over its tier, the legend's Color Overrides
 *  over the ladder.
 *
 *  Today the board owns one overridable thing, so the menu has one
 *  group. The switch is GLOBAL (settings.overrideBackdrop -- his
 *  "global override sounds elegant"): on, every board shows yours,
 *  where "yours" is your per-board preference over your defaults, as
 *  every board showed before boards had their own. The rows stay
 *  visible while it is off, dimmed and inert, so the switch has
 *  something visible to switch on (the driving menu's rule).
 * ------------------------------------------------------------------ */

export function OverridesMenu({ boardId }: { boardId: string }) {
  const s = useSettings(boardId);
  const on = s.overrideBackdrop;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="overrides" ref={ref}>
      {/* tip-left, like the wheel beside it: this is the pane's right
          edge, where a centered tip clips */}
      <button
        className={"overrides-btn tip-left" + (on ? " on" : "") + (open ? " open" : "")}
        data-tip="Overrides"
        aria-label="Your overrides"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Paintbrush size={14} />
      </button>
      {open && (
        <div className="fold-menu-pop overrides-menu">
          {/* His shape (2026-09-06): the title with the switch on the
              same row at the top right, the helper under it saying which
              of the two you are looking at, a rule, then the rows --
              no group header, since there is one group. */}
          <div className="overrides-head">
            <span className="options-title mono">Board Style Overrides</span>
            <button
              className="overrides-switch"
              role="switch"
              aria-checked={on}
              aria-label={on ? "Overrides on" : "Overrides off"}
              data-tip={on ? "Overrides on" : "Overrides off"}
              onClick={() => setSetting("", "overrideBackdrop", !on)}
            >
              <span className={"driving-switch" + (on ? " on" : "")} />
            </button>
          </div>
          <div className="driving-note">
            {on
              ? "You are now viewing the board with custom style overrides"
              : "You are now viewing the board's default style"}
          </div>
          <div className="fold-menu-sep" />
          <div className={"overrides-rows" + (on ? "" : " is-off")}>
            <BackdropControls
              value={{ bg: s.boardBg, custom: s.customBg, grain: s.customGrain }}
              disabled={!on}
              onBg={(bg) => setSetting(boardId, "boardBg", bg)}
              onCustom={(c) => {
                setSetting(boardId, "customBg", c);
                setSetting(boardId, "boardBg", "custom");
              }}
              onGrain={(v) => setSetting(boardId, "customGrain", v)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
