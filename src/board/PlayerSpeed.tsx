import { useEffect, useRef, useState } from "react";
import { Gauge } from "lucide-react";
import { SPEED_MAX, SPEED_MIN, SPEED_STEP, clampSpeed, formatSpeed } from "../state/player";

/* ------------------------------------------------------------------ *
 *  PLAYBACK SPEED (owner, 2026-10-05): "an icon with a symbol, like the
 *  dark mode buttons", living in the transport row "to the left of" the
 *  duration and "anchored to its left", that brings up "a simple
 *  horizontal slider with gradation hatches and a hovering number while
 *  dragging".
 *
 *  So: a gauge icon button, lit (like a toggle that is on) whenever the
 *  speed is not 1x, so a fast pass is never mistaken for real time; a
 *  popover ABOVE it -- the transport sits under the picture, and the
 *  picture is the one thing a popover may cover for a moment -- with a
 *  range input over a row of hatches, one per quarter and a taller one
 *  at 1x; the number floats over the thumb only while it is held. The
 *  0.5x / 1x / 1.5x / 2x marks under the hatches are buttons that snap,
 *  which is also how you get back to 1x without hunting for it.
 *
 *  The value itself is the board's player pref (state/playerPrefs.ts);
 *  this file only shows it and asks for changes.
 * ------------------------------------------------------------------ */

const HATCHES: number[] = [];
for (let v = SPEED_MIN; v <= SPEED_MAX + 1e-9; v += 0.25) HATCHES.push(Math.round(v * 100) / 100);
const MARKS = [0.5, 1, 1.5, 2];

/* where a value sits along the track, 0..100 */
const pct = (v: number) => ((v - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100;
/* a percentage position corrected for the thumb's own width, so a mark
 * lines up with the CENTER of the thumb at that value (the thumb's
 * travel is the track less its width) */
const THUMB = 14;
const at = (v: number) => `calc(${pct(v)}% + ${THUMB / 2 - (pct(v) / 100) * THUMB}px)`;

export function PlayerSpeed({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (!dragging) return;
    const up = () => setDragging(false);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging]);

  const label = formatSpeed(value);

  return (
    <span className="player-speed" ref={ref}>
      <button
        className={"pane-btn icon-only player-speed-btn tip-left" + (value !== 1 ? " on" : "") + (open ? " active" : "")}
        aria-label={`Playback speed, ${label}`}
        aria-expanded={open}
        data-tip={open ? undefined : `Speed ${label}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <Gauge size={13} />
      </button>
      {open && (
        <div className="player-speed-pop" role="dialog" aria-label="Playback speed">
          <div className="player-speed-track">
            <div className="player-speed-hatches" aria-hidden="true">
              {HATCHES.map((h) => (
                <span key={h} className={"player-speed-hatch" + (h === 1 ? " one" : "")} style={{ left: at(h) }} />
              ))}
            </div>
            {dragging && (
              <span className="player-speed-bubble mono" style={{ left: at(value) }}>
                {label}
              </span>
            )}
            <input
              type="range"
              className="player-speed-range"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={SPEED_STEP}
              value={value}
              aria-label="Playback speed"
              aria-valuetext={label}
              autoFocus
              onPointerDown={() => setDragging(true)}
              onChange={(e) => onChange(clampSpeed(Number(e.target.value)))}
            />
          </div>
          <div className="player-speed-marks">
            {MARKS.map((m) => (
              <button
                key={m}
                className={"player-speed-mark mono" + (value === m ? " on" : "")}
                style={{ left: at(m) }}
                onClick={() => onChange(m)}
              >
                {formatSpeed(m)}
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
