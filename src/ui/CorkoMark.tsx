import { useCallback, useEffect, useRef, useState } from "react";
import { FlyBy } from "./FlyBy";
import { splashDesign, splashLook, splashTint, tintFor } from "./pairings";
import { useProject } from "../state/useBoard";
import { rememberShared, useMarkLocal } from "../state/markLocal";
import { settingsFor } from "../state/settings";
import { designPins, pinColor, sameDesign, sizeOf } from "../state/mark";
import type { MarkDesign } from "../state/types";
import { pinboardDesigner } from "./designerDoor";

/* ------------------------------------------------------------------ *
 *  The Corko mark: a capital C pushed into a corkboard.
 *
 *  Procedural, not artwork -- the C is a bitmap and every pin's position
 *  derives from it, so the shape is one block of strings to edit and the
 *  grid size follows along (the viewBox is read off GRID, not hardcoded).
 *  The frame is the legend swatch's (same radius ratio, same 1px border),
 *  scaled up ~2.6x: the logo is literally a swatch with a board in it.
 *
 *  Click it and one of the ROUTINES plays for a beat, then the pins land.
 *  EVERY routine is paired with the look it lands in (owner's call,
 *  2026-08-01 -- there used to be a scramble that landed on a random plain
 *  colorway, and the plain colorways went with it): the animation
 *  arrives at its own design rather than cutting to an unrelated one. A
 *  click picks any routine except the one whose landing the mark is
 *  already wearing, so a click always visibly does something. It starts
 *  on 80% black with pastel blue pins, which is also where "repin" lands.
 *
 *  The animation is decoration, so `prefers-reduced-motion` skips
 *  straight to the landing rather than flickering at someone who asked it
 *  not to.
 * ------------------------------------------------------------------ */

/* The C. `#` is a pin, `.` is bare board -- edit this and the mark
 * changes; the only other reader is SplashIntro, which imports the
 * shape rather than keeping a copy, so the two can't drift.
 *
 * Six cells rather than an odd grid on purpose: with no center row, the
 * C's aperture falls between two rows and the stroke reads as even
 * top-to-bottom. The left stem is two pins wide so it doesn't look like
 * the thin arcs at the corners. */
export const GRID = [
  ".####.",
  "##...#",
  "##....",
  "##....",
  "##...#",
  ".####.",
];

const SPAN = GRID.length;

const PINS: { x: number; y: number }[] = [];
GRID.forEach((row, y) =>
  [...row].forEach((cell, x) => {
    if (cell === "#") PINS.push({ x: x + 0.5, y: y + 0.5 });
  }),
);

/* The cells the C ENCLOSES: its hollow, plus the mouth between the two
 * open ends -- the empty region you could pour into. Found by flooding
 * outward from the empty cells off the outer ring, through empty cells
 * only, so it reaches the gap between the terminals and stops dead at the
 * four isolated corners (each walled off by pins). On this shape: the 3x4
 * block plus the two cells in the mouth. Cells keep their grid coords so
 * a look's flesh resolver can address them ("the eye goes at 2,1"). */
const FLESH: { x: number; y: number; gx: number; gy: number }[] = (() => {
  const empty = (x: number, y: number) =>
    x >= 0 && x < SPAN && y >= 0 && y < SPAN && GRID[y][x] === ".";
  const found = new Set<string>();
  const queue: [number, number][] = [];
  GRID.forEach((row, y) =>
    [...row].forEach((_, x) => {
      if (empty(x, y) && x > 0 && x < SPAN - 1 && y > 0 && y < SPAN - 1) {
        found.add(`${x},${y}`);
        queue.push([x, y]);
      }
    }),
  );
  while (queue.length) {
    const [x, y] = queue.shift()!;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as [number, number][]) {
      if (empty(nx, ny) && !found.has(`${nx},${ny}`)) {
        found.add(`${nx},${ny}`);
        queue.push([nx, ny]);
      }
    }
  }
  return [...found]
    .map((k) => k.split(",").map(Number) as [number, number])
    .map(([x, y]) => ({ x: x + 0.5, y: y + 0.5, gx: x, gy: y }));
})();

/* Which grid ROW each pin sits in -- for looks that band top to bottom. */
const ROW = PINS.map((p) => Math.floor(p.y));

/* Which grid COLUMN each pin sits in -- for wipes that travel sideways. */
const COL = PINS.map((p) => Math.floor(p.x));

/* Is a fill light enough for the full-strength catchlight? Dark feature
 * cells (a smiley's eye) take a faint one instead, or the highlight reads
 * brighter than the thing it sits on. */
/* A darker cut of a color, for a paired board and its frame -- the
 * splash's tile edge is derived the same way. */
const shade = (hex: string, f: number): string => {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
};

const lumaOf = (hex: string): number => {
  if (!hex.startsWith("#") || hex.length !== 7) return 0;
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};

const bright = (hex: string): boolean => {
  if (!hex.startsWith("#") || hex.length !== 7) return true;
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 96;
};

