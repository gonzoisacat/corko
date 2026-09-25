import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { usePaneFocus, type PaneSlot } from "./paneFocus";
import type { DriverMode } from "../state/panes";

/* ------------------------------------------------------------------ *
 *  DRIVING -- one panel STEERING another.
 *
 *  The wheel marks the SOURCE OF CONTROL: "this is the panel you are
 *  driving from". That reading is what lets one idiom cover every scope
 *  it will grow into -- this panel, its sibling, and eventually another
 *  person's screen -- because in all three the question is the same:
 *  where does this panel's steering go?
 *
 *  DRIVING MEANS CONTROL OF SOMETHING ELSE, and only that. It is
 *  deliberately NOT "which panel has the keyboard": a lone panel takes
 *  every keystroke and drives nothing, so it reads grey. The wheel
 *  lights in exactly one situation -- local driving is ACTIVE and this
 *  is the panel doing the steering.
 *
 *  ACTIVE NEEDS THE SAME BOARD IN BOTH PANELS (owner, 2026-08-08).
 *  Steering means "take the other panel to this card", which is
 *  meaningless when the other panel is showing a different board --
 *  App.steerSibling has always refused that case, so before this the
 *  wheel could sit lit and confident while nothing it promised could
 *  happen. Two different boards now read INACTIVE, like a lone panel.
 *
 *  The menu is two groups on purpose. LOCAL is panel-to-panel and is
 *  built; REMOTE is driving a collaborator's view, which needs accounts
 *  (Phase 7) and is shown as an inert placeholder at the owner's ask, so
 *  the shape of the idea is visible before the wiring exists.
 * ------------------------------------------------------------------ */

/* lucide has no steering wheel, so it is composed the way the project
 * composes its others (CornerDownLeftOff, the Boards sort arrows): the
 * house geometry -- 24 box, currentColor, width 2, round caps.
 *
 * Rim, hub and three spokes, and the spoke count is the legibility
 * choice: at 15px the stroke lands near 1.25px, so a four-spoke wheel
 * closes into a blob. */
export function WheelIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M9.4 12H2" />
      <path d="M22 12h-7.4" />
      <path d="M12 14.6V22" />
    </svg>
  );
}

/* POINT AT THE CONTROL THAT WOULD FIX IT (owner, 2026-08-08). Hovering
 * the bolded words in the inactive note outlines the thing you'd have to
 * touch -- the Project View picker when there is only one panel, both
 * board switchers when the two panels are on different boards.
 *
 * One attribute on `.app` and two static rules, rather than the injected
 * stylesheet legendHighlight needs: the targets here are known selectors
 * rather than a node id, so nothing has to be generated. Same principle
 * though -- no React pass, no props threaded to the topbar. */
type DriveHint = "view" | "boards";
function setDriveHint(hint: DriveHint | null) {
  const app = document.querySelector(".app");
  if (!app) return;
  if (hint) app.setAttribute("data-drive-hint", hint);
  else app.removeAttribute("data-drive-hint");
}

export interface DrivingInfo {
  twoUp: boolean; // the split view is open
  sameBoard: boolean; // ...and both panels show the SAME board
  on: boolean; // the LOCAL toggle
  driver: DriverMode;
  setOn?: (v: boolean) => void;
  setDriver?: (m: DriverMode) => void;
}

/* Which panel steers, given the mode and the panel ACTING. The ONE
 * statement of the rule, shared by its two callers so the panel that
 * LOOKS like the driver and the panel the steering OBEYS cannot drift
 * apart: the wheel passes the focused slot (its light is about where
 * your input would steer), App.steerSibling passes the panel that
 * PRODUCED the gesture -- the panel acting is the active one by
 * definition, so the pinned modes need no focus lookup and cannot lag
 * a mousedown by a React tick. */
export function driverSlot(d: DrivingInfo, acting: PaneSlot): PaneSlot | null {
  if (!d.twoUp || !d.sameBoard || !d.on) return null;
  return d.driver === "active" ? acting : d.driver;
}

