/* ------------------------------------------------------------------ *
 *  Dev-only layout diagnostics: `corko.doctor()` in the console.
 *
 *  Every tag-tab bug in this feature took the same shape -- a value or a
 *  behavior living on an element that was already doing another job --
 *  and each one was found by walking a tab's ancestors to see who clipped
 *  it, or by asking which element would receive a drop at a point. Both
 *  are three lines to write and tedious to rediscover, so they live here.
 *
 *  Not shipped: main.tsx installs this behind import.meta.env.DEV.
 * ------------------------------------------------------------------ */

import { ops, getSnapshot } from "../state/ydoc";
import { buildWatch } from "../state/buildWatch";

const name = (el: Element): string =>
  (typeof el.className === "string" ? el.className.split(" ")[0] : "") || el.tagName;

/* Who, if anyone, is cutting this element off. */
function clippers(el: Element) {
  const r = el.getBoundingClientRect();
  const out: { el: string; cutPx: number; overflow: string }[] = [];
  let p = el.parentElement;
  while (p && p !== document.body) {
    const cs = getComputedStyle(p);
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
      const b = p.getBoundingClientRect();
      const cut =
        Math.max(0, b.top - r.top) +
        Math.max(0, r.bottom - b.bottom) +
        Math.max(0, b.left - r.left) +
        Math.max(0, r.right - b.right);
      if (cut > 0.5)
        out.push({ el: name(p), cutPx: Math.round(cut), overflow: `${cs.overflowX}/${cs.overflowY}` });
    }
    p = p.parentElement;
  }
  return out;
}

export interface DoctorReport {
  bundle: string[];
  tagBleed: string;
  /* Two invariants that each broke once and were hard to spot:
   *  - .beats reserves room to overhang and cancels it with an equal
   *    negative margin, so `netTop` AND `netBottom` must both be 0. If
   *    either isn't, a rule re-declared `padding` (or a bare
   *    `padding-bottom`) and dropped the reserve on that side. Both sides
   *    are checked because they hold different amounts: the top is
   *    --tag-bleed, the bottom is --tag-bleed PLUS --shadow-bleed. A
   *    bottom-only break is invisible from the top, and it shows up as a
   *    cropped tag tab or a clipped drop shadow rather than as a bad
   *    number anywhere.
   *  - .beats-inner carries the card padding AND the append drop zone. The
   *    bleed must never live here, or that reserve becomes a band around
   *    every card that swallows drops and appends them. A reserve here is
   *    also SPACE, and .beats is align-self: center -- so a one-sided one
   *    slides every beat off center against its scene card. */
  strip: {
    padTop: string;
    marginTop: string;
    netTop: number;
    padBottom: string;
    marginBottom: string;
    netBottom: number;
  } | null;
  stripInner: { padding: string; hasBleed: boolean } | null;
  clippedTabs: { tag: string | null; box: string; clippedBy: ReturnType<typeof clippers> }[];
  /* A tab is absolutely positioned inside its card, so the card MUST be a
   * positioning context. When it isn't, the tab silently anchors to some
   * ancestor instead and lands far from the card it belongs to (.ov-band
   * shipped like that). Anything listed here is that bug. */
  unanchoredTabs: { tag: string | null; host: string; anchoredTo: string }[];
  tabsOnScreen: number;
  cardsWithTags: number;
}

function report(): DoctorReport {
  const app = document.querySelector(".app");
  const strip = document.querySelector(".beats");
  const stripCs = strip ? getComputedStyle(strip) : null;
  const inner = document.querySelector(".beats-inner");
  const innerCs = inner ? getComputedStyle(inner) : null;
  const bleed = strip ? parseFloat(getComputedStyle(strip).paddingTop) || 0 : 0;
  const tabs = [...document.querySelectorAll(".tag-tab")];
  return {
    bundle: [...document.scripts].map((s) => s.src.split("/").pop() ?? "").filter(Boolean),
    tagBleed: app ? getComputedStyle(app).getPropertyValue("--tag-bleed").trim() : "",
    strip: stripCs
      ? {
          padTop: stripCs.paddingTop,
          marginTop: stripCs.marginTop,
          netTop: parseFloat(stripCs.paddingTop) + parseFloat(stripCs.marginTop),
          padBottom: stripCs.paddingBottom,
          marginBottom: stripCs.marginBottom,
          netBottom: parseFloat(stripCs.paddingBottom) + parseFloat(stripCs.marginBottom),
        }
      : null,
    stripInner: innerCs
      ? {
          padding: innerCs.padding,
          // the tell-tale: inner padding should be the base (5px-ish), never
          // the bleed
          hasBleed: bleed > 0 && Math.abs(parseFloat(innerCs.paddingTop) - bleed) < 0.5,
        }
      : null,
    tabsOnScreen: tabs.length,
    cardsWithTags: document.querySelectorAll("[data-tags]").length,
    unanchoredTabs: tabs
      .filter((t) => t.parentElement && (t as HTMLElement).offsetParent !== t.parentElement)
      .map((t) => ({
        tag: t.getAttribute("data-tag"),
        host: t.parentElement ? name(t.parentElement) : "?",
        anchoredTo: (t as HTMLElement).offsetParent
          ? name((t as HTMLElement).offsetParent!)
          : "(none)",
      })),
    clippedTabs: tabs
      .map((t) => ({
        tag: t.getAttribute("data-tag"),
        box: `${Math.round(t.getBoundingClientRect().width)}x${Math.round(t.getBoundingClientRect().height)}`,
        clippedBy: clippers(t),
      }))
      .filter((t) => t.clippedBy.length > 0),
  };
}