/* ---- row palettes (top to bottom) ----------------------------------- */

/* Saturated ROYGBV, one band per row. */
const ROYGBV = ["#ff0000", "#ff7f00", "#ffe000", "#00e03c", "#0a7cff", "#9b30ff"];

/* The trans flag, one stripe per row -- six rows, six stripes. */
const TRANS_ROWS = ["#5bcefa", "#f5a9b8", "#ffffff", "#ffffff", "#f5a9b8", "#5bcefa"];

/* A fire is brightest at its base: dark red up top, gold at the bottom. */
const EMBER_ROWS = ["#7f1d1d", "#b91c1c", "#dc2626", "#ea580c", "#f97316", "#fbbf24"];

/* Water: light at the surface, navy at depth. */
const OCEAN_ROWS = ["#a5e8f8", "#5fc9e8", "#38a3cf", "#2280ab", "#155e86", "#0b3e5e"];

/* Dusk: indigo overhead pouring down to the gold at the horizon. */
const SUNSET_ROWS = ["#2e1a5e", "#7b2d8e", "#c2417f", "#e8636a", "#f8964f", "#ffc46b"];

/* Candy stripes: chunky diagonals, two cells to a band. */
const candyAt = (i: number) =>
  Math.floor((COL[i] + ROW[i]) / 2) % 2 ? "#fff5f5" : "#e5484d";

/* The features drawn in the C's hollow. Hand-placed -- at 34px a feature a
 * cell off reads as a mistake, not a face. (A watermelon look lived here
 * too, seeds and all; the owner cut it 2026-08-03.) */
const SMILEY_FEATURES = new Set(["2,1", "4,1", "2,3", "4,3", "3,4"]); // eyes + the smile's arc
const HEART_CELLS = new Set(["2,1", "4,1", "2,2", "3,2", "4,2", "3,3"]); // a pixel heart

/* Board + pin, as a set. The first is the one it starts on, and every one
 * of them is the landing of exactly one routine below.
 *
 * EXPORTED, like GRID, and for the same reason: the boot splash dresses
 * its falling pins in these landings rather than keeping colors of its
 * own, so retuning a look here moves both. A look's `pinAt` is indexed
 * by PIN NUMBER, and every reader derives its pins row-major from the
 * same GRID -- that shared order is what makes the index portable. */
