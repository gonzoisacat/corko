/* The default color legend, carried over verbatim from the prototype so
 * the visual language is preserved. A node's `color` field stores a legend
 * entry's `id`. The legend is now user-editable and lives on the board
 * (see ydoc.ts / types.ts LegendEntry); this is just the seed + resolver. */

import type { LegendEntry, LevelDef } from "./state/types";

export type ColorKey = "yellow" | "blue" | "green" | "pink" | "orange";

export const COLORS: Record<ColorKey, { bg: string; border: string; label: string }> = {
  yellow: { bg: "#fcecad", border: "#efd98a", label: "Beat" },
  blue: { bg: "#cfe3f4", border: "#a9cbe8", label: "B-roll / visual" },
  green: { bg: "#cdebcd", border: "#a6d8a6", label: "Confirmed" },
  pink: { bg: "#f6cfe1", border: "#eeb0cd", label: "Needs review" },
  orange: { bg: "#fbd8a9", border: "#f1c082", label: "Music / archival" },
};

export const COLOR_ORDER: ColorKey[] = ["yellow", "blue", "green", "pink", "orange"];

/* Seed fill for a tier's default color, by position/variant in the ladder:
 * leaf = card yellow, leaf-parent = scene lavender, section-variant = dark,
 * other swimlanes (reel) = light. These are just starting points -- every
 * tier default is editable in the legend / via the tier gear. */
function tierSeedColor(level: LevelDef, depth: number, leaf: number): string {
  if (depth === leaf) return "#fcecad"; // leaf card
  if (depth === leaf - 1) return "#e7c8f7"; // leaf-parent (scene)
  if (level.variant === "section") return "#1c1d22"; // dark divider
  return "#efeee9"; // reel / light swimlane
}

/* What a tier's default-color swatch is CALLED: its name, plus its
 * descriptor in parentheses when it has one ("Scene (Linear)"). One
 * definition, because two ops write this label -- renaming the tier and
 * editing the descriptor -- and they must agree. */
export const tierLabel = (name: string, descriptor?: string): string => {
  const d = (descriptor ?? "").trim();
  return d ? `${name} (${d})` : name;
};

/* The default color entry for one tier (id `tier:<levelId>`, label = the
 * tier name). Editable afterward like any legend entry. */
export function tierDefaultFor(levels: LevelDef[], levelId: string): LegendEntry {
  const leaf = levels.length - 1;
  const i = levels.findIndex((l) => l.id === levelId);
  const l = levels[i];
  const bg = tierSeedColor(l, i, leaf);
  return {
    id: "tier:" + levelId,
    label: l ? tierLabel(l.name, l.descriptor) : "",
    bg,
    border: deriveBorder(bg),
    tier: levelId,
  };
}

/* Seed legend for a board on `levels`: one tier-bound default per tier
 * (the Defaults row) + a few free "option" presets (the Options row). */
/* The fill for a card standing in for another board. A DEFAULT that
 * lives in the legend's Color Overrides row -- see LegendBar for why
 * that row rather than beside the tiers.
 *
 * THE SAME COLOR ON EVERY BOARD, WHATEVER PALETTE IT WAS MADE WITH
 * (owner, 2026-08-24; the value is his). That is already true by
 * construction rather than by care: a palette is applied through
 * `ops.setTierColor`, which matches on an entry's `tier`, and this entry
 * has none -- so Pastel/Bold/Earthy/Mono cannot reach it. Worth stating
 * because the property is load-bearing: a nesting card can be dragged to
 * any tier on any board, so its color is the one thing about it that
 * must not shift underfoot.
 *
 * It is still a legend entry like any other, so it is renamed and
 * recolored per board in the legend -- this is only the seed. */
export const NESTED_ENTRY_ID = "role:nested";
const NESTED_BG = "#adffb3"; // rgb(173, 255, 179)
export const nestedDefault = (): LegendEntry => ({
  id: NESTED_ENTRY_ID,
  label: "Nested boards",
  bg: NESTED_BG,
  border: deriveBorder(NESTED_BG),
  role: "nested",
});

/* Which of COLORS a NEW board ships as ready-made overrides.
 *
 * NONE (owner, 2026-08-24). It used to be four -- B-roll, Confirmed,
 * Needs review, Music/archival -- which is somebody else's vocabulary
 * handed over as a fait accompli, the same objection that purged the
 * sample content from seed.ts.
 *
 * One was kept briefly as a worked example, on the reasoning that an
 * empty row cannot demonstrate that a swatch is a thing you NAME. The
 * owner's correction: the row is not empty. The nesting fill sits in it,
 * so there is already a swatch to look at, and the hint beside + Add
 * says what the row is for in words. Existing boards keep whatever they
 * have -- this is the seed, and nothing prunes a legend after the
 * fact. */
