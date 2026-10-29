import { LOOKS, matchesLook, type Settings } from "../state/settings";
import { Toggle } from "./TierSettings";

/* ------------------------------------------------------------------ *
 *  THE CARDS' LOOK ROWS, once, for both places that edit them -- the
 *  BackdropControls pattern (2026-10-29, when these became the board's:
 *  state/boardStyle.ts). The Options menu's shared group edits the
 *  BOARD's (everyone sees it); the Overrides door edits YOURS. Same rows,
 *  same labels, so the override reads as the same question answered for
 *  you. Which store a change lands in is the caller's `set`.
 * ------------------------------------------------------------------ */

type Set = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

export function CardStyleControls({
  value,
  set,
  disabled = false,
}: {
  value: Settings;
  set: Set;
  /* shown but inert, the Overrides menu with its switch off */
  disabled?: boolean;
}) {
  const s = value;
  return (
    <fieldset className="card-style-rows" disabled={disabled}>
      {/* one-click look bundles; individual toggles below still dial */}
      <div className="options-row">
        <span>Look</span>
        <span className="look-choices">
          {LOOKS.map((l) => (
            <button
              key={l.id}
              className={"look-btn" + (matchesLook(s, l) ? " active" : "")}
              onClick={() => {
                for (const [k, v] of Object.entries(l.apply)) set(k as keyof Settings, v as never);
              }}
            >
              {l.label}
            </button>
          ))}
        </span>
      </div>
      <Toggle label="Rounded corners" checked={s.roundedCorners} onChange={(v) => set("roundedCorners", v)} />
      <Toggle label="Card tilt" checked={s.cardTilt} onChange={(v) => set("cardTilt", v)} />
      <Toggle label="Pushpins" checked={s.pushpins} onChange={(v) => set("pushpins", v)} />
      {s.pushpins && (
        <div className="options-row">
          <span>Pushpin color</span>
          <span className="gear-color-cell">
            <button
              className={"gear-auto" + (s.pushpinColor === "random" ? " active" : "")}
              data-tip="A random color per pin"
              onClick={() => set("pushpinColor", "random")}
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
                onChange={(e) => set("pushpinColor", e.target.value)}
              />
            </label>
          </span>
        </div>
      )}
      <Toggle label="Drop Shadows" checked={s.liftedShadow} onChange={(v) => set("liftedShadow", v)} />
    </fieldset>
  );
}
