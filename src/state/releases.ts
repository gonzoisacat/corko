/* ------------------------------------------------------------------ *
 *  RELEASES, the pure half of "is this instance behind?" (owner,
 *  2026-10-05: the admin's update light).
 *
 *  A release is a `## X.Y.Z -- date -- kind` heading in CHANGELOG.md,
 *  where kind is "ordinary" or "coordinated reload". The public repo's
 *  main branch only ever holds published releases (scripts/publish.mjs),
 *  so its changelog's newest versioned heading IS the newest release,
 *  and the entries after this instance's version are what an update
 *  would bring.
 *
 *  THE SAME RULES AS scripts/update-corko.mjs, which a copy's Update
 *  Corko workflow runs: that file is fetched alone by curl and cannot
 *  import this one, so the two are kept in step by releases.test.ts,
 *  which runs both over the same changelogs. Change one, change both.
 * ------------------------------------------------------------------ */

export type Version = [number, number, number];

export function parseVersion(v: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/* -1, 0 or 1; an unparseable side sorts lowest, so a garbled version
 * never claims to be newer than a real one. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export interface ReleaseEntry {
  version: string;
  /* the heading's own words after the version: date and kind */
  head: string;
  /* the whole entry, heading included, trimmed */
  text: string;
  coordinated: boolean;
}

/* Every versioned entry in the changelog, newest first as written.
 * "## Unreleased" and anything else without a version is skipped. */
export function readChangelog(changelog: string): ReleaseEntry[] {
  const out: ReleaseEntry[] = [];
  for (const part of changelog.split(/^(?=## )/m)) {
    const head = /^## (\d+\.\d+\.\d+)\b(.*)$/m.exec(part);
    if (!head) continue;
    out.push({
      version: head[1],
      head: head[2].replace(/^\s*--\s*/, "").trim(),
      text: part.trim(),
      coordinated: /coordinated reload/i.test(head[2]),
    });
  }
  return out;
}

/* The newest release the changelog names, or null. */
export function latestRelease(changelog: string): ReleaseEntry | null {
  const all = readChangelog(changelog);
  if (!all.length) return null;
  return all.reduce((best, e) => (compareVersions(e.version, best.version) > 0 ? e : best));
}

/* The entries after `from`, up to and including `to`, newest first;
 * `coordinated` is whether ANY of them asks everyone to reload. */
export function entriesBetween(changelog: string, from: string, to: string): { entries: ReleaseEntry[]; coordinated: boolean } {
  const entries = readChangelog(changelog)
    .filter((e) => compareVersions(e.version, from) > 0 && compareVersions(e.version, to) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
  return { entries, coordinated: entries.some((e) => e.coordinated) };
}

export type ReleaseStatus =
  | { kind: "unknown" }
  | { kind: "current"; current: string; latest: string }
  | { kind: "available"; current: string; latest: string; entries: ReleaseEntry[]; coordinated: boolean };

/* What the light says, from this build's version and the public
 * changelog. AHEAD counts as current: the maintainer's own instance is
 * deployed before it is published, so for a while it is newer than the
 * public repo, and that is not news to anybody. */
export function releaseStatus(current: string, changelog: string | null): ReleaseStatus {
  if (!changelog || !parseVersion(current)) return { kind: "unknown" };
  const latest = latestRelease(changelog);
  if (!latest) return { kind: "unknown" };
  if (compareVersions(latest.version, current) <= 0) return { kind: "current", current, latest: latest.version };
  const { entries, coordinated } = entriesBetween(changelog, current, latest.version);
  return { kind: "available", current, latest: latest.version, entries, coordinated };
}