export interface Look {
  id: string;
  board: string;
  edge: string;
  pin: string;
  /* Per-pin override, for the looks that aren't a single color. One hook
   * rather than a field per idea. */
  pinAt?: (i: number) => string;
  /* Per-cell color for the C's hollow (FLESH), for looks that fill their
   * own negative space; null = leave that cell bare board. Two users:
   * the smiley's face and the pixel heart. */
  flesh?: (gx: number, gy: number) => string | null;
}
export const LOOKS: Look[] = [
  /* 80% black + pastel blue. Cork-and-lavender was the first idea and it
   * lost: a tan board and a mid-lavender pin sit at nearly the same
   * lightness, so at 34px the C mushed into its own background. Nearly
   * every colorway here is a dark board with a light pin, which is the
   * only pairing that survives being 3px across (the bee breaks it
   * knowingly -- black stripes need a honey board). The blue is Corko's
   * own (the legend's B-roll swatch). */
  { id: "classic", board: "#333333", edge: "#50565f", pin: "#cfe3f4" },
  { id: "matrix", board: "#0b1410", edge: "#1e3a28", pin: "#39ff6a" }, // where the green rain settles
  /* Trans flag: light blue, pink, white, white, pink, light blue -- six
   * rows for six stripes, which is why the 6x6 grid suits it exactly. */
  {
    id: "trans",
    board: "#16181c",
    edge: "#3a3f47",
    pin: TRANS_ROWS[0],
    pinAt: (i) => TRANS_ROWS[ROW[i]] ?? TRANS_ROWS[TRANS_ROWS.length - 1],
  },
  /* Rainbow: where the pride chase comes to rest. Saturated ROYGBV banded
   * top row to bottom, on near-black so all six read at once. */
  {
    id: "rainbow",
    board: "#141416",
    edge: "#3d3d44",
    pin: ROYGBV[0],
    pinAt: (i) => ROYGBV[ROW[i]] ?? ROYGBV[ROYGBV.length - 1],
  },
  /* Smiley: a sunny C with the face drawn in its hollow -- eyes up top,
   * the smile's ends a row higher than its middle so it curves. The
   * features are board-colored holes, like button eyes. */
  {
    id: "smiley",
    board: "#2b2417",
    edge: "#4a3d20",
    pin: "#ffd23f",
    flesh: (gx, gy) => (SMILEY_FEATURES.has(`${gx},${gy}`) ? "#2b2417" : "#ffd23f"),
  },
  /* Candy: red diagonal stripes, the landing of the stripe scroll. */
  { id: "candy", board: "#4a1216", edge: "#7e2a30", pin: "#e5484d", pinAt: candyAt },
  { id: "ember", board: "#1c0d08", edge: "#3d1c10", pin: EMBER_ROWS[5], pinAt: (i) => EMBER_ROWS[ROW[i]] },
  { id: "ocean", board: "#081f30", edge: "#164058", pin: OCEAN_ROWS[0], pinAt: (i) => OCEAN_ROWS[ROW[i]] },
  {
    id: "ice",
    board: "#28374a",
    edge: "#3f5266",
    pin: "#bfe3ff",
    pinAt: (i) => (noise(i, 11) > 0.8 ? "#ffffff" : "#bfe3ff"), // a few frozen harder
  },
  { id: "neon", board: "#17081f", edge: "#3d1747", pin: "#ff3ec9" },
  {
    id: "gilded",
    board: "#241a10",
    edge: "#4a3620",
    pin: "#e6b94d",
    pinAt: (i) => (noise(i, 17) > 0.75 ? "#f7df9a" : "#e6b94d"), // uneven, like real leaf
  },
  {
    id: "blossom",
    board: "#2c3626",
    edge: "#465541",
    pin: "#f5aecb",
    pinAt: (i) => (noise(i, 21) > 0.75 ? "#ffe4ef" : "#f5aecb"), // a few open flowers
  },
  {
    id: "starry",
    board: "#101830",
    edge: "#2a3558",
    pin: "#e8ecff",
    pinAt: (i) => (noise(i, 13) > 0.8 ? "#ffd76b" : "#e8ecff"), // two stars burn gold
  },
  {
    /* The one light board in the set -- black stripes vanish on a dark one. */
    id: "bee",
    board: "#57430f",
    edge: "#3d2f0a",
    pin: "#ffd23f",
    pinAt: (i) => (ROW[i] % 2 ? "#191308" : "#ffd23f"),
  },
  /* A pixel heart in the hollow; the cells around it stay bare board. */
  {
    id: "heart",
    board: "#341620",
    edge: "#552437",
    pin: "#f7a6b8",
    flesh: (gx, gy) => (HEART_CELLS.has(`${gx},${gy}`) ? "#e5486b" : null),
  },
  {
    id: "checker",
    board: "#5a6472",
    edge: "#39414c",
    pin: "#f3f4f6",
    pinAt: (i) => ((COL[i] + ROW[i]) % 2 ? "#111827" : "#f3f4f6"),
  },
  { id: "sunset", board: "#1d1430", edge: "#3a2a55", pin: SUNSET_ROWS[5], pinAt: (i) => SUNSET_ROWS[ROW[i]] },
  {
    id: "disco",
    board: "#23252b",
    edge: "#43464f",
    pin: "#dfe3ea",
    pinAt: (i) => ((COL[i] + ROW[i]) % 2 ? "#aab0bc" : "#dfe3ea"), // mirrorball facets
  },
];

const lookNamed = (id: string) => LOOKS.findIndex((l) => l.id === id);

/* ---- the walk around the C ----------------------------------------- *
 * A chase needs the pins in STROKE order, not the row-major order they're
 * built in. Derived rather than listed: sort by angle from the center,
 * then rotate the sequence to start after the widest angular gap -- which,
 * on a C, is its mouth. Any ring-ish GRID gets a sensible walk for free. */
const CENTRE = SPAN / 2;
const BY_ANGLE = PINS.map((p, i) => ({ i, a: Math.atan2(p.y - CENTRE, p.x - CENTRE) })).sort(
  (m, n) => m.a - n.a,
);
const MOUTH = (() => {
  let at = 0;
  let widest = -1;
  for (let k = 0; k < BY_ANGLE.length; k++) {
    const prev = BY_ANGLE[(k - 1 + BY_ANGLE.length) % BY_ANGLE.length].a;
    let gap = BY_ANGLE[k].a - prev;
    if (gap < 0) gap += Math.PI * 2;
    if (gap > widest) {
      widest = gap;
      at = k;
    }
  }
  return at;
})();
/* SEAT[pinIndex] = how far along the C's stroke that pin sits. */
const SEAT: number[] = [];
BY_ANGLE.slice(MOUTH).concat(BY_ANGLE.slice(0, MOUTH)).forEach((e, k) => (SEAT[e.i] = k));
const SEATS = PINS.length;

/* ---- routines ------------------------------------------------------- *
 * What the pins do between the click and the landing. Every routine names
 * its landing (lookNamed, never an index, so reordering LOOKS can't
 * silently repoint one) and plays TOWARD it -- the last frame should sit a
 * breath away from the look it settles into. */

/* The throwaway palette repin flashes through. Deliberately not colors
 * from the LOOKS -- it should read as "cycling", not as a slideshow. */
