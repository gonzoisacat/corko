import { releaseStatus, type ReleaseStatus } from "./releases";

/* ------------------------------------------------------------------ *
 *  IS THIS INSTANCE BEHIND THE NEWEST CORKO RELEASE? (owner, 2026-10-05)
 *
 *  The deploy light (buildWatch.ts) asks whether this TAB runs what the
 *  instance serves. This asks whether the INSTANCE runs the newest
 *  release -- a question for whoever deploys it, so only an admin's
 *  browser asks (board/ReleaseStatus.tsx gates it).
 *
 *  It reads the public repo's CHANGELOG.md from GitHub's raw file host,
 *  which serves it to any page. Its newest versioned heading is the
 *  newest release, because the public main only ever holds published
 *  releases. One fetch, then the answer is remembered in this browser
 *  for SIX HOURS -- releases come a few times a month, and an admin's
 *  browser contacting GitHub on every load would be a habit nobody
 *  asked for. A failure is silence: the light hides rather than guess.
 *
 *  This build's own version is package.json's, written in at build time
 *  (__CORKO_VERSION__, vite.config.ts).
 * ------------------------------------------------------------------ */

export const UPSTREAM = "gonzoisacat/corko";
export const CHANGELOG_URL = `https://raw.githubusercontent.com/${UPSTREAM}/main/CHANGELOG.md`;
export const RELEASE_NOTES_URL = `https://github.com/${UPSTREAM}/blob/main/CHANGELOG.md`;
export const CURRENT: string = typeof __CORKO_VERSION__ === "string" ? __CORKO_VERSION__ : "";

const CACHE_KEY = "corko-release-check";
const FRESH_MS = 6 * 60 * 60 * 1000;

let status: ReleaseStatus = { kind: "unknown" };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readCache(): { at: number; changelog: string } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: unknown; changelog?: unknown };
    return typeof v.at === "number" && typeof v.changelog === "string" ? { at: v.at, changelog: v.changelog } : null;
  } catch {
    return null;
  }
}

function settle(changelog: string | null) {
  status = releaseStatus(CURRENT, changelog);
  emit();
}

async function check(): Promise<void> {
  const cached = readCache();
  if (cached && Date.now() - cached.at < FRESH_MS) return settle(cached.changelog);
  try {
    const res = await fetch(CHANGELOG_URL, { cache: "no-store" });
    if (!res.ok) return settle(cached?.changelog ?? null);
    const changelog = await res.text();
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), changelog }));
    } catch {
      /* storage off: ask again next load, which is harmless */
    }
    settle(changelog);
  } catch {
    settle(cached?.changelog ?? null); // offline: the last answer, or silence
  }
}

let started = false;

export const releaseWatch = {
  get: (): ReleaseStatus => status,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /* Once per page; the six-hour memory makes a long-lived tab ask
   * again only when it is next loaded, which is often enough. */
  start(): void {
    if (started) return;
    started = true;
    void check();
  },
  /* Dev only, through `corko.release(...)` (ui/layoutDoctor.ts): show
   * the light as if the public repo held `latest`, coordinated or not,
   * so both faces can be looked at without publishing anything. */
  force(latest: string, coordinated = false) {
    const kind = coordinated ? "coordinated reload (epoch 2)" : "ordinary (epoch 1)";
    settle(
      `## ${latest} -- 2026-10-05 -- ${kind}\n\n- A pretend release for looking at the light.\n- A second line of notes.\n\n## ${CURRENT} -- 2026-09-25 -- ordinary (epoch 1)\n\n- This build.\n`,
    );
  },
};
