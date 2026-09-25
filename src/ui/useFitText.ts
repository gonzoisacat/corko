import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/* ------------------------------------------------------------------ *
 *  Size a title to its fixed-height card. The font starts at `maxFont`
 *  and shrinks until the text stops overflowing (down to `min`). So:
 *   - a modest maxFont (the tier's text size) = "render at this size,
 *     shrink only if it's too long",
 *   - a large maxFont (the card height) = "expand to fill the card".
 *  Either way the title never overflows -- auto-shrink is unconditional.
 *
 *  Font-size is set imperatively on the ref'd container (the title
 *  inherits it), so there's no state/re-render churn. `remeasure` is
 *  exposed for the card to re-run on every keystroke (bound to onInput)
 *  so the text resizes live while editing. The edit view is virtualized,
 *  so only on-screen cards ever measure.
 * ------------------------------------------------------------------ */

/* One shared IntersectionObserver for all `visibleOnly` fitters (Overview
 * beats). The Overview isn't virtualized, so thousands of beat cells exist at
 * once; a per-element observer froze the tab for seconds *just creating* them.
 * A single observer + one observe() per element is cheap. On-screen beats are
 * fitted PROGRESSIVELY -- a few per animation frame -- because each fit forces
 * layout reflows on the huge (unvirtualized) Overview, so doing them all in one
 * go blocks the thread. Spreading them keeps the UI responsive; text fills in.
 */
let sharedIO: IntersectionObserver | null = null;
interface Fitter {
  visible: boolean;
  setVisible: (v: boolean) => void;
  measure: () => void;
  /* READ-ONLY probe of the fit cache: returns a thunk that writes the
   * remembered size, or null if this one has to be measured properly.
   * Split in two halves so the queue can do every read before any write --
   * see flushPending. */
  cached: () => (() => void) | null;
}
const fitters = new WeakMap<Element, Fitter>();
const pending = new Set<Element>();
let scheduled = false;
/* The count is a FLOOR and the time is a CEILING, and it needs both.
 *
 * A flat 5-per-frame was calibrated when every fit was expensive. The fit
 * cache made a revisited card almost free -- and the budget then became the
 * only thing left setting the pace: measured on the 3220-node CLB, flipping
 * back to a fitted Overview drained 571 cards at a dead-constant ~105 per
 * 385ms (5 a frame at 60fps) with ZERO long tasks, i.e. 2.5 seconds of
 * waiting for work that had already been done. Spending the frame instead
 * of counting it lets a cached drain finish in a few frames.
 *
 * The floor is what keeps that safe. A pure time budget would stop after
 * the first fit whenever one fit alone overruns 8ms -- which is the COLD
 * Overview, where a fit is ~20ms -- and the fill-in would get slower than
 * it is today. Doing at least FITS_PER_FRAME first makes the new behavior
 * a strict superset of the old: never fewer per frame than before, many
 * more when they are cheap. */
const FITS_PER_FRAME = 5;
const FRAME_BUDGET_MS = 8;
function flushPending() {
  scheduled = false;
  const until = performance.now() + FRAME_BUDGET_MS;

  /* PHASE 1 -- READS ONLY. Ask every queued card whether its size is
   * already known. Nothing is written here, so the page lays out once for
   * the whole batch however many cards there are: measured at 0.002ms a
   * card, against 0.85ms when the same work alternates read and write.
   *
   * That 400x gap is the whole reason for the split. A cache HIT still has
   * to build its key, and the key holds the box (clientWidth/clientHeight)
   * -- a layout read -- while applying the hit sets fontSize, a layout
   * write. One after the other, per card, that is textbook thrash: the
   * "free" cached path measured 1.6ms a card and pinned the drain to the
   * budget floor, so flipping back to an already-fitted Overview spent 2.3
   * seconds re-applying sizes it had computed already. */
  const writes: Array<() => void> = [];
  const misses: Element[] = [];
  for (const el of pending) {
    const f = fitters.get(el);
    if (!f) {
      pending.delete(el);
      continue;
    }
    const write = f.cached();
    if (write) {
      writes.push(write);
      pending.delete(el);
    } else misses.push(el);
  }

  /* PHASE 2 -- WRITES ONLY. One layout invalidation for the batch. */
  for (const write of writes) write();

  /* PHASE 3 -- the ones that genuinely have to be measured. These read and
   * write by nature (the search sets a size and reads the height back), so
   * they stay rate-limited: at least FITS_PER_FRAME, then only while the
   * frame's budget holds. */
  let floor = FITS_PER_FRAME;
  for (const el of misses) {
    pending.delete(el);
    fitters.get(el)?.measure();
    if (--floor <= 0 && performance.now() >= until) break;
  }
  if (pending.size) schedule();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(flushPending);
}
/* Queue a queued-mode (visibleOnly) fitter for a re-fit, respecting the
 * per-frame budget. Only ON-SCREEN cells are worth queueing: an off-screen
 * one is re-fitted by the observer when it scrolls in (by then the font has
 * loaded anyway), and queueing thousands of no-ops would starve the budget
 * for frames on end. */
