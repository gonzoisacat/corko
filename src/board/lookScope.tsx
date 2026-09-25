import type { CSSProperties } from "react";
import type { Settings } from "../state/settings";
import type { BoardLook } from "../state/types";
import { resolveBackdrop } from "../state/boardLook";
import { bgTone } from "../colors";

/* ------------------------------------------------------------------ *
 *  A LOOK SCOPE: the element the look-and-feel CSS hangs off.
 *
 *  These attributes lived on `.app` until looks went per board
 *  (state/settings.ts, 2026-08-03). They can't stay there: the split view
 *  shows two boards at once, and "which board am I in" is the entire
 *  point of letting them differ. So each pane carries its own scope.
 *
 *  **`.app` must NOT carry them any more, and that is not a tidiness
 *  point.** The 38 rules in index.css are descendant selectors like
 *  `.look[data-bg="cork"] .board-vlist`. If an ancestor `.app` said cork
 *  while the nearer `.pane` said slate, a card in that pane would match
 *  BOTH rules -- equal specificity, so SOURCE ORDER decides, and whichever
 *  of cork/slate is written later in the stylesheet wins for both panes.
 *  Pane B would silently paint with pane A's backdrop, and nothing about
 *  the markup would look wrong. Scopes must be siblings, never nested.
 *
 *  Which is why the overlays get their own: the card menu, the metadata
 *  panel's card preview and the Overview's hover card all draw REAL cards
 *  outside any pane (they render above the panes so a split view has one
 *  of each). They follow the focused pane's look -- see App.
 * ------------------------------------------------------------------ */

/* The base color of each named backdrop, for deciding what tone the
 * chrome sitting ON it should take. These MIRROR index.css -- the grids
 * and cork are painted there, and only the custom color reaches us as
 * data -- so if a backdrop is ever recolored, change it in both places.
 * A wrong value here costs contrast on the add chips, not correctness. */
const BACKDROP_BASE: Record<string, string> = {
  default: "#f5f5f2", // lite grid
  slate: "#65686c", // dark grid
  cork: "#b17c48", // the photo's fallback tone, close to its average
};

/* The look half of the settings, as DOM attributes + custom properties.
 * `--tag-bleed` is deliberately not here: tags are project-level (ADR
 * 0002), so their overhang is the same everywhere and stays on `.app`. */
/* The backdrop comes through state/boardLook.ts (2026-09-05): the
 * BOARD's own shared look when it has one and you have not said "use
 * mine everywhere", else yours. The card things stay yours. */
export function lookAttrs(s: Settings, boardLook?: BoardLook): {
  className: string;
  "data-rounded": string;
  "data-bg": string;
  "data-grain": string;
  "data-pins": string;
  "data-shadow": string;
  "data-tone": string;
  style: CSSProperties;
} {
  const bd = resolveBackdrop(s, boardLook);
  return {
    className: "look",
    "data-rounded": s.roundedCorners ? "on" : "off",
    "data-bg": bd.bg,
    /* grain is the CUSTOM color's alone -- gated here as well as in the
       Options menu, so hiding the toggle actually turns it off rather
       than leaving an invisible setting still painting */
    "data-grain": bd.grain && bd.bg === "custom" ? "on" : "off",
    "data-pins": s.pushpins ? "on" : "off",
    "data-shadow": s.liftedShadow ? "on" : "off",
    /* light / mid / dark, so board chrome can pick its own contrast the
     * way a card's title picks its ink. Custom backdrops are judged on
     * the color the user actually chose, which is the whole reason this
     * is computed rather than keyed off `boardBg`. */
    "data-tone": bgTone(bd.bg === "custom" ? bd.custom : (BACKDROP_BASE[bd.bg] ?? "#f5f5f2")),
    style: {
      "--custom-bg": bd.custom, // flat backdrop when boardBg === "custom"
      "--sel-color": s.selectionColor, // selected-card outline, both views
      // fixed pin color; when "random" each card sets its own --pin-color
      "--pin-color": s.pushpinColor === "random" ? "#cf332f" : s.pushpinColor,
    } as CSSProperties,
  };
}
