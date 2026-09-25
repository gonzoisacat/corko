import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { useClampToViewport } from "../ui/useClampToViewport";
import {
  FRAME_PAD_MAX,
  FRAME_PAD_MIN,
  FRAME_SCALE_MAX,
  FRAME_SCALE_MIN,
  setSetting,
  useSettings,
  type FrameStyle,
} from "../state/settings";
import { frameMenu, useFrameMenu } from "./frameMenu";
import { pickWallImage, removeWallImage, storeWallImage } from "./wallImage";

/* ------------------------------------------------------------------ *
 *  THE FRAME'S ONE POPUP (board/frameMenu.ts says where it opens from).
 *  Three rows: the frame -- none, aluminum, wood; the wall's color, as
 *  swatches and a picker; the wall's picture, chosen from a file or
 *  taken away. Every change lands at once, so the board behind the
 *  popup is the preview.
 * ------------------------------------------------------------------ */

const FRAMES: { key: FrameStyle | "off"; label: string }[] = [
  { key: "off", label: "None" },
  { key: "aluminum", label: "Aluminum" },
  { key: "wood", label: "Wood" },
];

/* A few walls to start from: plaster, warm white, gray, slate, a dark
 * studio wall. The picker beside them takes any other. */
const WALLS = ["#d8d4cb", "#ece8df", "#b9b8b3", "#6f7275", "#2b2d31"];

export function FramePopover() {
  const menu = useFrameMenu();
  const s = useSettings(menu?.boardId ?? "");
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) frameMenu.close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && frameMenu.close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const w = 232;
  const { left, top } = useClampToViewport(ref, menu?.x ?? 0, menu?.y ?? 0, { w, h: 190 });
  if (!menu) return null;
  const bid = menu.boardId;
  const current: FrameStyle | "off" = s.frame ? s.frameStyle : "off";

  return (
    <div ref={ref} className="ctx-menu frame-menu" style={{ left, top, width: w }}>
      <div className="options-group mono">Frame</div>
      <div className="frame-choices">
        {FRAMES.map((f) => (
          <button
            key={f.key}
            className={"tp-btn frame-choice" + (current === f.key ? " active" : "")}
            onClick={() => {
              if (f.key === "off") setSetting(bid, "frame", false);
              else {
                setSetting(bid, "frameStyle", f.key);
                setSetting(bid, "frame", true);
              }
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      {/* THICKNESS and PADDING (owner, 2026-09-04), both live -- the
          board behind is the preview. Thickness scales the band from its
          material's base; Padding scales the cork between the band and
          the outermost cards from the half-a-card rule (board/frame.ts),
          down to none. */}
      <label className="frame-scale-row">
        <span className="frame-scale-label">Frame thickness</span>
        <input
          type="range"
          min={FRAME_SCALE_MIN * 10}
          max={FRAME_SCALE_MAX * 10}
          value={Math.round(s.frameScale * 10)}
          aria-label="Frame thickness"
          disabled={!s.frame}
          onChange={(e) => setSetting(bid, "frameScale", Number(e.target.value) / 10)}
        />
        <span className="mono frame-scale-val">{s.frameScale.toFixed(1)}x</span>
      </label>
      <label className="frame-scale-row">
        <span className="frame-scale-label">Padding</span>
        <input
          type="range"
          min={FRAME_PAD_MIN * 10}
          max={FRAME_PAD_MAX * 10}
          value={Math.round(s.framePad * 10)}
          aria-label="Padding between the frame and the outer cards"
          disabled={!s.frame}
          onChange={(e) => setSetting(bid, "framePad", Number(e.target.value) / 10)}
        />
        <span className="mono frame-scale-val">{s.framePad.toFixed(1)}x</span>
      </label>
      <div className="options-group mono">Wall</div>
      <div className="bg-choices frame-walls">
        {WALLS.map((c) => (
          <button
            key={c}
            className={"bg-choice" + (s.wallColor === c && !s.wallImage ? " active" : "")}
            style={{ background: c }}
            aria-label={`Wall color ${c}`}
            data-tip={c}
            onClick={() => {
              setSetting(bid, "wallColor", c);
              if (s.wallImage) {
                void removeWallImage(s.wallImage);
                setSetting(bid, "wallImage", "");
              }
            }}
          />
        ))}
        <label className="bg-choice bg-custom" style={{ background: s.wallColor }} data-tip="Pick your own">
          <input
            type="color"
            value={s.wallColor}
            aria-label="Pick your own wall color"
            onChange={(e) => setSetting(bid, "wallColor", e.target.value)}
          />
        </label>
      </div>
      <div className="frame-image-row">
        <button
          className="ctx-item"
          disabled={busy}
          onClick={async () => {
            const file = await pickWallImage();
            if (!file) return;
            setBusy(true);
            const key = await storeWallImage(bid, file);
            setBusy(false);
            if (!key) return;
            if (s.wallImage) void removeWallImage(s.wallImage);
            setSetting(bid, "wallImage", key);
          }}
        >
          <ImagePlus size={14} /> {s.wallImage ? "Replace picture..." : "Wall picture..."}
        </button>
        {s.wallImage && (
          <button
            className="ctx-item"
            onClick={() => {
              void removeWallImage(s.wallImage);
              setSetting(bid, "wallImage", "");
            }}
          >
            <X size={14} /> Remove picture
          </button>
        )}
      </div>
    </div>
  );
}