function queueRefit(el: Element) {
  if (!fitters.get(el)?.visible) return;
  pending.add(el);
  schedule();
}

function sharedObserver(): IntersectionObserver {
  if (!sharedIO) {
    sharedIO = new IntersectionObserver((entries) => {
      for (const e of entries) {
        fitters.get(e.target)?.setVisible(e.isIntersecting);
        if (e.isIntersecting) pending.add(e.target);
        else pending.delete(e.target);
      }
      if (pending.size) schedule();
    });
  }
  return sharedIO;
}

/* ---- the fit is a pure function, so remember it ------------------- *
 *
 * MEASURED 2026-08-07, and it is the whole ball game: with measure()
 * stubbed out entirely, a 250px scroll step on the unfurled CLB went
 * from a 284ms median (65-434ms) to 14ms (9-20ms). Everything else in a
 * viewport -- the DOM, the hooks, the drop zones, the card interiors --
 * is that remaining 14ms. The wild variance was never noise either: it
 * is how many words a title has and how many search steps it needs.
 *
 * The work itself is not waste (this is what makes a title fill its card
 * and never overflow) -- but REDOING it is. The answer depends only on
 * the text, the typeface, the size bounds and the box, all of which are
 * stable for a card until someone edits it. A virtualized list remounts
 * the same cards constantly, and today each remount re-derives from
 * scratch: a rect read per word to rank the longest, two more to
 * converge, a 0.25px step-down loop, then up to twelve scrollHeight
 * reads. Twenty-odd forced layouts, to arrive at the number it had a
 * moment ago.
 *
 * So: remember the answer. A hit sets the size and returns before any of
 * that runs. Scrolling back over ground you have already seen costs
 * nothing, which is most of real scrolling.
 *
 * WHAT INVALIDATES IT: webfonts landing, because the fallback face has
 * different metrics and every cached number was measured against it --
 * the same swap the fonts.ready re-fit below exists for. Editing skips
 * the cache entirely: the live text changes per keystroke, so entries
 * would be write-only, and the textarea measures differently from the
 * span anyway. */
const fitCache = new Map<string, number>();
const FIT_CACHE_MAX = 4000;
let fitDirty = false;

/* ---- ...and remember it ACROSS SESSIONS ---------------------------- *
 *
 * The in-memory cache made flipping views instant but died on every
 * reload, so OPENING the app paid full price again: measured on CLB,
 * 571 scene cards cost ~10s of fitting on a cold load, in 80-100ms
 * chunks that make the whole app choppy while it happens. Those answers
 * were correct when this browser computed them and nothing about them
 * has changed, so they are worth keeping.
 *
 * LOCAL ONLY, like fold.ts / settings.ts / notesRead.ts: it is never
 * synced, never in a board file, and never in the doc -- so it cannot
 * grow the project, and a stale entry can only ever cost this one
 * browser a re-measure. (The keys embed card titles, but the full doc
 * already lives in this origin's IndexedDB, so it is no new exposure.)
 *
 * WHAT INVALIDATES IT is the one real hazard, and the reason for the
 * canary below. Every cached size is only true for the FONT METRICS it
 * was measured against; ship a different font file and the saved
 * numbers are quietly wrong -- text overflows its clipped box, which is
 * exactly the `font-display: swap` bug the fonts.ready re-fit exists
 * for, except it would now survive a reload. A build id would not catch
 * it either (metrics can change without one, and change with one when
 * nothing moved). So we fingerprint the thing that actually matters: a
 * fixed string measured in every family this browser is painting with.
 * If that differs from the fingerprint stored beside the entries, the
 * entries were measured against a different face and are dropped. */
