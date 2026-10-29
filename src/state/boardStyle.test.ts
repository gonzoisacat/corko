import { describe, expect, it } from "vitest";
import { carryOver, resolveStyle, sanitizeStyle, STYLE_DEFAULTS, STYLE_KEYS } from "./boardStyle";
import { bindBoardStyles, ownSettingsFor, setOwnSetting, setSetting, settingsFor } from "./settings";
import type { BoardStyle } from "./boardStyle";

/* A BOARD'S LOOK IS THE BOARD'S (owner, 2026-10-29). The rule is the
 * backdrop's: switch off, the board's (its style over the APP's
 * defaults, never yours); switch on, yours whole. */

describe("resolveStyle", () => {
  const mine = { ...settingsFor(""), cardTilt: false, frame: true, wallColor: "#111111", overrideBackdrop: false };

  it("shows the board's, over the app's defaults, with the switch off", () => {
    const r = resolveStyle(mine, { frame: true, frameStyle: "wood" });
    expect(r.frame).toBe(true);
    expect(r.frameStyle).toBe("wood");
    expect(r.cardTilt).toBe(STYLE_DEFAULTS.cardTilt); // not mine
    expect(r.wallColor).toBe(STYLE_DEFAULTS.wallColor);
  });

  it("an undressed board wears the defaults, never the viewer's own", () => {
    const r = resolveStyle(mine, undefined);
    for (const k of STYLE_KEYS) expect(r[k]).toEqual(STYLE_DEFAULTS[k]);
  });

  it("shows yours, whole, with the switch on", () => {
    const on = { ...mine, overrideBackdrop: true };
    expect(resolveStyle(on, { frame: false, cardTilt: true })).toBe(on);
  });

  it("leaves everything that is not the look alone", () => {
    const r = resolveStyle({ ...mine, uiTheme: "dark", legendCollapsed: true }, { frame: false });
    expect(r.uiTheme).toBe("dark");
    expect(r.legendCollapsed).toBe(true);
  });
});

describe("sanitizeStyle", () => {
  it("keeps what this build can draw and drops the rest", () => {
    expect(
      sanitizeStyle({
        frame: true,
        frameStyle: "brass",
        frameScale: 0,
        pushpinColor: "#ABCDEF",
        cardImages: "only",
        wallImage: "st-wall-x1",
        noteDots: "yes",
        future: 1,
      }),
    ).toEqual({ frame: true, frameScale: 1, pushpinColor: "#ABCDEF", cardImages: "only", wallImage: "st-wall-x1" });
  });

  it("refuses a personal wall key, which no one else could fetch", () => {
    expect(sanitizeStyle({ wallImage: "wall-bd-1-abc" })).toBeNull();
  });

  it("is null for nothing usable, so an empty style is never stored", () => {
    expect(sanitizeStyle({})).toBeNull();
    expect(sanitizeStyle(null)).toBeNull();
    expect(sanitizeStyle([1])).toBeNull();
  });
});

describe("carryOver (the one-time changeover)", () => {
  it("carries only what differs from the app's defaults, and never the wall's bytes", () => {
    const own = { ...STYLE_DEFAULTS, frame: true, cardTilt: false, wallImage: "wall-bd-1-abc" };
    expect(carryOver(own)).toEqual({ frame: true, cardTilt: false });
  });

  it("carries nothing for a browser on the defaults", () => {
    expect(carryOver({ ...STYLE_DEFAULTS })).toEqual({});
  });
});

describe("settings route the look by the switch", () => {
  it("a board control writes the board's with the switch off, yours with it on", () => {
    const store = new Map<string, BoardStyle>();
    bindBoardStyles({
      read: (id) => store.get(id),
      write: (id, patch) => store.set(id, { ...(store.get(id) ?? {}), ...patch }),
    });
    setOwnSetting("", "overrideBackdrop", false);
    setSetting("bd-route", "frame", true);
    expect(store.get("bd-route")).toEqual({ frame: true });
    expect(ownSettingsFor("bd-route").frame).toBe(false); // yours untouched

    setOwnSetting("", "overrideBackdrop", true);
    setSetting("bd-route", "cardTilt", false);
    expect(store.get("bd-route")).toEqual({ frame: true }); // the board's untouched
    expect(ownSettingsFor("bd-route").cardTilt).toBe(false);
    expect(settingsFor("bd-route").frame).toBe(false); // yours showing
    setOwnSetting("", "overrideBackdrop", false);
  });
});