const FLICKER = ["#cfe3f4", "#8ec5ff", "#7fe3c0", "#f2b134", "#ff9d86", "#ffffff"];
const PRIDE = ["#e40303", "#ff8c00", "#ffed00", "#008026", "#24408e", "#732982"];
/* What the pinboard designer offers for a pin (ui/PinboardDesigner.tsx). */
export const PIN_PALETTE = Array.from(new Set([...FLICKER, ...PRIDE, ...ROYGBV, "#000000", "#9ec5ff"]));

const ROUTINE_MS = 620;
const TICK_MS = 70;

/* Deterministic noise: the steppy routines must look the same from one
 * animation frame to the next and only change when their own step does,
 * or they'd re-roll 60 times a second and read as mush. */
function noise(a: number, b: number): number {
  let h = Math.imul(a * 374761393 + b * 668265263, 1274126177);
  h ^= h >>> 15;
  return ((h >>> 0) % 10000) / 10000;
}

interface Routine {
  id: string;
  /* colors for every pin at progress `t` (0..1), in PIN order */
  frame: (t: number) => string[];
  /* the colorway it lands on -- every routine is paired with one */
  lands: number;
}

/* Colors chasing each other around the stroke. The band advances by SEATS
 * twice over the routine, so it reads as travel rather than a flicker. */
const chase = (id: string, palette: string[], lands: number): Routine => ({
  id,
  lands,
  frame: (t) => {
    const step = Math.floor(t * SEATS * 2);
    return PINS.map(
      (_, i) => palette[(((SEAT[i] - step) % palette.length) + palette.length) % palette.length],
    );
  },
});

/* Per-column head start, so the falling routines fall as rain and not as
 * one flat wave. Deterministic, so a column always leads by the same beat. */
const RAIN_LEAD = Array.from({ length: SPAN }, (_, x) => noise(x, 7) * 0.45);

/* A rain of `head` color settling to `trail`, over `dark`. The matrix
 * mechanic, parameterised -- the blossom fall is the same physics in a
 * spring palette. */
const rain = (id: string, head: string, trail: string, dark: string, lands: number): Routine => ({
  id,
  lands,
  frame: (t) =>
    PINS.map((_, i) => {
      const h = (t * 1.45 - RAIN_LEAD[COL[i]]) * SPAN;
      const y = ROW[i];
      if (h >= y + 1) return trail;
      if (h >= y) return head;
      return dark;
    }),
});

/* Unpainted: what a pin shows before a wipe has reached it. */
const UNLIT = "#12141a";