const FIT_STORE_KEY = "corko-fit-cache";
/* 2: keys gained a rendering-context scope (see fitKey). Bumped rather
 * than left alone so v1 entries are DROPPED on sight -- keyed the old
 * way they can never match again, so they would otherwise sit in
 * storage as dead weight until evicted. */
const FIT_STORE_V = 2;
const FIT_STORE_MAX = 3000; // entries persisted; the in-memory cap is higher
let fitCanary = "";

/* A fingerprint of the metrics in force RIGHT NOW: one fixed string
 * measured in every family this browser paints cards with.
 *
 * IT HAS TO LOAD THE FACES FIRST, and that is not the same thing as
 * awaiting document.fonts.ready. A webface is only fetched when
 * something ASKS for it, and fonts.ready resolves happily without a face
 * nothing has requested yet -- so the first cut measured all four
 * families at 369238, the serif fallback, having fingerprinted nothing.
 * It would still have MATCHED on the next load (same fallback, same
 * number), so the guard would have looked fine while silently failing to
 * notice a swapped font file -- and gone off at random once a card
 * happened to pull a face in early. Hence the explicit load() pass.
 *
 * The generics are in there too: they fingerprint the system faces
 * behind a stack, so an OS/browser font change invalidates as well. */
async function metricsCanary(): Promise<string> {
  const families = new Set<string>(["sans-serif", "serif", "monospace"]);
  try {
    families.add(getComputedStyle(document.body).fontFamily);
    document.fonts.forEach((f) => families.add(f.family));
  } catch {
    /* the generics alone still fingerprint a system-face change */
  }
  const list = [...families].sort();
  await Promise.allSettled(
    list.map((fam) => {
      try {
        return document.fonts.load(`400px ${/[",]/.test(fam) ? fam : `"${fam}"`}`);
      } catch {
        return Promise.resolve(); // unparseable stack: measure it as-is
      }
    }),
  );
  const probe = document.createElement("span");
  Object.assign(probe.style, {
    position: "absolute",
    left: "-99999px",
    top: "0",
    visibility: "hidden",
    whiteSpace: "pre",
    fontSize: "400px",
  } as Partial<CSSStyleDeclaration>);
  probe.textContent = "Hamburgefonstiv 0123";
  document.body.appendChild(probe);
  const parts: string[] = [];
  for (const fam of list) {
    probe.style.fontFamily = fam;
    parts.push(Math.round(probe.getBoundingClientRect().width * 100).toString());
  }
  probe.remove();
  return parts.join(",");
}

function restoreFitCache(raw: string) {
  try {
    const data = JSON.parse(raw) as { v?: number; canary?: string; entries?: [string, number][] };
    if (data?.v !== FIT_STORE_V || !Array.isArray(data.entries)) return;
    if (data.canary !== fitCanary) {
      // different face than these were measured against -- start clean
      try {
        localStorage.removeItem(FIT_STORE_KEY);
      } catch {
        /* nothing we can do; the entries are simply not loaded */
      }
      return;
    }
    for (const e of data.entries) {
      if (Array.isArray(e) && typeof e[0] === "string" && Number.isFinite(e[1])) fitCache.set(e[0], e[1]);
    }
  } catch {
    /* corrupt payload -- the cache is an optimisation, so just skip it */
  }
}

function saveFitCache() {
  if (!fitDirty || !fitCanary || fitCache.size === 0) return;
  fitDirty = false;
  try {
    const entries: [string, number][] = [];
    for (const e of fitCache) {
      entries.push(e);
      if (entries.length >= FIT_STORE_MAX) break;
    }
    localStorage.setItem(FIT_STORE_KEY, JSON.stringify({ v: FIT_STORE_V, canary: fitCanary, entries }));
  } catch {
    /* private mode or over quota. Never let this throw into a render or
     * an unload handler -- the whole feature is a speed-up, and losing
     * it costs a re-measure and nothing else. (state/access.ts learned
     * this the hard way: a silent storage failure there broke the gate.) */
  }
}

