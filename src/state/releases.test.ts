import { describe, expect, it } from "vitest";
import { compareVersions, entriesBetween, latestRelease, parseVersion, readChangelog, releaseStatus } from "./releases";
// @ts-expect-error -- a plain .mjs script, no types
import * as updater from "../../scripts/update-corko.mjs";

const LOG = [
  "# Changelog",
  "",
  "Intro text that mentions a coordinated reload in passing.",
  "",
  "## Unreleased",
  "",
  "- something not out yet",
  "",
  "## 0.9.10 -- 2026-10-20 -- ordinary (epoch 2)",
  "- ten",
  "",
  "## 0.9.9 -- 2026-10-12 -- coordinated reload (epoch 2)",
  "- nine",
  "",
  "## 0.9.5 -- 2026-09-25 -- ordinary (epoch 1)",
  "- five",
].join("\n");

describe("releases", () => {
  it("reads versions and orders them numerically", () => {
    expect(parseVersion("v0.9.10")).toEqual([0, 9, 10]);
    expect(parseVersion("0.9")).toBeNull();
    expect(compareVersions("0.9.10", "0.9.9")).toBe(1);
    expect(compareVersions("0.9.5", "0.9.5")).toBe(0);
    expect(compareVersions("garbage", "0.0.1")).toBe(-1);
  });

  it("reads the versioned entries and skips Unreleased", () => {
    const all = readChangelog(LOG);
    expect(all.map((e) => e.version)).toEqual(["0.9.10", "0.9.9", "0.9.5"]);
    expect(all[1].coordinated).toBe(true);
    expect(all[0].head).toBe("2026-10-20 -- ordinary (epoch 2)");
    expect(latestRelease(LOG)?.version).toBe("0.9.10");
  });

  it("says what an update would bring, and whether anything in it needs a reload together", () => {
    const s = releaseStatus("0.9.5", LOG);
    expect(s.kind).toBe("available");
    if (s.kind !== "available") return;
    expect(s.latest).toBe("0.9.10");
    expect(s.entries.map((e) => e.version)).toEqual(["0.9.10", "0.9.9"]);
    expect(s.coordinated).toBe(true);
    const one = releaseStatus("0.9.9", LOG);
    expect(one.kind === "available" && one.coordinated).toBe(false);
  });

  it("is current when level, and when AHEAD of the public repo", () => {
    expect(releaseStatus("0.9.10", LOG)).toEqual({ kind: "current", current: "0.9.10", latest: "0.9.10" });
    expect(releaseStatus("0.9.11", LOG).kind).toBe("current");
  });

  it("knows nothing without a changelog or a version", () => {
    expect(releaseStatus("0.9.5", null).kind).toBe("unknown");
    expect(releaseStatus("0.0.0-dev", LOG).kind).toBe("unknown");
    expect(releaseStatus("0.9.5", "# no releases here").kind).toBe("unknown");
  });

  it("AGREES WITH THE UPDATER (scripts/update-corko.mjs) on the same changelog", () => {
    for (const [from, to] of [
      ["0.9.5", "0.9.10"],
      ["0.9.9", "0.9.10"],
      ["0.9.5", "0.9.9"],
      ["0.9.10", "0.9.10"],
    ]) {
      const mine = entriesBetween(LOG, from, to);
      const theirs = updater.entriesBetween(LOG, from, to);
      expect(mine.entries.map((e) => e.version).sort()).toEqual(theirs.entries.map((e: { version: string }) => e.version).sort());
      expect(mine.coordinated).toBe(theirs.coordinated);
    }
    expect(compareVersions("0.10.0", "0.9.99")).toBe(updater.compareVersions("0.10.0", "0.9.99"));
  });
});