const ROUTINES: Routine[] = [
  {
    /* Repin: the scramble, kept -- but paired now, like everything else.
     * It settles back into the classic Corko colorway, so the flicker
     * reads as the board being re-pinned rather than shuffled away. */
    id: "repin",
    lands: lookNamed("classic"),
    frame: (t) => {
      // quantised to TICK_MS so it stutters like the original interval did
      const step = Math.floor((t * ROUTINE_MS) / TICK_MS);
      return PINS.map((_, i) => FLICKER[Math.floor(noise(i, step) * FLICKER.length)]);
    },
  },
  chase("pride", PRIDE, lookNamed("rainbow")), // the chase settles into the flag
  {
    /* Trans: the flag paints on left to right, so it arrives as its own
     * landing rather than cutting to it. */
    id: "trans",
    lands: lookNamed("trans"),
    frame: (t) => {
      const edge = t * (SPAN + 1);
      return PINS.map((_, i) => (COL[i] < edge ? TRANS_ROWS[ROW[i]] : UNLIT));
    },
  },
  /* Matrix: black to start, then green falls DOWN each column with a
   * bright head and a settled trail, the way the film's code does. By t=1
   * every column has run past the bottom row, which is what makes
   * "resolves to all green" fall out rather than be forced. */
  rain("matrix", "#8affa8", "#22c55e", "#0b1410", lookNamed("matrix")),
  {
    /* Smiley: a warm wave rises from the chin up, and the face pops in as
     * it lands (the features live in FLESH, which only draws settled). */
    id: "smiley",
    lands: lookNamed("smiley"),
    frame: (t) => {
      const cutoff = SPAN - t * (SPAN + 1);
      return PINS.map((_, i) => {
        if (ROW[i] < cutoff) return UNLIT;
        return ROW[i] < cutoff + 1 ? "#fff3b0" : "#ffd23f";
      });
    },
  },
  {
    /* Candy: the stripes scroll diagonally and stop exactly on the
     * landing's banding (the step count is even, so the parity matches). */
    id: "candy",
    lands: lookNamed("candy"),
    frame: (t) => {
      const step = Math.floor(t * 8);
      return PINS.map((_, i) =>
        Math.floor((COL[i] + ROW[i] + step) / 2) % 2 ? "#fff5f5" : "#e5484d",
      );
    },
  },
  {
    /* Fire: each pin flickers through the ember palette, hotter towards
     * the base -- the same gradient the landing freezes in place. */
    id: "fire",
    lands: lookNamed("ember"),
    frame: (t) => {
      const step = Math.floor((t * ROUTINE_MS) / TICK_MS);
      return PINS.map((_, i) => {
        const heat = ((SPAN - 1 - ROW[i]) / (SPAN - 1)) * 0.6 + noise(i, step) * 0.5;
        if (heat > 0.85) return "#fde68a";
        if (heat > 0.65) return "#fbbf24";
        if (heat > 0.45) return "#f97316";
        if (heat > 0.25) return "#dc2626";
        return "#7f1d1d";
      });
    },
  },
  {
    /* Ocean: a foam crest sweeps across twice with a swell behind it;
     * between crests the water sits at the landing's depth bands, so the
     * final frame IS the landing. */
    id: "ocean",
    lands: lookNamed("ocean"),
    frame: (t) => {
      const crest = ((t * 2 * (SPAN + 2)) % (SPAN + 2)) - 1;
      return PINS.map((_, i) => {
        const d = COL[i] - crest;
        if (Math.abs(d) < 0.7) return "#e8f6ff"; // foam
        if (d > -2.2 && d < 0) return "#67e8f9"; // the swell behind it
        return OCEAN_ROWS[ROW[i]];
      });
    },
  },
  {
    /* Ice: pins freeze in a scattered order, each with a white flash at
     * the moment it takes. */
    id: "ice",
    lands: lookNamed("ice"),
    frame: (t) =>
      PINS.map((_, i) => {
        const at = noise(i, 3) * 0.8;
        if (t < at) return "#3a4a5e"; // not yet frozen: dull steel
        if (t < at + 0.12) return "#ffffff"; // the flash
        return noise(i, 11) > 0.8 ? "#ffffff" : "#bfe3ff";
      }),
  },
  {
    /* Neon: the whole sign buzzes -- dropouts early, steadying as the tube
     * warms up, the way a real one does. */
    id: "neon",
    lands: lookNamed("neon"),
    frame: (t) => {
      const step = Math.floor((t * ROUTINE_MS) / TICK_MS);
      const on = noise(step, 5) > 0.75 - t * 0.6;
      return PINS.map(() => (on ? "#ff3ec9" : "#38103a"));
    },
  },
  {
    /* Gilded: a glint chases the stroke over matte gold. */
    id: "gilded",
    lands: lookNamed("gilded"),
    frame: (t) => {
      const head = Math.floor(t * SEATS * 2);
      return PINS.map((_, i) => {
        const d = (((SEAT[i] - head) % SEATS) + SEATS) % SEATS;
        return d < 2 ? "#fff2c4" : "#c9982f";
      });
    },
  },
  /* Blossom: petals fall -- the matrix mechanic in a spring palette. */
  rain("blossom", "#ffd7e8", "#f5aecb", "#20291f", lookNamed("blossom")),
  {
    /* Starry: stars come out one by one, each with a bright twinkle as it
     * appears; a couple settle gold, matching the landing. */
    id: "starry",
    lands: lookNamed("starry"),
    frame: (t) =>
      PINS.map((_, i) => {
        const at = noise(i, 9) * 0.75;
        if (t < at) return "#101830"; // still night
        if (t < at + 0.15) return "#ffffff"; // the twinkle
        return noise(i, 13) > 0.8 ? "#ffd76b" : "#e8ecff";
      }),
  },
  {
    /* Bee: the stripes shimmy up and down, buzzing, and land on the
     * bumblebee banding (six flips -- even -- so the parity matches). */
    id: "bee",
    lands: lookNamed("bee"),
    frame: (t) => {
      const flip = Math.floor(t * 6) % 2;
      return PINS.map((_, i) => ((ROW[i] + flip) % 2 ? "#191308" : "#ffd23f"));
    },
  },
  {
    /* Heartbeat: one lub-dub -- two brightness spikes ~120ms apart -- and
     * the pixel heart appears in the hollow as it lands. */
    id: "heartbeat",
    lands: lookNamed("heart"),
    frame: (t) => {
      const spike = (at: number) => Math.max(0, 1 - Math.abs(t - at) * 9);
      const b = Math.min(1, spike(0.35) + spike(0.55));
      const fill = b > 0.6 ? "#ff4d6d" : b > 0.25 ? "#c23c52" : "#7f1d2d";
      return PINS.map(() => fill);
    },
  },
  {
    /* Checker: the board flips parity back and forth and stops on the
     * landing's (eight flips -- even). */
    id: "checker",
    lands: lookNamed("checker"),
    frame: (t) => {
      const flip = Math.floor(t * 8);
      return PINS.map((_, i) => ((COL[i] + ROW[i] + flip) % 2 ? "#111827" : "#f3f4f6"));
    },
  },
  {
    /* Sunset: dusk pours down from the top, one row at a time. */
    id: "sunset",
    lands: lookNamed("sunset"),
    frame: (t) => {
      const edge = t * (SPAN + 1);
      return PINS.map((_, i) => (ROW[i] < edge ? SUNSET_ROWS[ROW[i]] : UNLIT));
    },
  },
  {
    /* Disco: every pin strobes its own hue off the mirrorball. The one
     * routine allowed to be loud, because the landing is the quietest. */
    id: "disco",
    lands: lookNamed("disco"),
    frame: (t) => {
      const step = Math.floor((t * ROUTINE_MS) / TICK_MS);
      return PINS.map((_, i) => `hsl(${Math.floor(noise(i, step) * 360)} 90% 62%)`);
    },
  },
];