if (typeof document !== "undefined" && document.fonts?.ready) {
  document.fonts.ready.then(async () => {
    /* Everything measured before this point was measured against the
     * FALLBACK face, so it goes -- then the persisted entries, which
     * were measured against the real one, come back. */
    fitCache.clear();
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(FIT_STORE_KEY);
    } catch {
      /* storage unavailable -- run as a memory-only cache */
    }
    fitCanary = await metricsCanary();
    /* Anything fitted during that await was measured against the real
     * faces too, so it is kept -- restore only ADDS. */
    if (raw) restoreFitCache(raw);
  });
  /* `visibilitychange -> hidden` is the reliable one (pagehide covers
   * bfcache navigations); both are cheap because of the dirty flag. */
  addEventListener("pagehide", saveFitCache);
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveFitCache();
  });
}

/* THE SCOPE IS LOAD-BEARING, and leaving it out was a real bug.
 *
 * The same title, in the same size box, with the same bounds, does NOT
 * fit at the same size in every view: the detail card's box and the
 * Overview miniature's are different elements with different CSS
 * (.scene-title-wrap is a flex COLUMN whose title sits in a padded
 * .editable; .ov-mini-fit is a flex row around a bare span). Measured on
 * one real card, both 156x66 with the identical string: detail fits at
 * 26.5625px and the miniature at 26.2188px.
 *
 * Without a scope those two share one entry, so whichever view rendered
 * first decided the other's font -- and the Overview's next wrap
 * boundary sat between them, so inheriting detail's answer flipped the
 * card from two lines (63px, fits) to three (96px in a 66px box) and
 * clipped it. That is the "one card renders wonkily in the Overview"
 * report, and the persistent store turned it from a per-session accident
 * into one that survives reloads.
 *
 * `fontKey` could not stand in for this: detail passes the raw font id
 * and MiniCard passes the CSS class, so they only collide when the tier
 * has no defaultFont -- which made the bug look arbitrary, striking some
 * tiers and boards and not others.
 *
 * The element's own className IS the rendering context, so it is exact
 * and needs nothing from the callers. A dynamic class can only ever
 * FRAGMENT the cache (an extra miss, then a correct answer); it can
 * never produce a wrong hit, which is the only failure that matters. */
function fitKey(
  scope: string,
  text: string,
  maxFont: number,
  min: number,
  w: number,
  h: number,
  fontKey?: string,
) {
  return `${scope}|${fontKey ?? ""}|${maxFont}|${min}|${w}x${h}|${text}`;
}

/* ---- widest-word probe -------------------------------------------- *
 * The height check alone can't tell a good fit from a broken one: card
 * titles allow mid-word breaking, so an over-wide word SPLITS
 * ("Establishin/g") at a size whose wrapped height fits the box happily.
 * scrollWidth won't catch it either -- the titles are centered, and a
 * clipped box doesn't report overflow that hangs off both edges.
 *
 * So measure the widest WORD directly, in an off-flow probe that copies the
 * title's real typography, and make "no word wider than the line" a second
 * constraint of the search.
 *
 * Two things this has to get right:
 *  - glyph widths are NOT linear in font-size (hinting quantises them), so a
 *    measurement at one size can't be scaled to another: ~155px predicted vs
 *    160px real at 30px. The probe is re-measured at each candidate size.
 *  - the Overview's miniatures sit inside a scaled card, so client rects come
 *    back multiplied. Rects are fractional (offsetWidth is rounded), so we
 *    read rects and divide by the box's own scale to get back to layout px.
 */
const RANK_SIZE = 400; // one big sample, only to pick the longest word

interface WordProbe {
  widthAt: (fs: number) => number; // layout px, unscaled
  refWidth: number; // the longest word at RANK_SIZE, for a first estimate
  inset: number; // the title element's own horizontal padding
  done: () => void;
}

let probeEl: HTMLSpanElement | null = null;
function probeSpan(): HTMLSpanElement {
  if (!probeEl) {
    probeEl = document.createElement("span");
    probeEl.setAttribute("aria-hidden", "true");
    Object.assign(probeEl.style, {
      position: "absolute",
      left: "-99999px",
      top: "0",
      visibility: "hidden",
      whiteSpace: "pre",
      pointerEvents: "none",
    } as Partial<CSSStyleDeclaration>);
  }
  return probeEl;
}

