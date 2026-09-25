import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, Plus, Settings } from "lucide-react";
import {
  applyLook,
  DEFAULT_SELECTION,
  LOOKS,
  hasTweaks,
  matchesLook,
  resetToDefaults,
  saveAsDefaults,
  setSetting,
  useSettings } from "../state/settings";
import { ops } from "../state/useBoard";
import { resolveBackdrop } from "../state/boardLook";
import { DEFAULT_CARD_SPACING, DEFAULT_MAX_ROW_BEATS } from "../state/types";
import type { Board } from "../state/types";
import { MAX_TIERS } from "../state/validate";
import { DraftInput } from "../ui/DraftInput";
import { TierSettings, Toggle } from "./TierSettings";
import { BackdropControls } from "./BackdropControls";
import { usePanelFlip } from "../ui/usePanelFlip";

/* Board look-and-feel options (spec Sec 7). A top-bar popover of local
 * view preferences plus the active board's structure settings. `board` is
 * the pane's active board (null pre-sync / first-run: the global sections
 * hide). Board FILE actions (new/load/export) live in the Boards menu. */
export function OptionsMenu({ board }: { board: Board | null }) {
  const [open, setOpen] = useState(false);
  const [gearTier, setGearTier] = useState<string | null>(null); // level id whose gear is open
  /* The look is this BOARD's now (state/settings.ts): your defaults
   * plus whatever you tweaked here. A pane with no board yet edits
   * the defaults directly, which is what an empty id means. */
  const bid = board?.id ?? "";
  const s = useSettings(bid);
  /* THE BOARD'S OWN BACKDROP, as the shared group's rows edit it --
   * the override forced off, because this menu edits what EVERYONE
   * sees and your own is not its business (that is the Overrides door
   * by the steering wheel). A board with nothing written shows the
   * app's default here, which is the same thing the board itself now
   * paints (state/boardLook.ts): the control and the board agree by
   * construction. They did not while an undressed board pre-filled
   * this with YOURS and painted yours too -- the arrangement that made
   * the override switch look broken (2026-09-10). */
  const own = resolveBackdrop({ ...s, overrideBackdrop: false }, board?.look);
  /* Read AFTER the subscription above, so the Reset button appears and
   * vanishes as you tweak: useSettings re-renders this component on every
   * settings write, which is what makes this plain call live. */
  const tweaked = hasTweaks(bid);
  const ref = useRef<HTMLDivElement>(null);
  const panel = usePanelFlip(open);

  /* A tier's gear folds away with the menu (owner's call): it's a
   * drill-down INTO this menu, not a thing you left open somewhere, and
   * re-opening Options to a wall of one tier's sliders reads as a bug.
   * Cleared on close rather than on open so the panel never paints the
   * old state for a frame. */
  useEffect(() => {
    if (!open) setGearTier(null);
  }, [open]);

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
    <div className="options" ref={ref}>
      {/* tip-left: the gear is the pane bar's rightmost control, so a
          centered tip clips at the window edge (the wheel's own trap) */}
      <button
        className={"pane-btn icon-only tip-left" + (open ? " active" : "")}
        aria-label="Board options" data-tip="Board options"
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal size={15} />
      </button>
      {open && (
        <div className={"options-panel" + (panel.flip ? " flip" : "")} ref={panel.ref}>
          {/* These are PER BOARD as of 2026-08-03 -- your defaults with
              this board's tweaks on top. The backdrop left this group on
              2026-09-05 (it is the board's now, in the shared group
              below); what remains is the card things. */}
          <div className="options-group mono">
            Individual user settings
            <span className="options-group-sub">only you see these, and only on this board</span>
          </div>
          {/* one-click look bundles; individual toggles below still dial */}
          <div className="options-row">
            <span>Look</span>
            <span className="look-choices">
              {LOOKS.map((l) => (
                <button
                  key={l.id}
                  className={"look-btn" + (matchesLook(s, l) ? " active" : "")}
                  onClick={() => applyLook(bid, l)}
                >
                  {l.label}
                </button>
              ))}
            </span>
          </div>
          <Toggle
            label="Rounded corners"
            checked={s.roundedCorners}
            onChange={(v) => setSetting(bid, "roundedCorners", v)}
          />
          <Toggle label="Card tilt" checked={s.cardTilt} onChange={(v) => setSetting(bid, "cardTilt", v)} />
          <Toggle label="Pushpins" checked={s.pushpins} onChange={(v) => setSetting(bid, "pushpins", v)} />
          {s.pushpins && (
            <div className="options-row">
              <span>Pushpin color</span>
              <span className="gear-color-cell">
                <button
                  className={"gear-auto" + (s.pushpinColor === "random" ? " active" : "")}
                  data-tip="A random color per pin"
                  onClick={() => setSetting(bid, "pushpinColor", "random")}
                >
                  random
                </button>
                <label
                  className={"gear-swatch" + (s.pushpinColor === "random" ? " swatch-random" : "")}
                  style={s.pushpinColor === "random" ? undefined : { background: s.pushpinColor }}
                >
                  <input
                    type="color"
                    value={s.pushpinColor === "random" ? "#cf332f" : s.pushpinColor}
                    aria-label="Pushpin color"
                    onChange={(e) => setSetting(bid, "pushpinColor", e.target.value)}
                  />
                </label>
              </span>
            </div>
          )}
          <Toggle
            label="Drop Shadows"
            checked={s.liftedShadow}
            onChange={(v) => setSetting(bid, "liftedShadow", v)}
          />
          {/* Dark CHROME, not a dark board. It dresses the menus, panels,
              legend and bars and leaves the backdrop alone -- a dark UI
              around a cork board is a reasonable thing to want, and the
              backdrop has its own control above.

              GLOBAL, unlike everything else in this group: it is about the
              app you are sitting in front of rather than about one cut, so
              it does not change when you switch boards. Hence no per-board
              tweak layer and nothing for Reset to drop. */}
          <div className="options-row">
            <span>
              Dark UI            </span>
            <button
              className={"switch" + (s.uiTheme === "dark" ? " on" : "")}
              role="switch"
              aria-checked={s.uiTheme === "dark"}
              aria-label="Dark UI"
              onClick={() => setSetting(bid, "uiTheme", s.uiTheme === "dark" ? "light" : "dark")}
            >
              <span className="switch-knob" />
            </button>
          </div>
          {/* the visual only -- aria-labels keep every control named */}
          <div className="options-row">
            <span>
              Tooltips            </span>
            <button
              className={"switch" + (s.tooltips ? " on" : "")}
              role="switch"
              aria-checked={s.tooltips}
              aria-label="Tooltips"
              onClick={() => setSetting(bid, "tooltips", !s.tooltips)}
            >
              <span className="switch-knob" />
            </button>
          </div>
          {/* The boot splash. Three states, so it needs the Look row's
              segmented buttons rather than a switch: "fun" is not "more
              on", it is a different take (a colorway per load). */}
          <div className="options-row">
            <span>
              Load animation            </span>
            <span className="look-choices">
              {(
                [
                  ["on", "On"],
                  ["off", "Off"],
                  ["fun", "Fun"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  className={"look-btn" + (s.splash === mode ? " active" : "")}
                  aria-pressed={s.splash === mode}
                  data-tip={
                    mode === "fun" ? "Spice of life" : undefined
                  }
                  onClick={() => setSetting(bid, "splash", mode)}
                >
                  {label}
                </button>
              ))}
            </span>
          </div>
          {/* Yours, not the board's: which color reads for you depends on
              your palette and your eyes. The Overview is what makes it
              worth a knob -- there a selection is a couple of pixels of
              edge on a tiny card, and it has to beat cork, pale yellow,
              lavender and a black band all at once. */}
          <div className="options-row">
            <span>UI highlights color</span>
            <span className="gear-color-cell">
              {s.selectionColor !== DEFAULT_SELECTION && (
                <button
                  className="gear-auto"
                  data-tip="Reset to default"
                  onClick={() => setSetting(bid, "selectionColor", DEFAULT_SELECTION)}
                >
                  reset
                </button>
              )}
              <label className="gear-swatch" style={{ background: s.selectionColor }}>
                <input
                  type="color"
                  value={s.selectionColor}
                  aria-label="UI highlights color"
                  onChange={(e) => setSetting(bid, "selectionColor", e.target.value)}
                />
              </label>
            </span>
          </div>
          {/* One set of defaults per user (owner's call -- a library of
              saved looks "will barely get used"). So: promote this board's
              look to the one every untweaked board shows, or drop this
              board's tweaks and go back to it.

              Reset is SHOWN ALWAYS and disabled when there is nothing to
              reset (owner-reported 2026-08-10: "we lost the load style
              button" -- it was there, just conditional, which is exactly
              the "a control that vanishes reads as a bug" rule this file
              already applies to the search menu's bulk actions). Its tip
              says why it is grayed, which is the one place a tip earns a
              sentence. */}
          {board && (
            <div className="options-row options-defaults">
              <button
                className="pane-btn"
                onClick={() => saveAsDefaults(bid)}
              >
                Save Style Default
              </button>
              <button
                className="pane-btn"
                disabled={!tweaked}
                data-tip={tweaked ? undefined : "This board already matches your defaults"}
                onClick={() => resetToDefaults(bid)}
              >
                Reset to Default
              </button>
            </div>
          )}

          {board && (
            <>
          {/* "on this board" matters: everything under here is Board data
              (spacing, row cap, the tier ladder), not project data -- a
              sibling board in the same project keeps its own. */}
          <div className="options-group mono">
            Global settings
            <span className="options-group-sub">applies for all users on this board</span>
          </div>
          {/* THE BACKDROP IS THE BOARD'S (owner, 2026-09-05: "the
              corkboard color is actually a great way to distinguish
              boards from each other at a glance, but it means making the
              cork background board-defined"). Shared like the rows under
              it. The same rows, for YOU, are behind the Overrides button
              by the steering wheel. */}
          <BackdropControls
            value={own}
            onBg={(bg) => ops.setBoardLook(board.id, { bg })}
            onCustom={(c) => ops.setBoardLook(board.id, { bg: "custom", custom: c })}
            onGrain={(v) => ops.setBoardLook(board.id, { grain: v })}
          />
          {/* THE STRIP'S TWO SETTINGS, and only the Beat Map has a strip
              (owner's standing item: each type wants its own Options).
              "Max beats per row" wraps a beat row; "Card spacing" is the
              gap between cards IN one. A Columns board stacks its cards
              and a Free Grid positions them, so on those two these
              sliders move a number nothing reads -- which is worse than
              absent, because it looks like the board is ignoring you. */}
          {!board.type && (
            <>
          <div className="options-row">
            <span>Card spacing</span>
            <span className="options-slider">
              <input
                type="range"
                min={8}
                max={20}
                value={board.cardSpacing ?? DEFAULT_CARD_SPACING}
                onChange={(e) => ops.setBoardCardSpacing(board.id, Number(e.target.value))}
              />
              <span className="mono options-val">{board.cardSpacing ?? DEFAULT_CARD_SPACING}px</span>
            </span>
          </div>
          <div className="options-row">
            <span>Max beats per row</span>
            <span className="options-slider">
              <input
                type="range"
                min={1}
                max={10}
                value={board.maxRowBeats ?? DEFAULT_MAX_ROW_BEATS}
                onChange={(e) => ops.setBoardMaxRowBeats(board.id, Number(e.target.value))}
              />
              <span className="mono options-val">{board.maxRowBeats ?? DEFAULT_MAX_ROW_BEATS}</span>
            </span>
          </div>
            </>
          )}
          <div className="options-title mono">Board structure</div>
          {board.levels.map((l, i) => {
            const gearOpen = gearTier === l.id;
            return (
              <div key={l.id}>
                <div className="options-row">
                  {/* numbered from the leaf up: beat = 1, the top parent tier
                      carries the highest number (grows when a parent is added) */}
                  <span className="mono level-idx">{board.levels.length - i}</span>
                  <DraftInput
                    className="options-name"
                    // commits on blur/Enter AND from its unmount cleanup, so a
                    // rename still survives closing the panel mid-edit
                    value={l.name}
                    ariaLabel={`Tier ${board.levels.length - i} name`}
                    onCommit={(v) => ops.setLevelName(board.id, i, v)}
                  />
                  <button
                    className={"level-gear" + (gearOpen ? " active" : "")}
                    aria-label={`${l.name} defaults`} data-tip={`${l.name} defaults`}
                    onClick={() => setGearTier(gearOpen ? null : l.id)}
                  >
                    <Settings size={13} />
                  </button>
                </div>
                {gearOpen && (
                  <div className="level-gear-panel">
                    <TierSettings board={board} index={i} />
                  </div>
                )}
              </div>
            );
          })}
          {/* ONLY A BEAT MAP HAS A LADDER TO GROW. The other two types
              read a FIXED number of rungs off the leaf, so a tier added
              above lands somewhere their renderer never looks -- and
              they fail in opposite directions, which is why the reason
              is written out rather than left as a shared gate.

              A FREE GRID'S LADDER IS ONE RUNG AND STAYS THERE. Its roots
              ARE the cards, so adding a parent would make every card a
              CHILD of a new top tier -- and the grid renderer draws
              roots, so the board would go blank with the content
              perfectly intact underneath. Not a taste call: it is the
              one option on this menu that can empty a board.

              A COLUMNS BOARD survives it and that is exactly what makes
              it worth hiding. KanbanView reads its column tier as
              `leaf - 1` (deliberately generic), so a third rung leaves
              the columns drawing perfectly and the new top tier UNSHOWN
              -- pressing the button appears to do nothing while quietly
              re-parenting the whole board. A control that silently
              changes the doc and paints nothing is worse than one that
              breaks loudly; the Overview answers this with spines, and
              this type could too if it ever earns them. */}
          {board.type !== "grid" && board.type !== "kanban" && (
            <>
          <button
            className="options-structure-btn"
            disabled={board.levels.length >= MAX_TIERS}
            onClick={() => ops.addParentTier(board.id, "New level")}
          >
            <Plus size={13} /> Add parent category
          </button>
          {board.levels.length >= MAX_TIERS && (
            <div className="options-hint">Maximum of {MAX_TIERS} levels.</div>
          )}
            </>
          )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
