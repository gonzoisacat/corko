import { beforeEach, describe, expect, it, vi } from "vitest";

/* The node runner has no localStorage, and unlike fold.ts -- which is
 * happy to degrade to memory -- persistence is half of what this module
 * does, so give it a real one. Scoped to this file rather than
 * test/setup.ts: fold.test.ts deliberately runs WITHOUT storage. */
if (typeof globalThis.localStorage === "undefined") {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    },
    configurable: true,
  });
}

/* ------------------------------------------------------------------ *
 *  Per-board looks (2026-08-03).
 *
 *  The module reads localStorage at import time and keeps its state in
 *  module scope, so each test re-imports it fresh (vitest.resetModules)
 *  after seeding storage. What matters here:
 *
 *   - a board's look = your defaults + that board's tweaks, and two
 *     boards genuinely differ (the whole feature);
 *   - the resolved object is IDENTITY-STABLE, because it is handed to
 *     every card through the pane context and the Overview is not
 *     virtualized;
 *   - `noteAuthor` is global however it is reached -- your name is your
 *     name on every board;
 *   - the pre-per-board key still loads, so nobody's saved look is lost.
 * ------------------------------------------------------------------ */

type Mod = typeof import("./settings");

async function fresh(seed?: { defaults?: unknown; boards?: unknown }): Promise<Mod> {
  localStorage.clear();
  if (seed?.defaults) localStorage.setItem("corko-settings", JSON.stringify(seed.defaults));
  if (seed?.boards) localStorage.setItem("corko-board-settings", JSON.stringify(seed.boards));
  vi.resetModules(); // the module reads storage once, at import
  return import("./settings");
}

beforeEach(() => localStorage.clear());

describe("resolution", () => {
  it("an untweaked board is exactly your defaults", async () => {
    const s = await fresh({ defaults: { boardBg: "slate" } });
    expect(s.settingsFor("board-1").boardBg).toBe("slate");
    expect(s.hasTweaks("board-1")).toBe(false);
  });

  it("two boards can differ -- the point of the whole thing", async () => {
    const s = await fresh({ defaults: { boardBg: "cork" } });
    s.setSetting("board-a", "boardBg", "slate");

    expect(s.settingsFor("board-a").boardBg).toBe("slate");
    expect(s.settingsFor("board-b").boardBg).toBe("cork"); // untouched
  });

  it("a tweak back to the default stops being a tweak", async () => {
    const s = await fresh({ defaults: { boardBg: "cork" } });
    s.setSetting("board-a", "boardBg", "slate");
    expect(s.hasTweaks("board-a")).toBe(true);

    s.setSetting("board-a", "boardBg", "cork");
    expect(s.hasTweaks("board-a")).toBe(false); // no dead layer left behind
  });

  it("an empty board id edits the defaults directly (the New-board modal)", async () => {
    const s = await fresh();
    s.setSetting("", "boardBg", "slate");
    expect(s.settingsFor("anything-at-all").boardBg).toBe("slate");
  });
});

describe("identity stability", () => {
  it("returns the SAME object until something actually changes", async () => {
    const s = await fresh();
    const first = s.settingsFor("board-1");
    expect(s.settingsFor("board-1")).toBe(first);

    s.setSetting("board-1", "cardTilt", !first.cardTilt);
    expect(s.settingsFor("board-1")).not.toBe(first);
  });

  it("an untweaked board shares the defaults object rather than copying", async () => {
    const s = await fresh();
    expect(s.settingsFor("board-1")).toBe(s.settingsFor("board-2"));
  });
});

describe("global keys", () => {
  it("noteAuthor is global however it is reached", async () => {
    const s = await fresh();
    s.setSetting("board-a", "noteAuthor", "Robin");

    expect(s.settingsFor("board-b").noteAuthor).toBe("Robin"); // not board-a's alone
    expect(s.hasTweaks("board-a")).toBe(false); // and it left no per-board layer
  });

  it("names which keys are global, so the split is stated not implied", async () => {
    const s = await fresh();
    expect(s.isGlobalSetting("noteAuthor")).toBe(true);
    expect(s.isGlobalSetting("boardBg")).toBe(false);
    expect(s.isGlobalSetting("selectionColor")).toBe(false);
  });
});