/* Clicks per easter egg. Ten is far enough that nobody trips it by using
 * the thing, and near enough that anyone idly clicking finds it. */
const EGG_EVERY = 10;
/* FIVE QUICK CLICKS open the pinboard designer (owner, 2026-09-04; ten
 * then, five since 2026-09-06): each
 * within this of the last. Ten at a normal pace still get the fly-by. */
const QUICK_MS = 500;
const QUICK_CLICKS = 5; // ten until 2026-09-06 (owner: "5 rapid clicks instead of 10")

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* The three dials, if the mark wants tuning: `size` here, `padding` on
 * .brand-mark, and the pin radius below (0.37 of a grid cell).
 *
 * `egg` gates the every-tenth-click flyby. The access gate shows this same
 * mark and clicking it there still shuffles the colors -- but a login
 * screen launching a "get back to work" plane at someone who hasn't got IN
 * yet is the wrong joke, so the gate passes egg={false} and doesn't count
 * clicks at all. The counter is per instance (a ref), so the topbar mark's
 * ten start from the moment the app mounts either way. */
/* The same PINS in the same cells, whatever the colors: the C against
 * the C, or two designs of one size with the same rows. */
function sameShape(a: MarkDesign | null | undefined, b: MarkDesign | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (sizeOf(a) !== sizeOf(b)) return false;
  const n = sizeOf(a);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if ((a.cells[y]?.[x] === "#") !== (b.cells[y]?.[x] === "#")) return false;
  }
  return true;
}