/* What sits under a point, outermost-in -- for "why did my drop land
 * there": the deepest ancestor with drop handlers wins, and this shows
 * the chain to check. */
function zoneAt(x: number, y: number): string[] {
  const chain: string[] = [];
  let el = document.elementFromPoint(x, y);
  while (el && el !== document.body) {
    chain.push(name(el));
    el = el.parentElement;
  }
  return chain;
}

/* ------------------------------------------------------------------ *
 *  DARK-MODE AUDIT: `corko.darkAudit()`.
 *
 *  Dark chrome is written as an override block rather than as tokens
 *  (see the block at the foot of index.css), so its risk is a rule that
 *  was never converted -- which looks like nothing at all until someone
 *  toggles the theme. These are the two scans that found every miss so
 *  far, kept as a command because "audited once" decays and "auditable"
 *  does not.
 *
 *  IT ONLY SEES WHAT IS OPEN, and that is not a footnote: the first pass
 *  came back clean and still missed the shortcut panel, the search menu
 *  and three dropdowns, because every one of them is behind a click.
 *  OPEN YOUR MENUS FIRST -- the report says so out loud every time.
 *
 *  The board is excluded on purpose. Cards, swatches and the metadata
 *  panel's card preview show what a card is PAINTED, so a pale yellow
 *  beat staying pale yellow on a dark panel is correct, not a miss.
 * ------------------------------------------------------------------ */
const LIGHT_BG = 205; // luma above which a chrome surface is "still light"
const MIN_INK = 60; // luma gap below which text is effectively invisible

function luma(c: string): number | null {
  const m = (c.match(/[\d.]+/g) ?? []).map(Number);
  if (m.length < 3) return null;
  /* A MOSTLY-TRANSPARENT FILL IS NOT A SURFACE. It tints whatever is
   * behind it, so its own color says nothing about what you SEE -- and
   * reading it as one produced a false "light surface" on a dark panel
   * for a 3%-alpha white, which is the sort of noise that gets a report
   * skimmed rather than read. Half is the line: below it the backdrop
   * dominates, above it the fill does. */
  if (m.length > 3 && m[3] < 0.5) return null;
  return 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2];
}

/* The first ancestor that actually paints something, which is what a
 * transparent element is really sitting on. */
function paintedBg(el: Element): number | null {
  let n: Element | null = el;
  while (n && n !== document.documentElement) {
    const l = luma(getComputedStyle(n).backgroundColor);
    if (l !== null) return l;
    n = n.parentElement;
  }
  return null;
}