function wordProbeFor(el: HTMLElement, content: string): WordProbe | null {
  const words = content.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  // the element that actually carries the type (the font class can sit on a
  // child -- .editable in the detail cards, a span in the Overview proxies)
  const host = (el.querySelector(".editable") ?? el.firstElementChild ?? el) as HTMLElement;
  const cs = getComputedStyle(host);
  const p = probeSpan();
  Object.assign(p.style, {
    fontFamily: cs.fontFamily,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    fontStretch: cs.fontStretch,
    letterSpacing: cs.letterSpacing,
    textTransform: cs.textTransform,
    fontSize: `${RANK_SIZE}px`,
  } as Partial<CSSStyleDeclaration>);
  /* RANK EVERY WORD IN ONE LAYOUT PASS.
   *
   * Writing a word into the probe and reading its rect back is a FORCED
   * LAYOUT each time, and the Overview isn't virtualized -- measured on the
   * 3220-node CLB, one forced layout there costs ~2-3ms, so ranking an
   * average 3.1-word title cost 8.2ms, MORE than the height search it only
   * exists to constrain. Mounting one span per word and reading the rects
   * afterwards is the same measurement with the writes batched: the page
   * lays out once however many words there are (7.3ms -> 2.1ms per card).
   * Same discipline as spatialNav's single read pass -- it is interleaving
   * a write that makes a read loop quadratic.
   *
   * The children are inline-BLOCK so each shrink-wraps its own word: plain
   * inline boxes start at their predecessor's fractional offset, which
   * perturbs the reported width by up to 2px at RANK_SIZE. Measured over
   * 120 real cards, inline-block agrees with the word-at-a-time probe to
   * 0.167px in 400 (0.04%) and picks the same longest word in every one --
   * and the WORD is all this pass has to get right, since its width is
   * then measured exactly, at each candidate size, by widthAt below. */
  const kids = words.map((w) => {
    const s = document.createElement("span");
    s.style.display = "inline-block";
    s.style.whiteSpace = "pre";
    s.textContent = w;
    p.appendChild(s);
    return s;
  });
  el.appendChild(p);
  let longest = words[0];
  let widest = -1;
  for (let i = 0; i < kids.length; i++) {
    const width = kids[i].getBoundingClientRect().width;
    if (width > widest) {
      widest = width;
      longest = words[i];
    }
  }
  p.textContent = longest; // drops the per-word spans: one measurable span again
  const refWidth = widest;
  // Rects come back multiplied inside the Overview's scaled cards, so convert
  // them to layout px through the fit box's OWN scale -- it's a block, so its
  // clientWidth is trustworthy (an inline title element's is 0).
  const scale = el.clientWidth > 0 ? el.getBoundingClientRect().width / el.clientWidth : 1;
  return {
    refWidth: refWidth / (scale || 1),
    widthAt: (fs) => {
      p.style.fontSize = `${fs}px`;
      return p.getBoundingClientRect().width / (scale || 1);
    },
    // the line the word actually has to fit on is the TITLE element's content
    // box, which its padding narrows (.editable is padded 1px 2px)
    inset: (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0),
    done: () => p.remove(),
  };
}


/* THE LIMIT PAIRS WITH scrollHeight (2026-09-08). A fit box that yields a
 * band to a Corner thumbnail or a populated slot does it with padding,
 * and the height the fit measures (`scrollHeight`) COUNTS that padding
 * -- so the limit must too, or the padding is charged on one side only
 * and a one-line title falls to the floor. clientHeight counts it. The
 * one-day detour through content height came from a title that spilled
 * out of the TOP of a centered box, where scrollHeight cannot see it;
 * that was the box's centering (`safe center` now), not the limit. */
function contentHeight(el: HTMLElement): number {
  return el.clientHeight;
}

