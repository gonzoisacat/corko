import { useRef } from "react";
import type { PointerEvent as RPointerEvent } from "react";

/* ------------------------------------------------------------------ *
 *  AN INLINE COLOR PICKER (owner, 2026-09-04: "the picker and swatches
 *  on the same first right click level... the singular hex code field
 *  added, in addition to the RGB values"). No native <input type=color>,
 *  which is a second dialog: a saturation/value square, a hue bar, and
 *  hex, R, G, B fields that all read and write the same color.
 * ------------------------------------------------------------------ */

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r: number, g: number, b: number): string =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const rgb = hexToRgb(value) ?? [128, 128, 128];
  const [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
  /* The hue is remembered across a drag through gray, where a color has
   * no hue of its own -- otherwise the square snaps to red at the edge. */
  const hueRef = useRef(h);
  if (s > 0 && v > 0) hueRef.current = h;
  const hue = hueRef.current;

  const set = (nh: number, ns: number, nv: number) => {
    const [r, g, b] = hsvToRgb(nh, ns, nv);
    onChange(rgbToHex(r, g, b));
  };
  const drag = (el: HTMLElement, e: RPointerEvent<HTMLElement>, at: (fx: number, fy: number) => void) => {
    const r = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      at(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
    };
    move(e.nativeEvent);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const field = (label: string, i: number) => (
    <label className="cp-field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={255}
        value={rgb[i]}
        onChange={(e) => {
          const next: [number, number, number] = [rgb[0], rgb[1], rgb[2]];
          next[i] = Number(e.target.value);
          onChange(rgbToHex(next[0], next[1], next[2]));
        }}
      />
    </label>
  );
  return (
    <div className="cp" onMouseDown={(e) => e.stopPropagation()}>
      <div
        className="cp-square"
        style={{ backgroundColor: `hsl(${hue} 100% 50%)` }}
        onPointerDown={(e) => {
          e.preventDefault();
          drag(e.currentTarget, e, (fx, fy) => set(hue, fx, 1 - fy));
        }}
      >
        <span className="cp-dot" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: value }} />
      </div>
      <div
        className="cp-hue"
        onPointerDown={(e) => {
          e.preventDefault();
          drag(e.currentTarget, e, (fx) => set(fx * 360, s || 1, v || 1));
        }}
      >
        <span className="cp-dot" style={{ left: `${(hue / 360) * 100}%`, top: "50%", background: `hsl(${hue} 100% 50%)` }} />
      </div>
      <div className="cp-fields">
        <label className="cp-field cp-hex">
          <span>Hex</span>
          <input
            type="text"
            value={value}
            spellCheck={false}
            onChange={(e) => {
              const t = e.target.value.trim();
              const full = t.startsWith("#") ? t : `#${t}`;
              if (hexToRgb(full)) onChange(full.toLowerCase());
            }}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
        {field("R", 0)}
        {field("G", 1)}
        {field("B", 2)}
      </div>
    </div>
  );
}
