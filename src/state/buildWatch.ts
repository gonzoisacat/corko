/* ------------------------------------------------------------------ *
 *  IS THIS TAB RUNNING THE DEPLOYED BUILD? (owner, 2026-09-10: "add an
 *  indicator somewhere that will light up on an old deployment when a
 *  new deployment goes up".)
 *
 *  Ten people share this deployment and a deploy does not disturb the
 *  tabs already open -- they keep running the bundle they loaded, for
 *  days, and nothing tells anybody. This is the thing that tells them.
 *
 *  IT ASKS THE PAGE, NOT A SERVER. There is no version endpoint and
 *  none was added. A build's identity is already written down in the
 *  one file every client fetches -- index.html names the hashed asset
 *  it wants -- so this fetches that file and compares the names to the
 *  ones in its own head. That is exactly the check the deploy ritual
 *  runs by hand (CLAUDE.md: compare live index.html's bundle names
 *  against `dist/` as a set), which is the reason to trust it: it has
 *  been the proof a deploy landed for months.
 *
 *  So there is no Worker change, no build constant to keep in step, no
 *  generated file, and nothing to forget. `readBuild` is ONE statement
 *  of what identifies a build, run over this document's own head and
 *  over the fetched one, which is the dropPlan discipline: two answers
 *  to one question drift, so there is only ever one function.
 *
 *  THE EPOCH IS THE HAND-BUMPED HALF, and it has to be, because the
 *  question it answers is a judgment nobody can compute: is this the
 *  kind of deploy where an old tab's writes are no longer safe? That is
 *  the coordinated-reload event CLAUDE.md already makes you declare on
 *  every deploy; the meta tag in index.html is that declaration written
 *  down where an OLD client can read it. Bump it in the same commit as
 *  the doc-shape change and the team's open tabs go red.
 *  (`FIT_STORE_V` in ui/useFitText.ts is the same house pattern: a
 *  hand-bumped integer for a shape change nothing can sniff.)
 *
 *  THE STATE ONLY EVER CLIMBS. A deploy does not un-happen, and the
 *  edge serves the old and new bundles alternately while it rolls out
 *  (the reason the deploy proof polls four times) -- so a watcher that
 *  believed each poll would flicker green and yellow for a minute. Once
 *  a different build has been seen, this tab is behind, whatever the
 *  next poll happens to hand back.
 * ------------------------------------------------------------------ */

/* GREEN / YELLOW / RED, in his words: "Latest build loaded", "Minor
 * update available (reload)", "Critical update available (reload
 * ASAP)". The order here IS the ladder the state climbs. */
export type BuildState = "latest" | "update" | "critical";

const RANK: Record<BuildState, number> = { latest: 0, update: 1, critical: 2 };

export interface BuildStamp {
  /* Every hashed asset the document names, sorted and joined -- a SET,
   * not a list, because the order in the file is vite's business. CSS
   * counts: a stylesheet-only change is still a new build to look at. */
  assets: string;
  /* The coordinated-reload counter. Absent reads as 0, so a build from
   * before this existed compares as the oldest possible rather than as
   * a mismatch that would paint every tab red on the first deploy. */
  epoch: number;
}

const ASSET_RE = /\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g;
const EPOCH_RE = /<meta[^>]+name=["']corko-build-epoch["'][^>]*>/i;
const CONTENT_RE = /content=["']([^"']*)["']/i;

/* Over this document's head, and over the fetched one. A string in,
 * because that is what both sides can offer and what a test can pin. */
export function readBuild(html: string): BuildStamp {
  const found = html.match(ASSET_RE) ?? [];
  const assets = [...new Set(found)].sort().join(" ");
  const tag = html.match(EPOCH_RE)?.[0] ?? "";
  const n = Number(tag.match(CONTENT_RE)?.[1]);
  return { assets, epoch: Number.isFinite(n) ? n : 0 };
}

/* WHAT A COMPARISON MEANS. The epoch is asked first: a deploy that
 * bumps it is always critical, whatever the assets say.
 *
 * A HIGHER epoch, never merely a different one. Rolling back leaves
 * clients ahead of the deployment, which is not an emergency -- the
 * assets still differ, so it reads as an ordinary update, which is what
 * it is. And a build with no assets at all (a dev server, whose entry
 * is not hashed) matches everything and therefore stays green, which is
 * why this needs no environment check to stay quiet in dev. */
export function compareBuild(mine: BuildStamp, live: BuildStamp): BuildState {
  if (live.epoch > mine.epoch) return "critical";
  if (live.assets !== mine.assets) return "update";
  return "latest";
}

/* The worse of two, so a caller can fold a fresh reading into what it
 * already knows without restating the ladder. */
export function worse(a: BuildState, b: BuildState): BuildState {
  return RANK[b] > RANK[a] ? b : a;
}

/* ------------------------------------------------------------------ *
 *  The live half: this tab's own stamp, the poll, and the store the
 *  indicator subscribes to.
 * ------------------------------------------------------------------ */

let own: BuildStamp | null = null;
/* The head only, not the whole document: everything hashed is in there
 * (vite hoists the entry script and the stylesheet into it), and the
 * body is a board with thousands of cards in it. Read once -- the tags
 * this looks at are the ones React never touches. */
function ownStamp(): BuildStamp {
  if (!own) own = readBuild(document.head.outerHTML);
  return own;
}

let state: BuildState = "latest";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/* Cache-busted AND `no-store`: between the browser's cache, the edge's
 * and any proxy in the way, asking politely is not enough -- the whole
 * point is to be told about a file that just changed. */
async function poll(): Promise<void> {
  try {
    const res = await fetch(`/?build=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return; // a 401 gate or a blip says nothing about the build
    const next = worse(state, compareBuild(ownStamp(), readBuild(await res.text())));
    if (next === state) return;
    state = next;
    emit();
  } catch {
    /* offline, or the deploy is mid-flight: silence is the right answer,
       and the next poll asks again */
  }
}

/* THREE MINUTES. The thing being watched changes a few times a week, so
 * this is about how long somebody keeps typing into a tab that has gone
 * stale, not about catching a deploy quickly. Paired with a check when
 * the tab comes back to the front, which is when somebody is about to
 * start working again and the answer matters most -- and which covers
 * the background throttling that would otherwise stretch the interval
 * out to minutes anyway. */
const POLL_MS = 3 * 60 * 1000;

export const buildWatch = {
  get: (): BuildState => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /* Starts the watch and returns its teardown. Stops for good once it
   * has seen a critical deploy: the light cannot say anything worse,
   * and the reload is the only thing left to do. */
  start(): () => void {
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      if (state === "critical") return stop();
      void poll();
    };
    const id = setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    const stop = () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    void poll();
    return stop;
  },
  /* Dev only, through `corko.build(...)` (ui/layoutDoctor.ts): drive the
   * light to a state so its three faces can be looked at without
   * deploying twice. */
  force(s: BuildState) {
    state = s;
    emit();
  },
};