export function useFitText(
  text: string,
  maxFont: number,
  min = 8,
  opts?: { visibleOnly?: boolean; fontKey?: string; editing?: boolean; layoutKey?: string },
) {
  // visibleOnly: only fit while the element is on-screen (see sharedObserver).
  // Off by default -- the virtualized detail view mounts only visible cards, so
  // it fits immediately.
  const visibleOnly = !!opts?.visibleOnly;
  const elRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const visibleRef = useRef(!visibleOnly);
  /* Through a ref so it can key the cache without joining measure()'s
   * deps -- rebuilding the callback would re-run the ref callback and
   * re-observe on every typeface change. */
  const fontKeyRef = useRef(opts?.fontKey);
  fontKeyRef.current = opts?.fontKey;

  /* The cache key lives in ONE place, because two callers now build it:
   * measure() below, and the queue's read-only probe. If those drifted, a
   * hit for one would be a miss for the other and the Overview would
   * silently go back to re-measuring everything. Pure layout READS -- it
   * must never write, or the batching in flushPending is pointless. */
  const cacheKey = useCallback(() => {
    const el = elRef.current;
    if (!el || !visibleRef.current) return null;
    const limit = contentHeight(el);
    if (limit === 0) return null;
    // Editing skips the cache entirely (see fitCache): the text changes per
    // keystroke so entries would be write-only, and the textarea measures
    // differently from the span anyway.
    if (el.querySelector("textarea")) return null;
    /* Key on what is RENDERED, not the `text` prop: this is a useCallback
     * over [maxFont, min], so a captured `text` would be stale, and the fit
     * has always sized the DOM's own content anyway (placeholder included --
     * that is what a blank card displays). */
    return fitKey(
      el.className,
      el.textContent ?? "",
      maxFont,
      min,
      el.clientWidth,
      limit,
      fontKeyRef.current,
    );
  }, [maxFont, min]);

  /* The read half of a cache hit. Returns the WRITE to perform, so the
   * caller decides when to spend it -- which is what lets the queue put
   * every read before every write. */
  const cached = useCallback(() => {
    const el = elRef.current;
    if (!el) return null;
    const key = cacheKey();
    if (key === null) return null;
    const hit = fitCache.get(key);
    if (hit === undefined) return null;
    return () => {
      el.style.fontSize = `${hit}px`;
      el.style.visibility = "visible";
    };
  }, [cacheKey]);

  const measure = useCallback(() => {
    const el = elRef.current;
    if (!el || !visibleRef.current) return;
    const limit = contentHeight(el);
    if (limit === 0) return;
    // While editing, the live content is the textarea; otherwise the span.
    const field = el.querySelector("textarea");

    /* Seen this exact fit before? Then it is a style write and nothing
     * else -- no probe, no reflows. Not while editing (see fitCache). */
    const key = cacheKey();
    if (key !== null) {
      const hit = fitCache.get(key);
      if (hit !== undefined) {
        el.style.fontSize = `${hit}px`;
        el.style.visibility = "visible";
        return;
      }
    }
    // Second constraint: no word may be wider than the line, or the title
    // renders split mid-word (see widestWord). Pure arithmetic per step -- the
    // one measurement happens here.
    const cs = getComputedStyle(el);
    const avail =
      el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const probe = avail > 0 ? wordProbeFor(el, field ? field.value : el.textContent ?? "") : null;
    // Headroom, not slack. Landing exactly ON the line width is where the
    // browser decides the word doesn't fit and splits it -- and the same text
    // measures a shade differently inside the Overview's scaled cards than it
    // does at full size (glyph advances quantise against device pixels). One
    // percent absorbs that, so a title breaks between the same words in both
    // views instead of flipping at the boundary.
    const line = avail - (probe?.inset ?? 0);
    const room = line - Math.max(1, line * 0.01);

    // Largest size at which the longest word still fits on one line. Glyph
    // advances aren't linear in font-size (hinting quantises them), so the
    // linear estimate is only a starting point -- but two exact measurements
    // pin it down, which matters: this runs for every card on screen, and a
    // measurement per binary-search step made long beat strips crawl.
    let cap = maxFont;
    if (probe && probe.refWidth > 0) {
      const estimate = (RANK_SIZE * room) / probe.refWidth;
      if (estimate < maxFont) {
        let fs = Math.max(min, Math.min(maxFont, estimate));
        for (let i = 0; i < 2; i++) {
          const w = probe.widthAt(fs);
          const next = Math.max(min, Math.min(maxFont, (fs * room) / w));
          if (Math.abs(next - fs) < 0.25) {
            fs = w > room ? next : fs;
            break;
          }
          fs = next;
        }
        // never leave it a hair too wide -- that's the mid-word break
        while (fs > min && probe.widthAt(fs) > room) fs -= 0.25;
        cap = fs;
      }
    }
    probe?.done();

    /* PREDICT THE SIZE, DON'T HUNT FOR IT. Each probe here sets a font
     * size and reads a height, which forces a layout -- so the count of
     * probes IS the cost, and on a board where nearly every title has to
     * shrink (a tier size larger than most titles fit at) this runs for
     * essentially every card on screen.
     *
     * A blind bisection spends ~6-8 of them halving [min, cap] while
     * learning nothing from what it measured. But the content's height
     * is not arbitrary: wrapped text at font size `fs` occupies roughly
     * `fs` per line AND wraps to roughly `fs`-proportional line count, so
     * height grows about QUADRATICALLY with size. That makes the next
     * guess computable from the last measurement --
     * `fs * sqrt(limit / height)` lands close in one step -- and the
     * bracket is kept honest around it so a bad prediction can only cost
     * an extra probe rather than a wrong answer.
     *
     * Same contract as before: `lo` is always a size that FITS, the
     * search ends when the bracket is under 0.4px, and the element is
     * left at `lo`. */
    const heightAt = (fs: number) => {
      el.style.fontSize = `${fs}px`;
      if (field) field.style.height = "auto";
      return field ? field.scrollHeight : el.scrollHeight;
    };
    // `cap` already satisfies the width rule; the search now only has to find
    // the tallest size that also fits vertically.
    let final = cap;
    let h = heightAt(cap);
    if (h > limit + 1) {
      let lo = min;
      let hi = cap;
      let at = cap;
      let overflowed = true; // cap overflowed -- that is why we are here
      for (let i = 0; i < 10 && hi - lo > 0.4; i++) {
        /* PREDICT AFTER A FIT, BISECT AFTER AN OVERFLOW. The prediction
         * alone is not safe: it approaches from whichever side it is on,
         * so a run of overflows walks `hi` down while `lo` sits at `min`
         * -- and the loop then ends on its iteration cap with `lo` still
         * at the floor. That shipped for about a minute and collapsed 7
         * of 542 titles to 8px. Bisecting after every overflow forces
         * `lo` upward, which is what guarantees the bracket closes on
         * the answer rather than around it; the prediction still does
         * the useful work whenever the last probe fit. */
        let next = overflowed
          ? (lo + hi) / 2
          : at * Math.sqrt(limit / Math.max(1, h));
        if (!(next > lo && next < hi)) next = (lo + hi) / 2;
        at = next;
        h = heightAt(at);
        overflowed = h > limit + 1;
        if (overflowed) hi = at;
        else lo = at;
      }
      el.style.fontSize = `${lo}px`;
      final = lo;
    }
    if (key !== null) {
      /* Bounded: a long session over a big board would otherwise keep
       * every size it ever computed. Clearing wholesale rather than
       * evicting one by one -- this is a cache, and rebuilding it is
       * exactly the work it was already doing before it existed. */
      if (fitCache.size >= FIT_CACHE_MAX) fitCache.clear();
      fitCache.set(key, final);
      fitDirty = true; // persisted on the next hide -- see saveFitCache
    }
    /* LEAVE THE FIELD GROWN, because the search flattened it. `heightAt`
     * measures content by setting `field.style.height = "auto"` -- and a
     * rows=1 textarea at auto is ONE line tall, so opening a wrapped
     * title collapsed it to a single visible line and it stayed that way
     * until the next keystroke, when Editable's own grow ran again
     * (owner-reported 2026-08-14: "the line break goes away until I add
     * or subtract a letter"). The last font size we set is final here, so
     * this is also the right height -- the same two lines Editable runs
     * on every edit, done by whoever disturbed it. */
    if (field) {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    }
    // Reveal now that the font is final (see the visibleOnly branch below): the
    // element is hidden until its first fit lands, so the progressive Overview
    // fills in at the correct size instead of flashing the default 15px first.
    el.style.visibility = "visible";
  }, [maxFont, min, cacheKey]);

  // Callback ref: (re-)wire every time the element mounts. Overview beats swap
  // between a color cell and a text card as you zoom, remounting this element
  // while the component stays alive -- a plain mount-effect would miss that and
  // leave the remounted card unfitted.
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      roRef.current?.disconnect();
      roRef.current = null;
      const prev = elRef.current;
      if (prev && visibleOnly) {
        sharedObserver().unobserve(prev);
        fitters.delete(prev);
        pending.delete(prev);
      }
      elRef.current = el;
      if (!el) return;
      if (visibleOnly) {
        // Fit only when on-screen, queued a few per frame (see sharedObserver).
        // The beat box is a fixed height, so no ResizeObserver is needed
        // (a zoom change re-renders + re-registers). Hidden until the first fit
        // lands (measure() reveals it) so the cell fills in at its final size
        // instead of flashing the CSS-default font first. Still laid out, so the
        // fit can measure it; only the wrong-size paint is skipped.
        el.style.visibility = "hidden";
        visibleRef.current = false;
        const fitter: Fitter = {
          visible: false,
          setVisible: (v) => {
            fitter.visible = v;
            visibleRef.current = v;
          },
          measure,
          cached,
        };
        fitters.set(el, fitter);
        sharedObserver().observe(el);
      } else {
        measure();
        const ro = new ResizeObserver(() => measure());
        ro.observe(el);
        roRef.current = ro;
      }
    },
    [measure, cached, visibleOnly],
  );

  // Re-fit when the committed text -- or the typeface (`fontKey`) -- changes.
  // Neither resizes the box, so the ResizeObserver alone wouldn't catch them,
  // and a different family at the same size wraps differently. measure()
  // no-ops while off-screen.
  //
  // `editing` is here because measure() sizes whatever is RENDERED, and
  // entering or leaving an edit swaps that: a textarea while you type, a span
  // at rest. Those two disagree for an EMPTY title -- the field is blank but
  // the span shows the placeholder -- so a card added and then abandoned kept
  // the size computed for the blank field (42.6px, the expand-to-fill maximum,
  // since nothing could overflow) and painted "New card..." cropped in a 54px
  // box. Nothing else notices: `text` is "" on both sides, the box never
  // resizes and the font never changes. Same family as the fonts.ready case
  // below -- the content changed without any of the usual triggers moving.
  /* `layoutKey` (2026-09-08): anything ELSE that changes the room the
   * words have without changing the words -- the title's top/bottom band,
   * a Corner thumbnail's padding. The ResizeObserver should catch a box
   * that shrinks, and on the scene label it did not reliably (a band
   * change arriving alone left the words at their old size; the same
   * change arriving with a text change re-fit). A dependency is
   * deterministic where an observation was not. */
  useLayoutEffect(() => {
    measure();
  }, [measure, text, opts?.fontKey, opts?.editing, opts?.layoutKey]);

  // Re-fit once webfonts finish loading. A card can mount before its @font-face
  // file lands: `font-display: swap` renders the FALLBACK first, the fit sizes
  // the title against those (narrower) metrics, then the real face swaps in and
  // the text no longer fits -- it overflows its clipped box and reads as "the
  // font size got clobbered". Nothing else re-measures on a swap: the box never
  // resized and the text never changed. Two cards can land on opposite sides of
  // that swap (e.g. one pane mounted at page load, its sibling opened a moment
  // later), which is exactly when the same title shows at two different sizes.
  // document.fonts.ready resolves immediately once fonts are settled, so this
  // costs one microtask per mounted fitter.
  //
  // Queued mode (Overview beats) must NOT measure straight from here: the
  // Overview isn't virtualized, so thousands of cells would resolve at once and
  // reflow the whole thing in a single microtask flush -- the exact thrash the
  // shared observer + per-frame budget exists to prevent. Those go through the
  // queue, and only while on-screen.
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts?.ready) return;
    let alive = true;
    fonts.ready.then(() => {
      if (!alive) return;
      const el = elRef.current;
      if (!visibleOnly) measure();
      else if (el) queueRefit(el);
    });
    return () => {
      alive = false;
    };
  }, [measure, visibleOnly]);

  return { ref, remeasure: measure };
}
