import { useEffect, useRef, useState } from "react";
import { GRID, LOOKS } from "./CorkoMark";
import { HOUSE, POOL, setSplashDesign, setSplashLook } from "./pairings";
import { settingsFor } from "../state/settings";
import { designPins, pickSplashDesign, pinColor, sizeOf } from "../state/mark";
import { splashMarkState } from "../state/markLocal";

/* ------------------------------------------------------------------ *
 *  The boot splash.
 *
 *  The mark's 20 pins fall from above onto a cork tile, seen from a
 *  low angle off the C's mouth side; the camera then makes one sweep
 *  -- east to south, tilting to vertical, fov narrowing toward ortho
 *  -- and the last frame IS the logo. Then it fades to the app.
 *
 *  Hand-rolled projection on canvas 2d, ported from proto/splash.html
 *  -- that page is the tuning rig (dials + scrub), and SHOT below is
 *  its exported settings. Tune there, transcribe here. The C itself is
 *  CorkoMark's GRID, imported so the two can never drift.
 *
 *  House rules kept: prefers-reduced-motion skips the whole thing; a
 *  click or Escape skips it too (it is a boot screen, not a toll).
 *  It is silent: the boot jingle was cut outright 2026-09-21 (owner:
 *  "a gimmick that's not worth the space or code"), file and all.
 * ------------------------------------------------------------------ */

const SHOT = {
  elevation: 12, // deg -- opening camera height above the board plane
  azStart: 90, // deg -- east, the C's mouth side; the move lerps to 0 (south)
  fovStart: 50, // deg
  fovEnd: 5, // deg -- near-ortho, so the final frame matches the SVG mark
  kStart: 0.75, // board apparent size at open (fraction of min dimension)
  kEnd: 0.3, // ...and at the final logo frame
  pinDelay: 350, // ms before the first pin drops
  stagger: 60, // ms between pins, in drop order
  fallMs: 500, // one pin's fall
  fallFrom: 7, // world units above rest
  holdMs: 1750, // when the camera starts moving
  moveMs: 800, // the rise
  needle: 1.8, // visible needle length, board to sphere bottom
  seed: 47760, // drop order + timing jitter (owner's reroll, 2026-08-09)
  /* Empty = draw a pairing from POOL at random, once per page load --
   * the gimmick. Put an id here to PIN one instead, for tuning; the
   * rig's "pin colors" menu is where the ids come from. */
  look: "",
  /* Dye the cork. A `color` composite, so the cork keeps its GRAIN (its
   * luminance) and takes only the hue -- a tinted corkboard rather than
   * a flat panel. */
  tintBoard: true,
  tintColor: "", // "" = the drawn pairing's tint; set one to override
  tintAmt: 0.7, // how far toward that hue, 0..1
  pinColor: "#c2d2ff", // fallback if a look's pinAt has no color for a pin
  holdEndMs: 0, // fade the moment the logo lands -- no hold (owner's call)
  tileInMs: 500, // the cork tile fades in over the pre-rain dead air
  fadeMs: 450, // must match .splash-intro's CSS transition
};

/* ---- the C ---------------------------------------------------------- */
/* A DESIGNED MARK TAKES THE SPLASH TOO (owner, 2026-09-04): an override
 * always, a fun-pool arrangement as one ticket among the pairings with
 * Fun on. Its pins replace the C's and its colors the look's. */
const FUN = settingsFor("").splash === "fun";
const DESIGN = pickSplashDesign(splashMarkState(FUN), FUN, POOL.length);
setSplashDesign(DESIGN);
const SPAN = DESIGN ? sizeOf(DESIGN) : GRID.length;
const PINS: { gx: number; gy: number }[] = DESIGN ? designPins(DESIGN).map((p) => ({ gx: p.x, gy: p.y })) : [];
if (!DESIGN)
  GRID.forEach((row, gy) =>
  [...row].forEach((cell, gx) => {
    if (cell === "#") PINS.push({ gx, gy });
  }),
);

/* ---- which colorway this take wears --------------------------------- *
 *
 * THE GIMMICK (owner, 2026-08-09), behind the "Fun" setting: each page
 * load draws one of the POOL's pairings, so the boot is never quite the
 * same twice. Plain "On" shows the HOUSE pairing every time. The table
 * itself lives in pairings.ts, because the MARK reads it too.
 *
 * The pins always come from the LOOK; only the board tint is paired. */