function darkAudit(): { openNow: string[]; lightSurfaces: string[]; unreadableText: string[] } {
  const app = document.querySelector(".app");
  /* EVERY BOARD SURFACE, not just the cut board's two. Dark UI
   * deliberately does not touch the BOARD -- that is `boardBg`'s job --
   * so anything inside one of these is out of scope, and a type whose
   * surface is missing here reports its own cards as unconverted chrome.
   * A new board type must add its surface, exactly as it must register
   * with keyNav's spatial selector. */
  const boards = [
    ...document.querySelectorAll(".board-vlist, .ov-viewport, .kanban, .grid-surface"),
  ];
  const inBoard = (el: Element) => boards.some((b) => b.contains(el));

  const lightSurfaces = new Set<string>();
  const unreadableText = new Set<string>();
  app?.querySelectorAll("*").forEach((el) => {
    if (inBoard(el)) return;
    const bg = luma(getComputedStyle(el).backgroundColor);
    if (bg !== null && bg > LIGHT_BG) lightSurfaces.add(name(el));
    /* AN INPUT'S TEXT IS ITS `value`, NOT ITS `textContent`, and reading
       only the latter is how this audit missed a field that had been
       invisible in dark mode since dark chrome shipped: `.meta-name`,
       the category-name box, near-black on a dark panel, with the whole
       CATEGORIES column reading as empty. The audit said clean.
       So a filled input or textarea counts as text. */
    const field = el as HTMLInputElement | HTMLTextAreaElement;
    const typed =
      (el.tagName === "INPUT" && field.type !== "checkbox" && field.type !== "radio") ||
      el.tagName === "TEXTAREA";
    if (typed) {
      if (!field.value.trim() && !field.placeholder?.trim()) return;
    } else if (!el.textContent?.trim() || el.children.length) {
      // leaf text only -- a wrapper's color is inherited, not applied
      return;
    }
    const fg = luma(getComputedStyle(el).color);
    const under = paintedBg(el);
    if (fg !== null && under !== null && Math.abs(fg - under) < MIN_INK) {
      unreadableText.add(`${name(el)} -- ink ${Math.round(fg)} on ${Math.round(under)}`);
    }
  });

  /* What was actually on screen, so a clean report can be read for what
   * it is worth rather than as a clean bill of health. */
  const openNow = [
    ".float-panel",
    ".ctx-menu",
    ".search-menu",
    ".fold-menu-pop",
    ".keys-panel",
    ".notes-panel",
    ".legend-add-menu",
    /* The Boards and Options dropdowns. They were missing, which is the
       failure this list exists to prevent: both are chrome behind a
       click, so a report that had audited them said `openNow: []` and
       read as "nothing was on screen" -- inviting exactly the "clean,
       therefore fine" conclusion the caveat warns against. */
    ".options-panel",
    /* The dialogs and modals, added 2026-08-24 after a dark sweep found
       four of them still wearing light-mode text. Every one is behind a
       click, so all four reported `openNow: []` -- and the board picker
       had no dark rules AT ALL while the audit came back clean. If you
       add a surface, add it here: this list is the only thing that makes
       a clean report mean something. */
    ".demote-menu", /* the promote dialog wears this class too */
    ".confirm-panel",
    /* The EDL import step wears `.confirm-panel` too, so it was already
       covered -- named separately because this list is read to know WHICH
       surface was on screen, and "a confirm" and "the import dialog with
       a contact sheet in it" are not the same audit. */
    ".edl-panel",
    ".tp-modal",
    ".nest-picker",
    ".open-nested-menu",
    ".yarn-menu",
    /* the Overrides door by the steering wheel (wears .fold-menu-pop
       too; named so a report says WHICH menu was open) */
    ".overrides-menu",
    ".note-state-menu",
  ].filter((sel) => document.querySelector(sel));

  return { openNow, lightSurfaces: [...lightSurfaces], unreadableText: [...unreadableText] };
}

/* ------------------------------------------------------------------ *
 *  THE APP'S OWN DOC, HANDED OVER -- `corko.ops` / `corko.snap()`.
 *
 *  Driving the board from the console is the fastest way to verify real
 *  behavior, and it has one failure mode that costs hours every time it
 *  bites: `await import('/src/state/ydoc.ts')` does NOT reliably give you
 *  the module the app is running.
 *
 *  Vite serves an edited module at a new URL (`ydoc.ts?t=...`). The page
 *  is still holding the copy it loaded before the edit; a fresh import
 *  resolves to the newest URL and EVALUATES IT AGAIN. `ydoc.ts` builds
 *  `new Y.Doc()` at module scope, so the second evaluation is a second
 *  document -- same page, same server, same port, two docs.
 *
 *  It is convincing rather than obviously broken: the stale copy opens
 *  the same IndexedDB and joins the same room, so it loads real-looking
 *  boards and simply reports a board that is not the one on screen.
 *  Writes go somewhere real; they just go somewhere else. (Verified the
 *  hard way on 2026-08-07: four consecutive "nothing changed" readings
 *  while the feature under test was working the whole time.)
 *
 *  These bind the instance the app itself imported, at install time, so
 *  there is nothing to import and nothing to get wrong. Prefer them --
 *  and prefer reading the DOM over either, since the DOM cannot fork. */
export function installLayoutDoctor(): void {
  /* `build` drives the deploy light (state/buildWatch.ts) so its three
   * faces can be looked at without deploying twice: corko.build("update"). */
  const api = { doctor: report, zoneAt, darkAudit, build: buildWatch.force, ops, snap: getSnapshot };
  (window as unknown as { corko: typeof api }).corko = api;
  // eslint-disable-next-line no-console
  console.info(
    "corko.doctor() / corko.zoneAt(x, y) / corko.darkAudit() / corko.build(state) -- diagnostics (dev only).\n" +
      "darkAudit only sees what is OPEN: open your menus and panels first.\n" +
      "corko.ops / corko.snap() -- the APP's doc. Use these, never a fresh " +
      "import(): after an edit, importing a store re-evaluates it and you get " +
      "a second Y.Doc that looks right and isn't.",
  );
}
