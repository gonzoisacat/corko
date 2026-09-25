import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ *
 *  Local view preferences (spec Sec 7 look-and-feel knobs). These are
 *  per-browser and NOT part of the shared Yjs doc -- one collaborator's
 *  square corners shouldn't square everyone else's. Persisted to
 *  localStorage; surfaced through the options menu. Same external-store
 *  pattern as board/drag.ts and state/sync.
 *
 *  PER BOARD as of 2026-08-03 (owner's ask), in two layers:
 *
 *      your DEFAULTS  (one set, `corko-settings`)
 *    + this board's TWEAKS (sparse, `corko-board-settings`)
 *
 *  so a board can be cork and another slate and you know which is which
 *  at a glance -- which is the whole point, and only pays off because the
 *  split view can show two at once.
 *
 *  The tweaks are a LIVE layer, not a snapshot (owner's call: "one
 *  default per user makes sense instead of saving/loading lots of options
 *  which will barely get used"). So a brand-new board simply looks like
 *  your defaults with nothing to press, and the two buttons in Options
 *  mean exactly what they say: save this board's look as your defaults,
 *  or drop this board's tweaks and go back to them.
 *
 *  The old `corko-settings` key keeps its shape and becomes the defaults,
 *  so every existing browser carries its look over with no migration.
 * ------------------------------------------------------------------ */

export type CardFont = "sans" | "marker" | "bitcount";
/* default = the off-white dot grid; slate = dark dot grid; cork = photo;
 * custom = a flat user-picked color (customBg). "white" was retired --
 * legacy saves normalize to custom #ffffff. */
export type BoardBg = "default" | "slate" | "cork" | "custom";

/* NOTE: row wrapping (maxRowBeats) and card spacing moved to the BOARD
 * (state/types.ts Board) -- they shape how a board reads, so every
 * collaborator sees the same values. */
export interface Settings {
  roundedCorners: boolean;
  overviewBeatText: boolean; // render beat titles in the Overview (not just color)
  overviewPreviewScale: number; // Overview hover-card size, 0.33 (min) .. 1 (max/default)
  /* YOUR backdrop. Since 2026-09-05 a board carries its own, shared
   * (Board.look); this one is your OVERRIDE of it, shown when
   * `overrideBackdrop` is on and ONLY then (owner, 2026-09-10: the
   * toggle should "only apply changes as a UI change and only when on
   * and not mess with the board's shared settings"). It used to show on
   * an undressed board too, whatever the switch said, which is what
   * made the switch look broken. */
  boardBg: BoardBg; // board backdrop: lite grid, dark grid, cork, or custom flat
  /* THE BACKDROP OVERRIDE (owner, 2026-09-05: "a global override sounds
   * elegant"): ignore every board's shared backdrop and show yours.
   * Global, since it is about you and not a board; the door is the
   * Overrides button by the steering wheel (board/OverridesMenu.tsx).
   * Stored as `lookMine` in browsers from the first draft; normalize
   * carries it over. */
  overrideBackdrop: boolean;
  customBg: string; // the flat color used when boardBg === "custom"
  customGrain: boolean; // blend the cork grain texture over the custom color
  cardTilt: boolean; // slight random cant on cards (corkboard feel)
  pushpins: boolean; // fake pushpin at the top of each card
  pushpinColor: string; // pin color hex, or "random" for a per-card hue
  liftedShadow: boolean; // curved drop shadow, cards floating off the board
  /* THE BOARD FRAME (board/frame.ts): a cosmetic edge around a typed
   * board with a wall outside it. Per board, per browser, like the
   * rest of the look. `wallImage` is a key into the local wall store
   * (state/blobStore.ts wallBlobs), "" for none. */
  /* THE LEGEND ROLLED UP (owner, 2026-09-04): its three rows hidden
   * behind a chevron; the wheel and Connections mode stay. */
  legendCollapsed: boolean;
  frame: boolean;
  frameStyle: FrameStyle;
  frameScale: number; // the band's thickness, 1..6 times its material's base
  framePad: number; // the cork margin, 0..6 times the half-a-card rule (board/frame.ts)
  wallColor: string;
  wallImage: string;
  /* The green dot marking cards that carry notes -- in every view, not
   * just detail. Local, because it's about how YOU want to read the board:
   * the person clearing notes wants it on, someone laying out a cut may
   * not. */
  noteDots: boolean;
  /* CARD IMAGES on or off for this board (owner, 2026-09-08): off hides
   * every card's picture and, on those cards, the text treatment that
   * came with it (their per-card text overrides), so the card reads as
   * its tier's plain face. Per board per browser, like noteDots; the
   * pictures themselves are untouched. The switch sits in the legend's
   * corner group (board/CardImagesToggle.tsx). */
  cardImages: CardImages;
  /* Who you are, for notes you write. Per BROWSER on purpose: the author
   * is a property of the person at this keyboard, not of the project, and
   * there are no accounts yet (spec Phase 7). Fill it once on your first
   * note and every note you write afterwards is pre-attributed. */
  noteAuthor: string;
  /* HOW A NEW PICTURE SITS (owner, 2026-09-08: "a 'set as default'
   * button ... it'll remember 'fill' or 'fit' and the subsettings"):
   * the fit, tiling, mirroring and alignment stamped on every picture
   * added from here on -- a file picked, dropped or grabbed. GLOBAL: how
   * you like pictures to land, not a board's property. */
  /* THE REMEMBERED SIT, PER TIER (owner, 2026-09-09: "it should be per
   * tier"). Keyed by the tier's own id, so "my scene cards look like
   * this" travels between boards built from the same ladder while beats
   * keep their own answer. Still a GLOBAL key: it is a preference about
   * you, not about a board. An absent tier falls back to
   * DEFAULT_IMAGE_SIT, which is what every tier did before this. */
  imageSits: Record<string, ImageSit>;
  /* THE NOTES EXPORT'S COLUMNS (owner, 2026-09-09), PER BOARD, because
   * the metadata half of the list is the board's own. Two lists rather
   * than one: `notesColumns` is the ARRANGEMENT and `notesColumnsOff`
   * is what is switched off, so a column the board gains later appears
   * (appended, on) instead of being hidden by its absence from a stored
   * list. Empty means the natural order with everything on. */
  notesColumns: string[];
  notesColumnsOff: string[];
  /* Outline color for selected cards, in BOTH views. Local per browser:
   * which color reads for you on your board is a view preference, not
   * board data. Deliberately vivid by default -- at Overview zoom a
   * selection is a few pixels of edge, and the old navy sat too close to
   * the lavender scene cards to find. */
  selectionColor: string;
  /* Dark chrome: menus, panels, the legend and the bars. NOT the board --
   * the board has its own backdrop (`boardBg`), and the two are different
   * questions. You might well want a dark UI around a cork board.
   *
   * GLOBAL rather than per board, unlike every other look key: this is
   * about the app you are sitting in front of, not about one cut. Nobody
   * wants their menus to change color when they switch boards. */
  uiTheme: UiTheme;
  /* Whether hover tooltips (the data-tip labels) show at all. GLOBAL,
   * like uiTheme and for the same reason: once you know the app, the
   * labels are noise, and that is true of every board at once. Off only
   * hides the VISUAL -- aria-labels keep every control named. */
  tooltips: boolean;
  /* The boot splash, in three states rather than two:
   *   on   -- the house pairing, the same calm take every load
   *   off  -- no splash; the app appears directly
   *   fun  -- a different colorway from the pool each load
   * GLOBAL -- it is about the person at the keyboard, not one cut.
   * (A `bootSound` key once sat beside it; the jingle was cut outright
   * 2026-09-21 and a stored value is simply ignored.) */
  splash: SplashMode;
  /* How the Boards menu orders this project's boards, and which way.
   *
   * ALPHABETICAL by default: a version shelf is something you look up by
   * NAME, and creation order only helps while you still remember when you
   * made a thing -- which stops being true at about the size that makes
   * the menu worth sorting.
   *
   * GLOBAL (see GLOBAL_KEYS), like uiTheme and for the same reason: how
   * you like a list sorted is about you, not about whichever board
   * happens to be open, and having it change under you when you switch
   * panels would be absurd. */
  boardSort: BoardSort;
  boardSortDir: SortDir;
  /* NOTES VIEW AT FULL WIDTH (owner, 2026-09-06): the notes column takes
   * the window and reads as his spreadsheet -- a row per note, columns
   * for the card, the author, the note, the implementation note and
   * the state. GLOBAL: it is how you like to work notes, not a board's
   * property. board/NotesPanel.tsx. */
  notesWide: boolean;
  /* What the Notes filters do with the notes they pass over (owner,
   * 2026-09-07): COLLAPSE them to one dimmed line each, so the list
   * keeps the whole board in cut order and a note never vanishes under
   * your hand, or HIDE them as filters usually do. One setting for all
   * the filters ("either applies to all"). GLOBAL, like notesWide. */
  notesFiltered: "collapse" | "hide";
  /* THE METADATA PANEL IS PINNED (owner, 2026-09-10): parked on top --
   * a click on the board or in the other panel no longer takes it down --
   * and FOLLOWING the selection, so it shows whichever card you are on.
   * GLOBAL (see GLOBAL_KEYS): it is a way of working, not a property of
   * a board -- you are either using the panel as an inspector or you are
   * not, and having it pinned on one board and loose on the next would
   * be a surprise every time you switched. */
  metaPinned: boolean;
  /* THE TIMECODE CALCULATOR pinned, like the metadata panel and for the
   * same reason -- it is a tool you work under. GLOBAL: whether you keep
   * a calculator open is about you, not about a board. */
  tcPinned: boolean;
  /* ...and its RATE, which is NOT global: a cut has a rate, and moving
   * to another board should not bring the last one's along. Empty means
   * "follow this board's player", which is where the rate is already
   * stated (state/playerPrefs.ts) and usually detected from the file --
   * so the calculator agrees with the transport without being welded to
   * it, and picking a rate here stops it following. */
  tcRate: string;
}

export type UiTheme = "light" | "dark";
export type ImageCorner = "tl" | "tr" | "bl" | "br";
export interface ImageSit {
  fit: "fill" | "fit" | "side";
  tile: boolean;
  mirror: boolean;
  align: string; // "<horizontal> <vertical>", object-position order
  corner: ImageCorner; // the Corner mode's corner
  /* the TEXT POSITION a new picture's words take (owner, 2026-09-08:
   * "the text orientation override is not committing with the 'Set
   * defaults' option"): "" is centered. The app's own default is the
   * photo caption's bottom, which adding a picture writes. */
  titleAlign: "" | "top" | "bottom";
}
export const DEFAULT_IMAGE_SIT: ImageSit = {
  fit: "fill",
  tile: false,
  mirror: false,
  align: "center center",
  corner: "br",
  titleAlign: "bottom",
};
export const readImageSit = (v: unknown): ImageSit => {
  const o = (v && typeof v === "object" ? v : {}) as Partial<ImageSit>;
  return {
    fit: o.fit === "fit" || o.fit === "side" ? o.fit : "fill",
    tile: o.tile === true,
    mirror: o.mirror === true,
    align: typeof o.align === "string" && o.align ? o.align : "center center",
    corner: o.corner === "tl" || o.corner === "tr" || o.corner === "bl" ? o.corner : "br",
    titleAlign: o.titleAlign === "top" || o.titleAlign === "" ? o.titleAlign : "bottom",
  };
};
export const sameSit = (a: ImageSit, b: ImageSit): boolean =>
  a.fit === b.fit &&
  a.tile === b.tile &&
  a.mirror === b.mirror &&
  a.align === b.align &&
  a.corner === b.corner &&
  a.titleAlign === b.titleAlign;
/* THE IMAGES SWITCH'S THREE STATES (owner, 2026-09-08): on -- pictures
 * and words; only -- "no words, just images", a card with a picture
 * hides its title and keeps its overlays (tags, dots, pins, values); off
 * -- no pictures, and a pictured card's text overrides with them. The
 * switch cycles on -> only -> off. */
export type CardImages = "on" | "only" | "off";
export const readCardImages = (v: unknown): CardImages =>
  v === "only" ? "only" : v === false || v === "off" ? "off" : "on";
export type FrameStyle = "aluminum" | "wood";
export const FRAME_SCALE_MIN = 1;
export const FRAME_SCALE_MAX = 6;
export const FRAME_PAD_MIN = 0;
export const FRAME_PAD_MAX = 6;
export type SplashMode = "on" | "off" | "fun";
export type BoardSort = "alpha" | "time";
export type SortDir = "asc" | "desc";

/* The keys that are about YOU rather than about a board, so they never go
 * in a per-board layer: your name is your name on every board. Everything
 * else is look, and look is what wants to differ. */
const GLOBAL_KEYS = new Set<keyof Settings>([
  "noteAuthor",
  "imageSits",
  "uiTheme",
  "tooltips",
  "splash",
  "boardSort",
  "boardSortDir",
  "overrideBackdrop",
  "notesWide",
  "notesFiltered",
  "metaPinned",
  "tcPinned",
]);
export const isGlobalSetting = (k: keyof Settings): boolean => GLOBAL_KEYS.has(k);

/* Teal (owner's pick): it has to survive being a couple of pixels of
 * edge on a small card at Overview zoom, over cork, pale yellow,
 * lavender AND a black band. The old navy managed none of that; pink
 * did but sat close to the lavender scene tier. Change it per browser
 * in Options -- "Selected card highlight". */
export const DEFAULT_SELECTION = "#53f9f3";

/* A fresh browser starts on TACTILE (owner's call, 2026-08-02): cork,
 * square corners, tilt, random pushpins, lifted shadow. These keys are
 * LOOKS[0].apply -- keep the two in step, or the Look row will open with
 * nothing highlighted on a first run (matchesLook is an exact match, by
 * design). Only a browser with no stored settings sees this; nobody's
 * saved view changes. */
const DEFAULTS: Settings = {
  roundedCorners: false,
  uiTheme: "light",
  tooltips: true,
  splash: "on",
  boardSort: "alpha",
  boardSortDir: "asc",
  overviewBeatText: false,
  overviewPreviewScale: 1,
  boardBg: "cork",
  overrideBackdrop: false,
  notesWide: false,
  notesFiltered: "collapse",
  metaPinned: false,
  tcPinned: false,
  tcRate: "",
  customBg: "#e8e6df",
  customGrain: false,
  cardTilt: true,
  pushpins: true,
  pushpinColor: "random",
  liftedShadow: true,
  legendCollapsed: false,
  frame: false,
  frameStyle: "aluminum",
  frameScale: 1,
  framePad: 1,
  wallColor: "#d8d4cb",
  wallImage: "",
  noteDots: true,
  cardImages: "on",
  noteAuthor: "",
  imageSits: {},
  notesColumns: [],
  notesColumnsOff: [],
  selectionColor: DEFAULT_SELECTION,
};

const KEY = "corko-settings"; // your defaults (the pre-per-board key, unchanged)
const BOARD_KEY = "corko-board-settings"; // { boardId: the tweaks on that board }

function normalize(s: Settings): Settings {
  // the pure-white option was retired; old saves become custom white
  if ((s.boardBg as string) === "white") {
    s.boardBg = "custom";
    s.customBg = "#ffffff";
  }
  if (!["default", "slate", "cork", "custom"].includes(s.boardBg)) s.boardBg = "default";
  // every browser that predates dark chrome has no uiTheme, and means light
  if (s.uiTheme !== "dark") s.uiTheme = "light";
  // absent (pre-toggle browsers) means ON -- only an explicit false hides
  if (s.tooltips !== false) s.tooltips = true;
  // absent (pre-toggle browsers) means the house take, not silence
  if (s.splash !== "off" && s.splash !== "fun") s.splash = "on";
  // a stored value from a future/older build must not be able to wedge the
  // Boards menu into an ordering nothing can express
  if (s.boardSort !== "time") s.boardSort = "alpha";
  if (s.boardSortDir !== "desc") s.boardSortDir = "asc";
  // the first draft called the override "Mine"; a stored `lookMine` carries over
  const legacy = s as Settings & { lookMine?: boolean };
  if (legacy.lookMine === true) s.overrideBackdrop = true;
  delete legacy.lookMine;
  if (s.overrideBackdrop !== true) s.overrideBackdrop = false;
  if (s.notesWide !== true) s.notesWide = false;
  // a boolean from the switch's first day reads as on / off
  s.cardImages = readCardImages(s.cardImages);
  {
    // one stored sit per tier, each read through the same guard; a
    // pre-2026-09-09 browser had ONE global sit and it is simply dropped,
    // being a convenience preference rather than anything of anyone's
    const raw = s.imageSits as unknown;
    const out: Record<string, ImageSit> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = readImageSit(v);
    }
    s.imageSits = out;
  }
  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
  s.notesColumns = ids(s.notesColumns);
  s.notesColumnsOff = ids(s.notesColumnsOff);
  if (s.notesFiltered !== "hide") s.notesFiltered = "collapse";
  // absent (and anything but true) means loose, which is how it has always been
  if (s.metaPinned !== true) s.metaPinned = false;
  if (s.tcPinned !== true) s.tcPinned = false;
  if (typeof s.tcRate !== "string") s.tcRate = "";
  // absent means open, as every legend ever was
  if (s.legendCollapsed !== true) s.legendCollapsed = false;
  // the frame: absent (pre-frame browsers) means off, in aluminum
  if (s.frame !== true) s.frame = false;
  if (s.frameStyle !== "wood") s.frameStyle = "aluminum";
  if (typeof s.frameScale !== "number" || !Number.isFinite(s.frameScale)) s.frameScale = 1;
  s.frameScale = Math.max(FRAME_SCALE_MIN, Math.min(FRAME_SCALE_MAX, s.frameScale));
  if (typeof s.framePad !== "number" || !Number.isFinite(s.framePad)) s.framePad = 1;
  s.framePad = Math.max(FRAME_PAD_MIN, Math.min(FRAME_PAD_MAX, s.framePad));
  if (typeof s.wallColor !== "string" || !/^#[0-9a-f]{6}$/i.test(s.wallColor)) s.wallColor = DEFAULTS.wallColor;
  if (typeof s.wallImage !== "string") s.wallImage = "";
  return s;
}

function loadDefaults(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) });
  } catch {
    /* ignore malformed / unavailable storage */
  }
  return { ...DEFAULTS };
}