/* One draw per page load -- module scope, so StrictMode's second mount
 * replays the SAME take rather than switching colorway mid-boot. */
const PICK = SHOT.look
  ? (POOL.find((p) => p.look === SHOT.look) ?? { look: SHOT.look, tint: "" })
  : settingsFor("").splash === "fun"
    ? POOL[Math.floor(Math.random() * POOL.length)]
    : HOUSE;

/* Hand the draw to the MARK, so the logo the splash uncovers is wearing
 * the colorway that just landed (owner, 2026-08-10). Set here at module
 * scope, which runs before React's first render -- see pairings.ts for
 * why it is a module of its own. */
setSplashLook(PICK.look, PICK.tint);

/* The mark's landing this take wears. The splash and the mark build
 * their pins row-major from the same GRID, so a look's `pinAt(i)` means
 * the same pin in both -- that shared order is what lets the logo's own
 * colorways drop straight in here. */
const LOOK = LOOKS.find((l) => l.id === PICK.look) ?? LOOKS[0];
const pinColorOf = (i: number) =>
  DESIGN ? pinColor(DESIGN, PINS[i].gx, PINS[i].gy) : (LOOK.pinAt?.(i) ?? LOOK.pin ?? SHOT.pinColor);
/* What the cork is dyed with -- or "" for PLAIN CORK, the photo as it
 * is (the house pairing). Empty here means "don't tint at all", which
 * is why this can't fall back to the look's board color: that would
 * dye classic's cork near-black. */
const TINT = SHOT.tintColor || (DESIGN ? DESIGN.board : PICK.tint);

const R = 0.37; // sphere radius, grid units (the mark's own)
const REST_H = SHOT.needle + R; // sphere centre height when landed
const HALF = SPAN / 2;
const EXTENT = HALF + 0.42; // board half-size (pin field + margin)
/* board corner radius -- capped against the board's half-size, or a 1x1
   board (EXTENT 0.92) rounds off into a circle (owner, 2026-09-06: "can
   it still be a square-ish backplate ... it's kind of a joke") */
const CORNER = Math.min(0.85, EXTENT * 0.3);
/* what the camera FRAMES: the board's half-size, or the standing pin's
   height when that is the bigger thing -- a 1x1 board is 0.92 across
   while its one pin stands 2.2 tall, and framing the board alone put
   the sphere off the top of the screen (owner, 2026-09-06) */
const FRAME = Math.max(EXTENT, REST_H * 1.1);

const CORK_BASE = "#b08d5f"; // solid cork until the photo lands -- the app's own trick
const EDGE = "rgba(62,42,24,0.55)";

/* ---- seeded drop order (mulberry32, the prototype's) ---------------- */
const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const RANK: number[] = [];
const JIT: number[] = [];
{
  const rng = mulberry32(SHOT.seed);
  const idx = PINS.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  idx.forEach((pin, k) => (RANK[pin] = k));
  PINS.forEach(() => JIT.push((rng() - 0.5) * 0.9));
}
/* The rain is timed to the C's pins: a denser design (an 8x8 holds up
 * to 64) drops faster so its LAST pin lands when the C's would, before
 * the camera rises. Sparser designs keep the C's pace rather than
 * stretching to fill the window. (owner, 2026-09-04) */
const C_PINS = GRID.join("").split("#").length - 1;
const STAGGER = SHOT.stagger * Math.min(1, (C_PINS - 1) / Math.max(1, PINS.length - 1));

/* ---- vectors -------------------------------------------------------- */
type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
};

/* ---- module-level assets, shared across (re)mounts ------------------ */

/* 3x3 cork tiles: a cell's texture coords start anywhere inside one 512
 * tile and reach less than a tile past it, so 1536px covers every cell. */
let corkTexture: HTMLCanvasElement | null = null;
let corkRequested = false;
function requestCork() {
  if (corkRequested) return;
  corkRequested = true;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 1536;
    const g = c.getContext("2d");
    if (!g) return;
    for (let y = 0; y < 1536; y += 512)
      for (let x = 0; x < 1536; x += 512) g.drawImage(img, x, y, 512, 512);
    corkTexture = c;
  };
  img.src = "/textures/cork.jpg";
}

