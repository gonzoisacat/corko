import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAccess, clearKey, storedKey, storeKey } from "./access";

/* ------------------------------------------------------------------ *
 *  The client half of the access gate. The invariants worth pinning:
 *
 *   - a network failure is NOT an auth failure: the app must keep working
 *     offline off IndexedDB rather than throw up a password screen every
 *     time the wifi drops (the server still refuses a bad socket, so
 *     optimism here lets nothing through);
 *   - the key survives storage being unavailable (private mode). The test
 *     runner has no localStorage at all, which IS that environment: the
 *     bare identifier throws inside storeKey/storedKey's try/catch, so
 *     these tests exercise the fallback path for real.
 * ------------------------------------------------------------------ */

describe("key storage without localStorage (private mode)", () => {
  it("keeps the key in memory for the page's lifetime", () => {
    expect(storedKey()).toBe("");
    storeKey("hunter2");
    expect(storedKey()).toBe("hunter2"); // the sync provider reads this
    clearKey();
    expect(storedKey()).toBe("");
  });
});

describe("checkAccess", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearKey();
  });

  it("reports what the server says, on 200 and on 401 alike", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(Response.json({ required: true, ok: false }, { status: 401 })),
    );
    expect(await checkAccess("nope")).toEqual({ required: true, ok: false });

    vi.stubGlobal("fetch", () =>
      Promise.resolve(Response.json({ required: true, ok: true })),
    );
    expect(await checkAccess("right")).toEqual({ required: true, ok: true });
  });

  it("sends the stored key when not handed one", async () => {
    let asked = "";
    vi.stubGlobal("fetch", (url: string) => {
      asked = String(url);
      return Promise.resolve(Response.json({ required: true, ok: true }));
    });
    storeKey("from storage & memory");
    await checkAccess();
    expect(asked).toBe("/auth?k=" + encodeURIComponent("from storage & memory"));
  });

  it("treats an unreachable server as open -- offline must not demand a password", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("network down")));
    expect(await checkAccess()).toEqual({ required: false, ok: true });
  });

  it("treats a non-JSON answer (captive portal) the same as unreachable", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("<html>hotel wifi</html>")));
    expect(await checkAccess()).toEqual({ required: false, ok: true });
  });
});