describe("the two buttons", () => {
  it("save-as-defaults promotes this board's look and clears its tweaks", async () => {
    const s = await fresh({ defaults: { boardBg: "cork" } });
    s.setSetting("board-a", "boardBg", "slate");

    s.saveAsDefaults("board-a");

    expect(s.settingsFor("board-a").boardBg).toBe("slate");
    expect(s.settingsFor("board-b").boardBg).toBe("slate"); // every untweaked board follows
    expect(s.hasTweaks("board-a")).toBe(false); // the layer would now change nothing
  });

  it("save-as-defaults leaves OTHER boards' tweaks alone", async () => {
    const s = await fresh({ defaults: { boardBg: "cork" } });
    s.setSetting("board-a", "boardBg", "slate");
    s.setSetting("board-b", "boardBg", "default");

    s.saveAsDefaults("board-a");

    expect(s.settingsFor("board-b").boardBg).toBe("default"); // still its own
  });

  it("reset drops this board's tweaks and nothing else", async () => {
    const s = await fresh({ defaults: { boardBg: "cork" } });
    s.setSetting("board-a", "boardBg", "slate");
    s.setSetting("board-b", "cardTilt", false);

    s.resetToDefaults("board-a");

    expect(s.settingsFor("board-a").boardBg).toBe("cork");
    expect(s.settingsFor("board-b").cardTilt).toBe(false);
  });
});

describe("persistence", () => {
  it("the pre-per-board key still loads, as your defaults", async () => {
    // exactly what a browser from before this change has on disk
    const s = await fresh({ defaults: { boardBg: "slate", cardTilt: false } });
    expect(s.settingsFor("").boardBg).toBe("slate");
    expect(s.settingsFor("").cardTilt).toBe(false);
  });

  it("tweaks survive a reload", async () => {
    const s = await fresh();
    s.setSetting("board-a", "boardBg", "slate");

    const again = await fresh({
      defaults: JSON.parse(localStorage.getItem("corko-settings")!),
      boards: JSON.parse(localStorage.getItem("corko-board-settings")!),
    });
    expect(again.settingsFor("board-a").boardBg).toBe("slate");
  });

  it("stores only what differs, so a board you never touched costs nothing", async () => {
    const s = await fresh();
    s.setSetting("board-a", "cardTilt", !s.settingsFor("").cardTilt);
    const stored = JSON.parse(localStorage.getItem("corko-board-settings")!);
    expect(Object.keys(stored)).toEqual(["board-a"]);
    expect(Object.keys(stored["board-a"])).toEqual(["cardTilt"]);
  });

  it("the first draft's `lookMine` carries over as the backdrop override", async () => {
    const s = await fresh({ defaults: { lookMine: true } });
    expect(s.settingsFor("").overrideBackdrop).toBe(true);
    expect("lookMine" in s.settingsFor("")).toBe(false);
  });

  it("a retired legacy background normalizes on the way in", async () => {
    const s = await fresh({ defaults: { boardBg: "white" } });
    expect(s.settingsFor("").boardBg).toBe("custom");
    expect(s.settingsFor("").customBg).toBe("#ffffff");
  });
});

describe("looks", () => {
  it("a preset applies to one board only", async () => {
    const s = await fresh();
    const dark = s.LOOKS.find((l) => l.id === "modern-dark")!;
    s.applyLook("board-a", dark);

    expect(s.matchesLook(s.settingsFor("board-a"), dark)).toBe(true);
    expect(s.matchesLook(s.settingsFor("board-b"), dark)).toBe(false);
  });

  it("DEFAULTS still match the leading preset -- a first run must highlight one", async () => {
    const s = await fresh();
    expect(s.matchesLook(s.settingsFor(""), s.LOOKS[0])).toBe(true);
  });
});