export function CorkoMark({
  size = 34,
  egg = true,
  preview,
}: {
  size?: number;
  egg?: boolean;
  /* The designer's live preview: draw THIS design, take no clicks. */
  preview?: MarkDesign;
}) {
  /* Opens on whatever the boot splash just landed on, so the logo the
   * fade uncovers is already wearing that colorway (owner, 2026-08-10).
   * Falls back to LOOKS[0] -- which is also what the splash resolves to
   * when it is off or set to the house pairing, so nothing changed for
   * anyone not running "Fun". */
  const [look, setLook] = useState(() => {
    const i = LOOKS.findIndex((l) => l.id === splashLook());
    return i < 0 ? 0 : i;
  });
  /* THE DESIGN THE MARK WEARS (state/mark.ts): the project's override
   * always; otherwise whichever pool arrangement the last click landed
   * on, or none (a built-in look). */
  const shared = useProject().mark;
  const local = useMarkLocal();
  /* A LOCAL override wins (this person's own corner); a shared one
   * stands for everyone else. The shared POOL is discoverable only with
   * "Fun" on (the splash setting), which is the promise the designer's
   * share switch makes; a local pool is always this browser's own. */
  const mark: { override?: MarkDesign; pool: MarkDesign[] } = {
    override: local.override ?? shared?.override,
    pool: [...(settingsFor("").splash === "fun" ? (shared?.pool ?? []) : []), ...(local.pool ?? [])],
  };
  /* Opens on whatever the splash landed on, design included, the same
   * promise the look keeps. */
  const [landedDesign, setLandedDesign] = useState<MarkDesign | null>(() => splashDesign());
  const design = preview ?? mark.override ?? landedDesign;
  /* The splash reads the SHARED state from a local copy at boot (it
   * picks before the doc is loaded), and this is where the copy is kept
   * true -- the mark is mounted whenever a project is open. */
  useEffect(() => {
    if (!preview) rememberShared(shared);
  }, [shared, preview]);
  const [flicker, setFlicker] = useState<string[] | null>(null);
  /* THE SHAPE ROUTINE (owner, 2026-09-06): when the landing changes the
   * pins' SHAPE -- a design to the C, or to another design, grid size
   * included -- the colors alone cannot carry it, and the shape used to
   * snap at the end. So the pins leave one at a time in reverse reading
   * order, the board swaps to the new shape while it is empty (a size
   * change lands on nothing), and the new pins land one at a time in
   * reading order: the splash's rain in miniature. `reveal` is how many
   * pins of the CURRENT shape are on the board; null is all of them. */
  const [reveal, setReveal] = useState<number | null>(null);
  const [flying, setFlying] = useState(false);
  const clicks = useRef(0); // a ref: it drives one event, not the render
  const quick = useRef<number[]>([]); // the last few click times, for the designer
  const raf = useRef(0);

  // never leave a frame loop running behind an unmounted mark
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const play = useCallback(() => {
    if (preview) return;
    // ...and every tenth click, someone gets told off (main app only)
    if (egg) {
      clicks.current += 1;
      const now = performance.now();
      quick.current = [...quick.current, now].slice(-QUICK_CLICKS);
      const fast =
        quick.current.length === QUICK_CLICKS &&
        quick.current.every((t, i) => i === 0 || t - quick.current[i - 1] < QUICK_MS);
      if (fast) {
        quick.current = [];
        pinboardDesigner.open();
      } else if (clicks.current % EGG_EVERY === 0 && !reducedMotion()) {
        setFlying(true);
      }
    }
    /* WHERE THE CLICK LANDS: with an override, always the override; else
     * any built-in look or pool arrangement other than the one showing.
     * The routine is any whose landing is not the look showing, so the
     * animation always visibly goes somewhere. */
    const pool = mark.pool;
    const candidates: { look: number; design: MarkDesign | null }[] = [
      ...LOOKS.map((_, i) => ({ look: i, design: null as MarkDesign | null })).filter(
        (c) => landedDesign || c.look !== look,
      ),
      ...pool.filter((d) => !sameDesign(d, landedDesign)).map((d) => ({ look, design: d as MarkDesign | null })),
    ];
    const pick = mark.override
      ? { look, design: mark.override as MarkDesign | null }
      : candidates[Math.floor(Math.random() * candidates.length)];
    const usable = ROUTINES.filter((r) => pick.design || r.lands !== look);
    const routine = usable[Math.floor(Math.random() * usable.length)];
    const nextLook = pick.design ? look : routine.lands;
    const land = () => {
      setFlicker(null);
      setLook(nextLook);
      setLandedDesign(pick.design);
    };
    if (flicker || reveal !== null || reducedMotion()) {
      cancelAnimationFrame(raf.current);
      setReveal(null);
      land();
      return;
    }
    if (!sameShape(design, pick.design)) {
      const nFrom = (design ? designPins(design) : PINS).length;
      const nTo = (pick.design ? designPins(pick.design) : PINS).length;
      const start = performance.now();
      let landed = false;
      const step = (now: number) => {
        const t = (now - start) / (ROUTINE_MS * 2);
        if (t >= 1) {
          if (!landed) land();
          setReveal(null);
          return;
        }
        if (t < 0.5) setReveal(Math.round(nFrom * (1 - t / 0.5)));
        else {
          if (!landed) {
            landed = true;
            land();
          }
          setReveal(Math.round(nTo * ((t - 0.5) / 0.5)));
        }
        raf.current = requestAnimationFrame(step);
      };
      setReveal(nFrom);
      raf.current = requestAnimationFrame(step);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / ROUTINE_MS;
      if (t >= 1) {
        land();
        return;
      }
      setFlicker(routine.frame(t));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look, flicker, reveal, design, egg, preview, shared, local, landedDesign]);

  const l = LOOKS[look];
  /* THE BOARD COMES FROM THE PAIRING, NOT THE LOOK (owner, 2026-08-10:
   * "match the splash's more up-to-date tint pairing").
   *
   * The eighteen looks were designed as dark-board/light-pin so a 3px
   * dot survives; the splash's pairings are the newer statement, and
   * where they disagree the pairing wins, so the mark and the splash
   * read as one design. The take's OWN tint wins over the table, which
   * is what makes the house pairing (classic over warm cork) reach the
   * logo the fade uncovers. The six looks with no pairing keep their
   * own board. The frame takes a darker cut of whatever won -- the
   * splash's tile edge does exactly the same. */
  /* A design draws its own board, pins and colors; the routines' frames
   * still paint over its pins by index while one plays. */
  const designPinList = design ? designPins(design) : null;
  const paired = design ? null : ((look === lookNamed(splashLook() ?? "") ? splashTint() : null) ?? tintFor(l.id));
  /* IT IS DYED CORK, THE WAY THE SPLASH DYES IT (owner, 2026-08-10 --
   * he put the logo beside the app's own board and the flat swatch read
   * yellower). The splash composites the tint's hue over the cork
   * PHOTO's luminance; the mark was approximating that with a flat
   * color, and an approximation of a photo is exactly what looks wrong
   * next to the photo. So the mark stacks the same three things in CSS:
   *
   *   darken (normal)  <- brings it down to where a 3px pin reads
   *   hue    (color)   <- the pairing's hue, if it has one
   *   cork.jpg         <- the base, so the grain and the real brown
   *
   * `color` takes hue+saturation from the source and LUMINANCE from the
   * backdrop, which is why the darkening has to be its own layer: the
   * blend throws the source's own brightness away.
   *
   * MIX is the one dial, unchanged in meaning: 0 leaves cork at full
   * brightness, 1 takes it to the look's own board luma. 0.5 measured
   * best of the intermediates (see the git history for the table).
   * CORK_LUMA is the photo's measured mean -- rgb(180,139,109). */
  const MIX = 0.5;
  const CORK_LUMA = 148;
  const hue = paired && lumaOf(paired) > 0 ? paired : null;
  /* Cork underneath whenever there IS a pairing -- including the house
   * one, whose tint is "" for PLAIN cork. Only the unpaired looks and
   * the black tints (matrix, disco) keep their own flat board, which is
   * already near-black and has no cork to show. */
  const onCork = paired !== null && !(paired !== "" && lumaOf(paired) === 0);
  const target = CORK_LUMA + (lumaOf(l.board) - CORK_LUMA) * MIX;
  const dark = Math.max(0, Math.min(0.85, 1 - target / CORK_LUMA));
  const layers = [
    `linear-gradient(rgba(0,0,0,${dark.toFixed(3)}), rgba(0,0,0,${dark.toFixed(3)}))`,
    ...(hue ? [`linear-gradient(${hue}, ${hue})`] : []),
    `url(/textures/cork.jpg)`,
  ];
  const corkStyle = {
    backgroundImage: layers.join(", "),
    backgroundBlendMode: hue ? "normal, color, normal" : "normal, normal",
    // a patch of grain rather than a busy crop, at 34px
    backgroundSize: hue ? "auto, auto, 120px" : "auto, 120px",
    // if the texture never loads, fall back to the flat approximation
    backgroundColor: hue ? shade(hue, target / Math.max(1, lumaOf(hue))) : "#7a5f49",
  };
  const edge = hue ? shade(hue, (target / Math.max(1, lumaOf(hue))) * 0.55) : "rgb(72,56,44)";
  return (
    <>
      {flying && (
        <FlyBy
          src="/images/GBTW.png"
          alt="Get back to work"
          width={640}
          onDone={() => setFlying(false)}
        />
      )}
      {/* tip-below + tip-right: the mark sits in the window's top-left
          corner, so a centered above-tip is clipped on BOTH of those
          edges -- point it down and rightward instead */}
      <button
        className={"brand-mark tip-below tip-right" + (flicker ? " spinning" : "") + (preview ? " preview" : "")}
        style={
          design
            ? { width: size, height: size, background: design.board, borderColor: shade(design.board, 0.7) }
            : onCork
              ? { width: size, height: size, ...corkStyle, borderColor: edge }
              : { width: size, height: size, background: l.board, borderColor: l.edge }
        }
        onClick={play}
        data-tip={preview ? undefined : "Repin the board"}
        aria-label={preview ? "The mark, as designed" : "Corko. Click to change the mark's colors."}
        tabIndex={preview ? -1 : undefined}
      >
        <svg
          viewBox={`0 0 ${design ? sizeOf(design) : SPAN} ${design ? sizeOf(design) : SPAN}`}
          width="100%"
          height="100%"
          aria-hidden
          focusable="false"
        >
          {/* the flesh, when a look asks for it -- hidden mid-routine so
              the animation plays on the C alone and the fill lands with
              the pins */}
          {designPinList &&
            designPinList.map((p, i) => (
              <g
                key={"d" + i}
                className={"brand-pin" + (reveal !== null && i >= reveal ? " gone" : "")}
                style={{ transitionDelay: flicker || reveal !== null ? "0ms" : `${i * 22}ms` }}
              >
                <circle
                  cx={p.x + 0.5}
                  cy={p.y + 0.5}
                  r={0.37}
                  fill={flicker?.[i % SEATS] ?? pinColor(design!, p.x, p.y)}
                />
                <circle cx={p.x + 0.39} cy={p.y + 0.38} r={0.11} fill="#fff" opacity={0.5} />
              </g>
            ))}
          {!design &&
            !flicker &&
            reveal === null &&
            l.flesh &&
            FLESH.map((p, k) => {
              const fill = l.flesh!(p.gx, p.gy);
              if (fill === null) return null;
              return (
                <g key={"flesh" + k} className="brand-pin">
                  <circle cx={p.x} cy={p.y} r={0.37} fill={fill} />
                  <circle
                    cx={p.x - 0.11}
                    cy={p.y - 0.12}
                    r={0.11}
                    fill="#fff"
                    opacity={bright(fill) ? 0.5 : 0.18}
                  />
                </g>
              );
            })}
          {!design &&
            PINS.map((p, i) => (
            <g
              key={i}
              className={"brand-pin" + (reveal !== null && i >= reveal ? " gone" : "")}
              /* they land in sequence rather than all at once -- a ripple
                 settling, which is what a handful of pins going in looks like */
              style={{ transitionDelay: flicker || reveal !== null ? "0ms" : `${i * 22}ms` }}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={0.37}
                fill={flicker?.[i] ?? l.pinAt?.(i) ?? l.pin}
              />
              {/* the little catchlight that makes a dot read as a domed pin */}
              <circle cx={p.x - 0.11} cy={p.y - 0.12} r={0.11} fill="#fff" opacity={0.5} />
            </g>
            ))}
        </svg>
      </button>
    </>
  );
}
