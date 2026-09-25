import type { CardFont } from "./state/settings";

/* ------------------------------------------------------------------ *
 *  Card typefaces. Font is a per-node property (like color): each node
 *  stores its own `font`, new nodes inherit the options-menu default, and
 *  the "Apply to" control stamps a whole tier. Ids map to CSS classes
 *  (.font-<id>); "sans" is the default and needs no class. Files are
 *  self-hosted -- see the @font-face rules in index.css.
 * ------------------------------------------------------------------ */

export const FONTS: readonly { id: CardFont; label: string }[] = [
  { id: "sans", label: "Default" },
  { id: "marker", label: "Permanent Marker" },
  { id: "bitcount", label: "Bitcount" },
];

export function fontClass(font: string | undefined): string {
  return font && font !== "sans" ? ` font-${font}` : "";
}