const STARTER_OPTIONS: ColorKey[] = [];

export function defaultLegend(levels: LevelDef[]): LegendEntry[] {
  const tiers = levels.map((l) => tierDefaultFor(levels, l.id));
  const options: LegendEntry[] = STARTER_OPTIONS.map((k) => ({
    id: k,
    label: COLORS[k].label,
    bg: COLORS[k].bg,
    border: COLORS[k].border,
  }));
  /* The nesting fill goes LAST, after the options. It shares the Color
   * Overrides row with them but is not one of them -- it is a default
   * nobody chose -- so it sits at the end of the list you are building
   * rather than at its head. That is also where `ensureTierDefaults`
   * appends it on a board that predates it, so old and new boards read
   * the same way round. */
  return [...tiers, ...options, nestedDefault()];
}

/* Resolve an explicit `color` id to a fill/border via the legend. Falls back
 * to the first entry when the id is missing. */
export function resolveColor(
  legend: LegendEntry[],
  id: string | undefined,
): { bg: string; border: string } {
  const found = id ? legend.find((e) => e.id === id) : undefined;
  const entry = found ?? legend[0];
  if (entry) return { bg: entry.bg, border: entry.border };
  return { bg: COLORS.yellow.bg, border: COLORS.yellow.border };
}

/* Which legend ENTRY paints a node: its explicit color if that id still
 * resolves, else its tier's default color (the entry bound to `levelId`),
 * else the first entry. The two resolvers below both read off this, so a
 * card's fill and the id it advertises can never disagree. */
export function resolveNodeEntry(
  legend: LegendEntry[],
  colorId: string | undefined,
  levelId: string,
  /* This card stands in for another board (state/nesting.ts `isNested`).
   * It takes the NESTED default instead of its tier's, because a nesting
   * card can be dragged to any tier -- a color that followed the tier
   * would repaint on every drop. An explicit per-card color still wins,
   * exactly as it wins over a tier default. */
  nested = false,
): LegendEntry | undefined {
  if (colorId) {
    const found = legend.find((e) => e.id === colorId);
    if (found) return found;
  }
  if (nested) {
    const own = legend.find((e) => e.role === "nested");
    if (own) return own;
  }
  return legend.find((e) => e.tier === levelId) ?? legend[0];
}

/* A node's effective fill. */
export function resolveNodeColor(
  legend: LegendEntry[],
  colorId: string | undefined,
  levelId: string,
  nested = false,
): { bg: string; border: string } {
  const entry = resolveNodeEntry(legend, colorId, levelId, nested);
  if (entry) return { bg: entry.bg, border: entry.border };
  return { bg: COLORS.yellow.bg, border: COLORS.yellow.border };
}

/* The same resolution, as an id: what the render layer stamps on a card as
 * `data-color`, so hovering a legend swatch can light every card that
 * entry paints -- including the cards merely INHERITING it as their tier
 * default -- with one injected CSS rule and no React pass
 * (board/legendHighlight.ts).
 *
 * The fallback is the conventional tier-default id, for a board whose
 * legend hasn't been seeded yet: it matches no swatch, which is correct,
 * because there is no swatch to match. */
export function resolveNodeColorId(
  legend: LegendEntry[],
  colorId: string | undefined,
  levelId: string,
  nested = false,
): string {
  return resolveNodeEntry(legend, colorId, levelId, nested)?.id ?? "tier:" + levelId;
}

/* ---- tier colorway palettes ---------------------------------------- *
 * A palette assigns fills by ROLE in the ladder, mirroring tierSeedColor:
 * leaf cards, the leaf-parent (scene) cards, dark section-variant
 * dividers, and light header bands -- plus two extras that (a) fill the
 * 6-swatch preview and (b) color additional non-section header tiers on
 * deep (5-6 tier) ladders. Applying a palette upserts each tier's
 * default-color legend entry (ops.setTierColor); explicit per-card
 * colors are untouched. */

export interface CardPalette {
  id: string;
  label: string;
  light: string; // top header band (reel)
  dark: string; // section-variant divider
  mid: string; // leaf-parent cards (scene)
  leaf: string; // leaf cards (beat)
  extras: [string, string]; // deep-ladder headers + preview swatches 5-6
}

/* Tag tab colors -- saturated on purpose. A tag has to read as a MARK
 * against a pastel card at a glance (and as a few scaled-down pixels in
 * the Overview), which the card fills are deliberately too soft to do.
 * New tags cycle through these; every one is then user-editable. */
export const TAG_COLORS = [
  "#e5484d",
  "#3a7bd5",
  "#2f9e44",
  "#d6409f",
  "#e8830c",
  "#8b5cf6",
  "#0d9488",
  "#c2410c",
];