/* ---- geometry ------------------------------------------------------- */
interface Cam {
  pos: V3;
  f: V3;
  right: V3;
  up: V3;
  focal: number;
  m: number;
}
interface Pt {
  x: number;
  y: number;
  z: number;
  s: number; // px per world unit at this depth
}

const pinWorld = (p: { gx: number; gy: number }): V3 => [p.gx + 0.5 - HALF, 0, p.gy + 0.5 - HALF];

/* Near-plane clip for outline polygons: a point behind the eye projects
 * garbage (the divide flips it back into frame). Sutherland-Hodgman. */
const NEAR = 0.35;
function clipNear(poly: { v: V3 }[]): { v: V3 }[] {
  const out: { v: V3 }[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const az = a.v[2] - NEAR;
    const bz = b.v[2] - NEAR;
    if (az >= 0) out.push(a);
    if (az >= 0 !== bz >= 0) {
      const t = az / (az - bz);
      out.push({
        v: [
          a.v[0] + (b.v[0] - a.v[0]) * t,
          a.v[1] + (b.v[1] - a.v[1]) * t,
          a.v[2] + (b.v[2] - a.v[2]) * t,
        ],
      });
    }
  }
  return out;
}

/* ---- the component -------------------------------------------------- */

export function SplashIntro({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fading, setFading] = useState(false);
  const doneRef = useRef(false);
  /* the click-to-skip handler needs the effect's finish(); a ref bridges */
  const finishRef = useRef<() => void>(() => {});
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduced) {
      onDone();
      return;
    }
    const cv = canvasRef.current;
    if (!cv) return;
    const cx = cv.getContext("2d");
    if (!cx) return;
    requestCork();

    let W = 0;
    let H = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth;
      H = window.innerHeight;
      cv.width = W * dpr;
      cv.height = H * dpr;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const camera = (t: number): Cam => {
      const m = easeInOut(clamp01((t - SHOT.holdMs) / SHOT.moveMs));
      const el = (lerp(SHOT.elevation, 90, m) * Math.PI) / 180;
      const az = (lerp(SHOT.azStart, 0, m) * Math.PI) / 180;
      const fov = (lerp(SHOT.fovStart, SHOT.fovEnd, m) * Math.PI) / 180;
      const k = lerp(SHOT.kStart, SHOT.kEnd, m);
      const lookY = lerp(0.85, 0, m);
      const focal = H / 2 / Math.tan(fov / 2);
      const d = (focal * FRAME) / ((k * Math.min(W, H)) / 2);
      const pos: V3 = [
        d * Math.cos(el) * Math.sin(az),
        d * Math.sin(el) + lookY,
        d * Math.cos(el) * Math.cos(az),
      ];
      const f = norm(sub([0, lookY, 0], pos));
      /* the orbit's own up vector -- carries the frame through straight
       * down without a flip, landing screen-up = -z: logo orientation */
      const up: V3 = [
        -Math.sin(el) * Math.sin(az),
        Math.cos(el),
        -Math.sin(el) * Math.cos(az),
      ];
      const right = norm(cross(f, up));
      return { pos, f, right, up: cross(right, f), focal, m };
    };

    const viewOf = (cam: Cam, p: V3): V3 => {
      const v = sub(p, cam.pos);
      return [dot(v, cam.right), dot(v, cam.up), dot(v, cam.f)];
    };
    const projView = (cam: Cam, v: V3): Pt => ({
      x: W / 2 + (v[0] * cam.focal) / v[2],
      y: H / 2 - (v[1] * cam.focal) / v[2],
      z: v[2],
      s: cam.focal / v[2],
    });
    const project = (cam: Cam, p: V3) => projView(cam, viewOf(cam, p));

    /* affine map taking texture triangle t0/t1/t2 -> screen s0/s1/s2;
     * the clip is expanded a hair about the centroid to hide cell seams */
    type UV = { x: number; y: number };
    const texTri = (s0: Pt, s1: Pt, s2: Pt, t0: UV, t1: UV, t2: UV) => {
      if (!corkTexture) return;
      const u1x = t1.x - t0.x;
      const u1y = t1.y - t0.y;
      const u2x = t2.x - t0.x;
      const u2y = t2.y - t0.y;
      const det = u1x * u2y - u2x * u1y;
      if (!det) return;
      const v1x = s1.x - s0.x;
      const v1y = s1.y - s0.y;
      const v2x = s2.x - s0.x;
      const v2y = s2.y - s0.y;
      const a = (v1x * u2y - v2x * u1y) / det;
      const b = (v1y * u2y - v2y * u1y) / det;
      const c = (v2x * u1x - v1x * u2x) / det;
      const d = (v2y * u1x - v1y * u2x) / det;
      const e = s0.x - a * t0.x - c * t0.y;
      const f = s0.y - b * t0.x - d * t0.y;
      cx.save();
      const gx = (s0.x + s1.x + s2.x) / 3;
      const gy = (s0.y + s1.y + s2.y) / 3;
      cx.beginPath();
      for (const q of [s0, s1, s2]) cx.lineTo(gx + (q.x - gx) * 1.04, gy + (q.y - gy) * 1.04);
      cx.closePath();
      cx.clip();
      cx.transform(a, b, c, d, e, f);
      cx.drawImage(corkTexture, 0, 0);
      cx.restore();
    };

    const drawBoardTexture = (cam: Cam) => {
      // ONE texture tile across the whole board (owner's ask -- the
      // grain reads bigger and never visibly repeats)
      const S = 512 / (2 * EXTENT);
      const N = Math.ceil((2 * EXTENT) / 0.7);
      const w = (2 * EXTENT) / N;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const x0 = -EXTENT + i * w;
          const z0 = -EXTENT + j * w;
          /* texture anchored to WORLD coords, so the grain never slides */
          const u0 = (((x0 * S) % 512) + 512) % 512;
          const v0 = (((z0 * S) % 512) + 512) % 512;
          const c00 = viewOf(cam, [x0, 0, z0]);
          const c10 = viewOf(cam, [x0 + w, 0, z0]);
          const c11 = viewOf(cam, [x0 + w, 0, z0 + w]);
          const c01 = viewOf(cam, [x0, 0, z0 + w]);
          if (c00[2] < NEAR || c10[2] < NEAR || c11[2] < NEAR || c01[2] < NEAR) continue;
          const s00 = projView(cam, c00);
          const s10 = projView(cam, c10);
          const s11 = projView(cam, c11);
          const s01 = projView(cam, c01);
          const u1 = u0 + w * S;
          const v1 = v0 + w * S;
          texTri(s00, s10, s11, { x: u0, y: v0 }, { x: u1, y: v0 }, { x: u1, y: v1 });
          texTri(s00, s11, s01, { x: u0, y: v0 }, { x: u1, y: v1 }, { x: u0, y: v1 });
        }
      }
    };

    const roundedRectPath = (cam: Cam): Path2D | null => {
      const pts: { v: V3 }[] = [];
      const cs: [number, number, number, number][] = [
        [EXTENT - CORNER, EXTENT - CORNER, 0, Math.PI / 2],
        [-(EXTENT - CORNER), EXTENT - CORNER, Math.PI / 2, Math.PI],
        [-(EXTENT - CORNER), -(EXTENT - CORNER), Math.PI, Math.PI * 1.5],
        [EXTENT - CORNER, -(EXTENT - CORNER), Math.PI * 1.5, Math.PI * 2],
      ];
      for (const [ox, oz, a0, a1] of cs) {
        for (let k = 0; k <= 6; k++) {
          const a = a0 + ((a1 - a0) * k) / 6;
          pts.push({ v: viewOf(cam, [ox + CORNER * Math.cos(a), 0, oz + CORNER * Math.sin(a)]) });
        }
      }
      const poly = pts.some((q) => q.v[2] < NEAR) ? clipNear(pts) : pts;
      if (poly.length < 3) return null;
      const path = new Path2D();
      poly.forEach((q, k) => {
        const s = projView(cam, q.v);
        if (k) path.lineTo(s.x, s.y);
        else path.moveTo(s.x, s.y);
      });
      path.closePath();
      return path;
    };

    /* sphere-center height at t: quadratic fall (gravity), hard stop --
     * a pin stabs in, it doesn't bounce */
    const pinHeight = (i: number, t: number) => {
      const t0 = SHOT.pinDelay + (RANK[i] + JIT[i]) * STAGGER;
      if (t <= t0) return { h: REST_H + SHOT.fallFrom, v: 0, aloft: true };
      const s = (t - t0) / SHOT.fallMs;
      if (s >= 1) return { h: REST_H, v: 0, aloft: false };
      return {
        h: REST_H + SHOT.fallFrom * (1 - s * s),
        v: (2 * s * SHOT.fallFrom) / SHOT.fallMs,
        aloft: false,
      };
    };

    const drawShadow = (cam: Cam, wx: number, wz: number, hb: number) => {
      const a = 0.34 * clamp01(1 - hb / (SHOT.fallFrom * 0.85));
      if (a <= 0.01) return;
      const rad = R * (1.05 + hb * 0.1);
      const off = hb * 0.06;
      const path = new Path2D();
      for (let k = 0; k <= 14; k++) {
        const t = (k / 14) * Math.PI * 2;
        const q = project(cam, [wx + off + rad * Math.cos(t), 0.002, wz + off + rad * Math.sin(t)]);
        if (k) path.lineTo(q.x, q.y);
        else path.moveTo(q.x, q.y);
      }
      path.closePath();
      cx.fillStyle = `rgba(0,0,0,${a})`;
      cx.fill(path);
    };

    const drawPin = (cam: Cam, i: number, t: number) => {
      const { h, v, aloft } = pinHeight(i, t);
      if (aloft) return null;
      const [wx, , wz] = pinWorld(PINS[i]);
      const top = project(cam, [wx, h - R * 0.7, wz]);
      const tip = project(cam, [wx, h - R - SHOT.needle, wz]);
      const ctr = project(cam, [wx, h, wz]);
      if (ctr.z <= 0.1) return null;
      return {
        depth: ctr.z,
        draw() {
          const w = 0.045 * top.s;
          const g = cx.createLinearGradient(top.x - w, top.y, top.x + w, top.y);
          g.addColorStop(0, "#e4e8ee");
          g.addColorStop(0.45, "#aeb5bf");
          g.addColorStop(1, "#7c828c");
          cx.fillStyle = g;
          cx.beginPath();
          cx.moveTo(top.x - w, top.y);
          cx.lineTo(top.x + w, top.y);
          cx.lineTo(tip.x, tip.y);
          cx.closePath();
          cx.fill();

          const pr = R * ctr.s;
          const stretch = 1 + Math.min(0.35, v * 55); // streak while falling fast
          cx.save();
          cx.translate(ctr.x, ctr.y);
          cx.scale(1, stretch);
          const fill = pinColorOf(i);
          const sg = cx.createRadialGradient(-pr * 0.32, -pr * 0.34, pr * 0.1, 0, 0, pr * 1.25);
          sg.addColorStop(0, shade(fill, 1.12));
          sg.addColorStop(0.55, fill);
          sg.addColorStop(1, shade(fill, 0.55));
          cx.fillStyle = sg;
          cx.beginPath();
          cx.arc(0, 0, pr, 0, Math.PI * 2);
          cx.fill();
          // catchlight, the mark's own ratios
          cx.fillStyle = "rgba(255,255,255,0.5)";
          cx.beginPath();
          cx.arc(-pr * 0.3, -pr * 0.32, pr * 0.3, 0, Math.PI * 2);
          cx.fill();
          cx.restore();
        },
      };
    };

    const endAt = SHOT.holdMs + SHOT.moveMs + SHOT.holdEndMs;
    const start = performance.now();
    let raf = 0;
    let fadeStarted = false;

    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      setFading(true);
      window.setTimeout(onDone, SHOT.fadeMs + 60);
    };
    finishRef.current = finish;

    const frame = (now: number) => {
      const t = now - start;

      const cam = camera(Math.min(t, SHOT.holdMs + SHOT.moveMs));

      /* LIGHT open (owner, 2026-08-09; was the topbar's #1d2026, then
       * pure white -- settled on warm eggshell, rgb 240,236,229). The
       * vignette survives at a whisper -- it grounds the tile against a
       * bare light field -- but the dark open's 0.35 would read as grey
       * smoke here. Its stop is the dial. MUST match .splash-intro's
       * CSS background. */
      cx.fillStyle = "#f0ece5";
      cx.fillRect(0, 0, W, H);
      const vg = cx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.08)");
      cx.fillStyle = vg;
      cx.fillRect(0, 0, W, H);

      const tile = roundedRectPath(cam);
      if (tile) {
        if (DESIGN) {
          /* A DESIGNED BOARD IS ITS COLOR, FLAT -- the way the designer
           * and the corner mark paint it (owner, 2026-09-06: "I like it
           * being more like how it works in the logo designer than how
           * it's being applied in the splash"). The cork dye below puts
           * the design's hue over the photo's LUMINANCE, which turned a
           * near-black board mid-brown here while the mark showed it
           * black. The edge is the mark's own, a darker cut of the color. */
          cx.fillStyle = DESIGN.board;
          cx.fill(tile);
        } else {
          cx.fillStyle = CORK_BASE;
          cx.fill(tile);
          if (corkTexture) {
            cx.save();
            cx.clip(tile);
            drawBoardTexture(cam);
            cx.restore();
          }
          /* DYE the cork, if this take asks for it. `color` composites the
           * source's hue+saturation onto the backdrop's LUMINANCE, so the
           * grain survives untouched and the board reads as cork in the
           * look's color rather than as a painted panel. The edge follows
           * the same look, or the frame would still be brown. */
          if (SHOT.tintBoard && TINT) {
            cx.save();
            cx.clip(tile);
            cx.globalCompositeOperation = "color";
            cx.globalAlpha = SHOT.tintAmt;
            cx.fillStyle = TINT;
            cx.fill(tile);
            cx.restore(); // puts back both the composite mode and the alpha
          }
        }
        // the frame takes a darker cut of the tint -- that IS the board's
        // color now, so the look's own edge would be the odd one out.
        // Undyed cork keeps cork's own edge; a design wears the mark's.
        cx.strokeStyle = DESIGN ? shade(DESIGN.board, 0.7) : SHOT.tintBoard && TINT ? shade(TINT, 0.55) : EDGE;
        cx.lineWidth = Math.max(1, 0.045 * project(cam, [0, 0, 0]).s);
        cx.stroke(tile);

        cx.save();
        cx.clip(tile);
        for (let i = 0; i < PINS.length; i++) {
          const { h, aloft } = pinHeight(i, t);
          if (aloft) continue;
          const [wx, , wz] = pinWorld(PINS[i]);
          drawShadow(cam, wx, wz, h - REST_H);
        }
        cx.restore();

        /* The tile FADES IN over the pre-rain dead air (owner's ask) --
         * but NOT via globalAlpha on the tile itself: the texture
         * triangles overlap 4% to hide their seams, and under partial
         * alpha the overlaps double-composite, drawing the whole
         * triangulation (owner saw it). So the tile paints SOLID and a
         * backdrop-colored veil fades OUT over it -- for opaque layers
         * the two composite identically, with no seams. Painted before
         * the pins, so they stay full strength. */
        const tileIn = easeInOut(clamp01(t / SHOT.tileInMs));
        if (tileIn < 1) {
          cx.globalAlpha = 1 - tileIn;
          cx.fillStyle = "#f0ece5"; // the backdrop -- keep in step with the clear
          cx.fillRect(0, 0, W, H);
          cx.globalAlpha = 1;
        }
      }

      const jobs: { depth: number; draw: () => void }[] = [];
      for (let i = 0; i < PINS.length; i++) {
        const j = drawPin(cam, i, t);
        if (j) jobs.push(j);
      }
      jobs.sort((a, b) => b.depth - a.depth).forEach((j) => j.draw());

      if (t >= endAt && !fadeStarted) {
        fadeStarted = true;
        finish();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (reduced) return null;
  return (
    <div
      className={"splash-intro" + (fading ? " fading" : "")}
      onPointerDown={() => finishRef.current()}
      aria-hidden
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
