import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* ------------------------------------------------------------------ *
 *  THE STYLESHEET PARSES INTO THE RULES IT LOOKS LIKE.
 *
 *  Written after a rule that was plainly there did nothing for two days
 *  (owner-reported 2026-08-05: "beats have no drop previews, T2 and above
 *  are fine"). The edge markers needed extra specificity to beat the
 *  lifted-shadow look; when they were deleted, four repeated
 *  `.look[data-shadow="on"]` prefixes were left behind with no body and
 *  no semicolon. CSS comments are stripped BEFORE selectors are parsed,
 *  so the orphan reached past the comment between them and glued itself
 *  onto the next rule:
 *
 *    .look[..] .look[..] .look[..] .look[..] .beat-insert.drop-into { }
 *
 *  which needs four NESTED look scopes. Look scopes are siblings by
 *  construction (board/lookScope.tsx), so it could never match -- the
 *  class landed on the right slot every time and nothing painted.
 *
 *  Nothing could have caught that: the file is valid CSS, the build is
 *  green, and no test in the repo reads a stylesheet. This is the
 *  cheapest guard that would have -- it reads the selectors the way a
 *  parser does and complains about ones that cannot match.
 * ------------------------------------------------------------------ */

const css = readFileSync(fileURLToPath(new URL("./index.css", import.meta.url)), "utf8");

/* Comments out first -- that is the whole trick the bug turned on. What
 * is left is what the browser sees. */
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

/* Every top-level selector: the text before a `{` that opens a rule, with
 * at-rule preludes (@media, @supports, @font-face) skipped -- they are
 * conditions, not selectors. Brace depth keeps nested blocks out. */
function selectors(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of src) {
    if (ch === "{") {
      if (depth === 0) {
        const s = buf.trim();
        if (s && !s.startsWith("@")) out.push(s);
      }
      depth++;
      buf = "";
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
      buf = "";
    } else if (depth === 0) {
      buf += ch;
    }
  }
  return out;
}

/* One selector of a comma list, split into its descendant steps. A step
 * separated by an explicit combinator is NOT a descendant step -- and
 * `.ov-spine + .ov-spine` is a real, correct selector, so a naive
 * repeated-segment check would flag it. */
function descendantSteps(part: string): string[] | null {
  const toks = part.trim().split(/\s+/);
  if (toks.some((t) => t === ">" || t === "+" || t === "~")) return null;
  return toks;
}

describe("index.css parses into the rules it looks like", () => {
  const all = selectors(stripped);

  it("finds the stylesheet's rules at all", () => {
    // a floor, so a broken parse can't make the checks below vacuously pass
    expect(all.length).toBeGreaterThan(200);
  });

  /* THE ORPHANED-PREFIX CHECK. A selector prefix left behind by a deleted
   * rule shows up as the same compound repeated down a descendant chain,
   * because the leftover is a copy of the one on the rule that survived.
   * Repeating a compound as a DESCENDANT of itself is also meaningless on
   * its own terms: `.x .x` needs an .x inside an .x. */
  it("no selector requires an element nested inside itself", () => {
    const bad: string[] = [];
    for (const sel of all) {
      for (const part of sel.split(",")) {
        const steps = descendantSteps(part);
        if (!steps) continue;
        const seen = new Set<string>();
        for (const step of steps) {
          if (seen.has(step)) {
            bad.push(part.trim().replace(/\s+/g, " "));
            break;
          }
          seen.add(step);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  /* The same orphan seen from the other side, and the check that catches
   * one whose leftover ISN'T a repeat of what it glued onto. A selector
   * running to many steps is nearly always two that were meant to be
   * separate.
   *
   * The bound is measured, not guessed: the longest legitimate chain in
   * this file is THREE (`.brand-mark.spinning .brand-pin circle`), and
   * the orphan was five. Four leaves one step of headroom -- if a real
   * rule ever needs five, raise it deliberately and say why, because
   * loosening it is how this check stops working. */
  it("no selector is an implausibly long descendant chain", () => {
    const bad: string[] = [];
    for (const sel of all) {
      for (const part of sel.split(",")) {
        const steps = descendantSteps(part);
        if (steps && steps.length > 4) bad.push(part.trim().replace(/\s+/g, " "));
      }
    }
    expect(bad).toEqual([]);
  });

  /* The specific rule the bug ate, named outright: it is the ONLY thing
   * that opens a gap between two beats, and it went unreachable without a
   * single symptom a test or the build could see. */
  it("the beat gap rule is a plain, reachable selector", () => {
    const gap = all.filter((s) => s.includes(".beat-insert.drop-into"));
    /* two since 2026-09-04: the slot's own rule (the room) and its
     * ::before (the card-shaped dashed box, inset from the neighbours) */
    expect(gap).toEqual([".beat-insert.drop-into", ".beat-insert.drop-into::before"]);
  });
});
