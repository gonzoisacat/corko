import { scoped } from "./project";

/* ------------------------------------------------------------------ *
 *  WHEN THIS BROWSER WAS LAST IN THIS PROJECT (owner, 2026-09-10).
 *
 *  The reason it exists: a reload should put you back exactly where you
 *  were, but coming back the next morning should ASK which board you
 *  want rather than dropping you into whatever you happened to close.
 *  state/panes.ts already remembers the arrangement; this is the one
 *  number that says whether restoring it silently is the right thing.
 *
 *  WRITTEN WHILE THE TAB IS ALIVE, never on the way out. `beforeunload`
 *  and `pagehide` are not promises -- a killed tab, a crashed renderer
 *  or an OS restart never run them -- and a stamp that fails to land
 *  makes every following boot look like a return from days away, which
 *  is exactly the boot that interrupts you. A heartbeat cannot fail
 *  that way: the worst case is a stamp one beat stale, which moves the
 *  boundary by seconds.
 *
 *  So an open tab counts as being here (his call): leave one running
 *  all day, open a second beside it, and the second restores rather
 *  than asking, because you are plainly mid-session.
 *
 *  SCOPED PER PROJECT, like panes.ts, because that is what the question
 *  is about. Opening a project you have not touched since Tuesday asks,
 *  even if you were in another project ten seconds ago -- the boards it
 *  would restore are boards you have not seen since Tuesday.
 *
 *  The pure half is `isFresh`, which is the whole rule and is pinned.
 * ------------------------------------------------------------------ */

/* TEN MINUTES (his number). Long enough that a reload, a crash, a
 * restart of the dev server or a trip to another tab and back are all
 * plainly the same sitting; short enough that lunch is not. Not a
 * setting: a knob here would need explaining, and the cost of a wrong
 * answer is one Escape. */
export const FRESH_MS = 10 * 60 * 1000;

/* Absent reads as STALE, so a browser that has never been here is asked
 * rather than dropped somewhere. A stamp from the FUTURE reads as fresh:
 * a clock that moved backwards is not a reason to interrupt somebody,
 * and a stale-forever stamp would be. */
export function isFresh(stamp: number | null, now: number, within = FRESH_MS): boolean {
  if (stamp === null || !Number.isFinite(stamp)) return false;
  return stamp > now - within;
}

const KEY = scoped("corko-last-seen");

function read(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null; // storage unavailable: every boot asks, which is the safe way to be wrong
  }
}

function write(now: number) {
  try {
    localStorage.setItem(KEY, String(now));
  } catch {
    /* ignore: the door simply keeps opening */
  }
}

/* THE BEAT. Fast enough that the stamp is never meaningfully behind,
 * slow enough to be free -- one small localStorage write a minute is
 * nothing beside what the doc does. */
const BEAT_MS = 60 * 1000;

export const lastSeen = {
  /* Answer BEFORE the first beat lands, since starting the heartbeat is
   * itself a write. App asks this once, at boot, and holds the answer. */
  wasHereRecently(now = Date.now()): boolean {
    return isFresh(read(), now);
  },
  /* Stamp now, and keep stamping: on a beat, and whenever the tab comes
   * back to the front. The visibility handler matters because a
   * BACKGROUNDED tab has its timers throttled hard, so the beat alone
   * could leave a stamp minutes old on a tab you have been looking at
   * for one second. Returns its own teardown. */
  beat(): () => void {
    write(Date.now());
    const id = setInterval(() => write(Date.now()), BEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") write(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  },
};