export const PALETTES: CardPalette[] = [
  {
    id: "pastel",
    label: "Pastel",
    light: "#efeee9",
    dark: "#1c1d22",
    mid: "#e7c8f7",
    leaf: "#fcecad",
    extras: ["#cfe3f4", "#cdebcd"],
  },
  {
    id: "bold",
    label: "Bold",
    light: "#118ab2",
    dark: "#073b4c",
    mid: "#9b5de5",
    leaf: "#ffd166",
    extras: ["#ef476f", "#06d6a0"],
  },
  {
    id: "earthy",
    label: "Earthy",
    light: "#e9e1d3",
    dark: "#433628",
    mid: "#d98e73",
    leaf: "#f0e3bd",
    extras: ["#a3b18a", "#c98f5e"],
  },
  {
    id: "mono",
    label: "Mono",
    light: "#f2f2f0",
    dark: "#232428",
    mid: "#d4d4d8",
    leaf: "#fafaf8",
    extras: ["#a9a9b0", "#6d6d75"],
  },
];

/* ------------------------------------------------------------------ *
 *  A palette IS a ladder, bottom up: T1, T2, ... T6.
 *
 *  ONE array, read two ways -- the picker previews it left to right and
 *  a tier indexes into it -- so the swatches can't say one thing and the
 *  board do another. It reads in the owner's own tier order (T1 first),
 *  which is also the Board-structure menu's.
 *
 *  Anchored at the LEAF, like every other role in the app (a node's tier
 *  is its height above the leaf -- see the graduation section of
 *  CLAUDE.md). It used to anchor `light` at the TOP and walk the extras
 *  downward, which agrees for the 4-tier ladders that ship but inverts
 *  on a 5- or 6-rung one: the fifth rung got `light` and T4 got an
 *  extra. It also read `variant`, so a custom ladder with several
 *  "section" rungs painted them all dark.
 * ------------------------------------------------------------------ */
export const paletteTiers = (p: CardPalette): string[] => [
  p.leaf, // T1
  p.mid, // T2
  p.dark, // T3
  p.light, // T4
  ...p.extras, // T5, T6
];

/* The 6 preview swatches, T1 -> T6. */
export const paletteSwatches = paletteTiers;

/* The palette fill for one tier, by its HEIGHT above the leaf. */
export function paletteTierColor(p: CardPalette, levels: LevelDef[], levelId: string): string {
  const tiers = paletteTiers(p);
  const i = levels.findIndex((l) => l.id === levelId);
  if (i < 0) return tiers[0];
  const height = levels.length - 1 - i; // T1 = 0
  return tiers[Math.min(height, tiers.length - 1)];
}

/* Pick a readable text color (white or near-black) for a given fill, so any
 * tier color -- including a dark section -- keeps legible titles/controls. */
export function textColor(bg: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(bg.trim());
  if (!m) return "#2a2d33";
  const n = parseInt(m[1], 16);
  const lum = 0.299 * ((n >> 16) & 0xff) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff);
  return lum < 140 ? "#ffffff" : "#2a2d33";
}

/* THE BOARD BACKDROP'S ROUGH TONE, for chrome that sits ON the backdrop
 * and has to stay equally findable across all of them (owner, 2026-08-05:
 * the add chips were "great" on cork, "less visible" on Modern Dark and
 * "too visible" on Modern Lite -- one fixed dark ink cannot do all three).
 *
 * Three bands, not two, and that is the point: the MIDDLE one is the
 * look that is already right, so cork keeps exactly what it has and only
 * the ends are corrected.
 *
 * The thresholds are deliberately NOT textColor's. That one flips at 140
 * because it picks ink to sit on a card FILL; cork is 134, so sharing the
 * cutoff would push the one backdrop we must not change into the dark
 * band. Measured bases: lite grid #f5f5f2 = 244, cork #b17c48 = 134,
 * dark grid #65686c = 104. */
export type BgTone = "light" | "mid" | "dark";

export function bgTone(hex: string): BgTone {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return "mid";
  const n = parseInt(m[1], 16);
  const lum = 0.299 * ((n >> 16) & 0xff) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff);
  return lum < 120 ? "dark" : lum >= 190 ? "light" : "mid";
}

/* Darken a #rrggbb fill ~12% for the card border, so a user-chosen color
 * keeps the notecard's subtle outline without asking for two colors. */
export function deriveBorder(bg: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(bg.trim());
  if (!m) return bg;
  const n = parseInt(m[1], 16);
  const f = 0.85;
  const ch = (shift: number) => Math.round(((n >> shift) & 0xff) * f);
  return (
    "#" +
    [ch(16), ch(8), ch(0)].map((x) => x.toString(16).padStart(2, "0")).join("")
  );
}