export function DrivingWheel({ slot, driving }: { slot: PaneSlot; driving: DrivingInfo }) {
  const focused = usePaneFocus();
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

  /* Never leave a control outlined behind a menu that has closed -- the
   * pointer can leave via the menu vanishing, which fires no mouseleave. */
  useEffect(() => {
    if (!open) setDriveHint(null);
    return () => setDriveHint(null);
  }, [open]);

  /* LOCAL can only be offered when there are two panels on one board.
   * Anything else -- a lone panel, or two different boards -- is the
   * same inactive state, because in neither can this panel steer. */
  const canDriveLocally = driving.twoUp && driving.sameBoard;
  const isDriver = driverSlot(driving, focused) === slot;

  /* Just the name (owner, 2026-08-09: tips are names, not essays) --
   * the menu itself explains every state the tip used to narrate. */
  const tip = "Drive modes";

  const modes: { key: DriverMode; name: string }[] = [
    { key: "active", name: "Active panel always drives" },
    { key: "a", name: "Left panel always drives" },
    { key: "b", name: "Right panel always drives" },
  ];

  return (
    <div className="driving" ref={ref}>
      {/* tip-left: the wheel sits at the pane's right edge -- in a split
          view that is the WINDOW's right edge, where a centered tip loses
          a third of its sentence to `.app`'s overflow-x clip. Same
          reason the menu below hangs left. */}
      <button
        className={
          "driving-wheel tip-left" + (isDriver ? " is-driving" : " is-idle") + (open ? " open" : "")
        }
        data-tip={tip}
        aria-label="Drive modes"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <WheelIcon />
      </button>
      {open && (
        <div className="fold-menu-pop driving-menu">
          <div className="options-title mono">Drive Modes</div>

          <div className="driving-group mono">Local</div>
          {!canDriveLocally ? (
            <>
              <div className="driving-status">Inactive</div>
              {/* ONE sentence for both cases (owner's call). What differs
                  is which half is bold -- and the bold half is the thing
                  you have to change, so hovering it outlines the control
                  that would change it. Two panels on different boards
                  need the SAME BOARD; a lone panel needs SPLIT VIEW. */}
              <div className="driving-note">
                Open the{" "}
                {driving.twoUp ? (
                  <span
                    className="driving-hint"
                    onMouseEnter={() => setDriveHint("boards")}
                    onMouseLeave={() => setDriveHint(null)}
                  >
                    same board
                  </span>
                ) : (
                  "same board"
                )}{" "}
                in{" "}
                {driving.twoUp ? (
                  "Split view"
                ) : (
                  <span
                    className="driving-hint"
                    onMouseEnter={() => setDriveHint("view")}
                    onMouseLeave={() => setDriveHint(null)}
                  >
                    Split view
                  </span>
                )}{" "}
                for options.
              </div>
            </>
          ) : (
            <>
              {/* A SWITCH, not a checkmark, and deliberately not carrying
                  `.active` either. This row turns the group on and off;
                  the rows under it are a one-of-three choice. Giving both
                  a checkmark AND the same selected background is what made
                  them read as one flat list. */}
              <button
                className="fold-menu-item driving-toggle"
                role="switch"
                aria-checked={driving.on}
                onClick={() => driving.setOn?.(!driving.on)}
              >
                <span className={"driving-switch" + (driving.on ? " on" : "")} />
                <span>{driving.on ? "Active" : "Inactive"}</span>
              </button>
              {/* One at a time, and dimmed while local driving is off --
                  they are what the toggle above switches on. */}
              {modes.map((m) => (
                <button
                  key={m.key}
                  className={
                    "fold-menu-item driving-seat" +
                    (driving.driver === m.key ? " active" : "") +
                    (driving.on ? "" : " is-off")
                  }
                  disabled={!driving.on}
                  onClick={() => driving.setDriver?.(m.key)}
                >
                  {driving.driver === m.key ? <Check size={12} /> : <span className="driving-tick" />}
                  <span>{m.name}</span>
                </button>
              ))}
            </>
          )}

          <div className="driving-group mono">Remote</div>
          <div className="driving-status">Inactive</div>
          <div className="driving-note">Placeholder</div>
        </div>
      )}
    </div>
  );
}