function loadOverrides(): Record<string, Partial<Settings>> {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, Partial<Settings>>;
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    /* ignore */
  }
  return {};
}

let defaults: Settings = loadDefaults();
let overrides: Record<string, Partial<Settings>> = loadOverrides();
const listeners = new Set<() => void>();

/* Resolved settings are handed to every card through the pane's context
 * (board/context.ts), so they MUST be identity-stable or every card in an
 * unvirtualized Overview re-renders on any unrelated change. Cached per
 * board and invalidated wholesale by a version counter -- writes are rare
 * (a human moving a slider), reads are constant. */
let version = 0;
const cache = new Map<string, { v: number; value: Settings }>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(defaults));
    // don't keep empty tweak objects around for boards that are back on
    // the defaults -- they'd accumulate one per board ever visited
    const trimmed: Record<string, Partial<Settings>> = {};
    for (const [id, patch] of Object.entries(overrides)) {
      if (patch && Object.keys(patch).length) trimmed[id] = patch;
    }
    overrides = trimmed;
    localStorage.setItem(BOARD_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

function changed() {
  version++;
  cache.clear();
  persist();
  listeners.forEach((l) => l());
}

/* This board's effective look: your defaults with its own tweaks on top.
 * An empty boardId (a pane with no board, the New-board modal) is just
 * the defaults, which is also what a board with no tweaks resolves to. */
export function settingsFor(boardId: string): Settings {
  const hit = cache.get(boardId);
  if (hit && hit.v === version) return hit.value;
  const patch = boardId ? overrides[boardId] : undefined;
  const value = patch ? normalize({ ...defaults, ...patch }) : defaults;
  cache.set(boardId, { v: version, value });
  return value;
}

/* Set one key. A GLOBAL key (your name) always lands in the defaults
 * however it was reached; everything else tweaks this board alone --
 * unless boardId is empty, which means "edit my defaults directly" (the
 * New-board modal's Look row, where there is no board yet). */
export function setSetting<K extends keyof Settings>(
  boardId: string,
  key: K,
  value: Settings[K],
): void {
  if (!boardId || isGlobalSetting(key)) {
    defaults = { ...defaults, [key]: value };
  } else {
    const patch = { ...(overrides[boardId] ?? {}), [key]: value };
    // a tweak that matches the default isn't a tweak
    if (patch[key] === defaults[key]) delete patch[key];
    overrides = { ...overrides, [boardId]: patch };
  }
  changed();
}

/* "Save as my defaults": this board's look becomes what every untweaked
 * board shows. Its own tweaks go with it -- they are the defaults now, so
 * keeping them would be a layer that changes nothing. */
export function saveAsDefaults(boardId: string): void {
  defaults = { ...settingsFor(boardId) };
  const next = { ...overrides };
  delete next[boardId];
  overrides = next;
  changed();
}

/* "Reset to my defaults": drop this board's tweaks. */
export function resetToDefaults(boardId: string): void {
  if (!boardId || !overrides[boardId]) return;
  const next = { ...overrides };
  delete next[boardId];
  overrides = next;
  changed();
}

/* Whether this board differs from your defaults at all -- drives whether
 * the Reset button is worth offering. */
export function hasTweaks(boardId: string): boolean {
  return Boolean(boardId && overrides[boardId] && Object.keys(overrides[boardId]).length > 0);
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/* Subscribe to a board's effective settings. Prefer reading them off the
 * pane context (board/context.ts) inside the row tree: the Overview is not
 * virtualized, so a subscription per CARD is thousands of subscriptions --
 * the same reason `tags` and `noteDots` are threaded rather than read. */
export function useSettings(boardId = ""): Settings {
  return useSyncExternalStore(
    subscribe,
    () => settingsFor(boardId),
    () => DEFAULTS,
  );
}

/* ---- look presets -------------------------------------------------- *
 * One-click bundles of the look-defining settings. A preset only sets
 * the keys it names (spacing, counts etc. are left alone), and the user
 * can keep dialing individual toggles afterward -- the preset simply
 * stops matching. */

export interface LookPreset {
  id: string;
  label: string;
  apply: Partial<Settings>;
}

/* Tactile leads (owner's call, 2026-08-02) because it IS the default now
 * -- DEFAULTS below is its `apply` -- and a row whose first entry isn't
 * the one you're looking at reads as a list you have to shop through. */
export const LOOKS: LookPreset[] = [
  {
    id: "tactile",
    label: "Tactile",
    /* No backdrop in a preset since 2026-09-05: the backdrop is the
     * BOARD's now (Board.look), and a preset that repainted a shared
     * board would be a surprise for everyone else on it. */
    apply: {
      roundedCorners: false, // square notecard corners
      cardTilt: true,
      pushpins: true,
      pushpinColor: "random",
      liftedShadow: true,
    },
  },
  {
    id: "modern-lite",
    label: "Modern Lite",
    apply: { roundedCorners: true, cardTilt: false, pushpins: false, liftedShadow: false },
  },
  {
    id: "modern-dark",
    label: "Modern Dark",
    apply: { roundedCorners: true, cardTilt: false, pushpins: false, liftedShadow: false },
  },
];

export function applyLook(boardId: string, look: LookPreset): void {
  for (const [k, v] of Object.entries(look.apply)) {
    setSetting(boardId, k as keyof Settings, v as Settings[keyof Settings]);
  }
}

/* Whether the current settings exactly match a preset's keys (drives the
 * active highlight; a hand-tweaked look matches nothing, by design). */
export function matchesLook(s: Settings, look: LookPreset): boolean {
  return Object.entries(look.apply).every(([k, v]) => s[k as keyof Settings] === v);
}
