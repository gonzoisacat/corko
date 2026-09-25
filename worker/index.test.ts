import { describe, expect, it } from "vitest";
import worker, { authState, type Env } from "./index";
import { hashPassword, projectsForPassword } from "./access";

/* ------------------------------------------------------------------ *
 *  The Worker's routing + access gate, headless.
 *
 *  These run in Node against the module's exports -- no Durable Object,
 *  no wrangler. The room itself (CorkoRoom) needs a real runtime and is
 *  covered by `npm run verify:sync` (against the deployment, or a local
 *  `wrangler dev` via `node scripts/verify-sync.mjs 127.0.0.1:8787`).
 *  What CAN be pinned headless is the part that guards the owner's data:
 *
 *   - the gate fails OPEN only when no password is configured at all;
 *   - /auth (what the UI reports) and /sync (what is enforced) cannot
 *     disagree, because both go through authState -- asserted here by
 *     driving both routes against the same env;
 *   - a refused /sync never reaches the room.
 * ------------------------------------------------------------------ */

function mockEnv(password?: string, access?: Record<string, string[] | "*">): { env: Env; log: string[] } {
  const log: string[] = [];
  const registry: string[] = [];
  const passwords: Record<string, string> = {};
  const plain: Record<string, string> = {};
  let adminHash = "";
  const salt = "test-salt";
  const env = {
    CORKO_PASSWORD: password,
    CORKO_ACCESS: access ? JSON.stringify(access) : undefined,
    CORKO_ROOM: {
      idFromName: (name: string) => ({ name }),
      get: ({ name }: { name: string }) => ({
        fetch: async (r: Request) => {
          const path = new URL(r.url).pathname;
          if (path === "/password") {
            const { id, password } = (await r.json()) as { id: string; password: string };
            if (password) {
              passwords[id] = await hashPassword(salt, password);
              plain[id] = password;
            } else {
              delete passwords[id];
              delete plain[id];
            }
            return new Response(null, { status: 204 });
          }
          if (path === "/passwords") return Response.json({ ids: Object.keys(passwords).sort(), plain });
          if (path === "/admin") {
            if (r.method === "PUT") {
              const { password } = (await r.json()) as { password: string };
              adminHash = password ? await hashPassword(salt, password) : "";
              return new Response(null, { status: 204 });
            }
            return Response.json({ set: !!adminHash });
          }
          if (path === "/verify") {
            const { password } = (await r.json()) as { password: string };
            const admin = !!password && !!adminHash && (await hashPassword(salt, password)) === adminHash;
            return Response.json({ admin, ids: await projectsForPassword(salt, passwords, password) });
          }
          if (path === "/registry") {
            if (r.method === "POST") {
              const { id } = (await r.json()) as { id: string };
              if (!registry.includes(id)) registry.push(id);
              return Response.json({ ok: true, id });
            }
            return Response.json(registry);
          }
          if (new URL(r.url).pathname === "/stats") {
            log.push(`stats:${name}`);
            return Promise.resolve(Response.json({ title: `T ${name}`, boards: name.length, touched: 7 }));
          }
          log.push("room");
          return Promise.resolve(new Response("room"));
        },
      }),
    },
    ASSETS: {
      fetch: () => {
        log.push("assets");
        return Promise.resolve(new Response("asset"));
      },
    },
  } as unknown as Env;
  return { env, log };
}

const req = (path: string) => new Request(`https://corko.example${path}`);

describe("authState", () => {
  it("fails open ONLY when no password is configured", async () => {
    const open = { env: mockEnv().env };
    const openState = { required: false, ok: true, projects: ["default"], admin: true, setup: true };
    expect(await authState(open.env, null)).toEqual(openState);
    expect(await authState(open.env, "anything")).toEqual(openState);
  });

  it("requires an exact match once a password is set", async () => {
    const { env } = mockEnv("hunter2");
    expect(await authState(env, null)).toEqual({ required: true, ok: false });
    expect(await authState(env, "")).toEqual({ required: true, ok: false });
    expect(await authState(env, "hunter3")).toEqual({ required: true, ok: false }); // same length
    expect(await authState(env, "hunter2 ")).toEqual({ required: true, ok: false });
    expect(await authState(env, "hunter2")).toEqual({ required: true, ok: true, projects: ["default"], admin: true });
  });

  it("with an access map, a password opens its own projects and only the deployer's opens all", async () => {
    const { env } = mockEnv("legacy", { teamA: ["acme"], boss: "*" });
    expect(await authState(env, "teamA")).toEqual({ required: true, ok: true, projects: ["acme"], admin: false });
    expect(await authState(env, "boss")).toEqual({ required: true, ok: true, projects: ["default", "acme"], admin: true });
    expect(await authState(env, "legacy")).toEqual({ required: true, ok: true, projects: ["default", "acme"], admin: true });
    expect(await authState(env, "nope")).toEqual({ required: true, ok: false });
  });
});

describe("routing", () => {
  it("/auth reports open on an unconfigured deployment", async () => {
    const { env } = mockEnv();
    const res = await worker.fetch(req("/auth"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ required: false, ok: true, projects: ["default"], admin: true, setup: true });
  });

  it("/auth distinguishes wrong password from right", async () => {
    const { env } = mockEnv("hunter2");
    const wrong = await worker.fetch(req("/auth?k=nope"), env);
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ required: true, ok: false });

    const right = await worker.fetch(req("/auth?k=hunter2"), env);
    expect(right.status).toBe(200);
    expect(await right.json()).toEqual({ required: true, ok: true, projects: ["default"], admin: true });
  });

  it("a refused /sync is 401 and never reaches the room", async () => {
    const { env, log } = mockEnv("hunter2");
    const res = await worker.fetch(req("/sync/corko-default?k=wrong"), env);
    expect(res.status).toBe(401);
    expect(log).toEqual([]); // neither the room nor the assets saw it
  });

  it("/sync with the right key reaches the room", async () => {
    const { env, log } = mockEnv("hunter2");
    await worker.fetch(req("/sync/corko-default?k=hunter2"), env);
    expect(log).toEqual(["room"]);
  });

  it("/sync on an unconfigured deployment is open -- the fail-open contract", async () => {
    const { env, log } = mockEnv();
    await worker.fetch(req("/sync/corko-default"), env);
    expect(log).toEqual(["room"]);
  });

  it("/auth and /sync agree, wrong and right, because both go through authState", async () => {
    const { env, log } = mockEnv("hunter2");
    for (const k of ["", "?k=wrong", "?k=hunter2"]) {
      const auth = await worker.fetch(req(`/auth${k}`), env);
      log.length = 0;
      await worker.fetch(req(`/sync/corko-room${k}`), env);
      const syncReachedRoom = log.includes("room");
      expect(syncReachedRoom).toBe(auth.status === 200);
    }
  });

  it("everything else is the app", async () => {
    const { env, log } = mockEnv("hunter2");
    await worker.fetch(req("/some/deep/link"), env);
    expect(log).toEqual(["assets"]);
  });
});

/* ------------------------------------------------------------------ *
 *  SHARED STILLS (Phase C).
 *
 *  The gate is the reason these exist. Boards sit behind CORKO_PASSWORD,
 *  and a public bucket URL would leave the cut gated and the pictures
 *  open to anyone with a link -- so every still route runs the SAME
 *  `authState` that /auth and /sync drive, and that is asserted here by
 *  driving them against one env rather than trusting they still call it.
 * ------------------------------------------------------------------ */
function bucketEnv(password?: string) {
  const store = new Map<string, { body: string; size: number; uploaded: Date }>();
  const puts: string[] = [];
  const base = mockEnv(password);
  const bucket = {
    get: async (k: string) =>
      store.has(k)
        ? { body: store.get(k)!.body, httpMetadata: { contentType: "image/jpeg" }, httpEtag: '"e"' }
        : null,
    head: async (k: string) => (store.has(k) ? { key: k, uploaded: store.get(k)!.uploaded } : null),
    put: async (k: string) => {
      /* The body is a ReadableStream here, so what is recorded is the
       * WRITE rather than the bytes -- which is the thing the idempotence
       * test is actually about. */
      puts.push(k);
      store.set(k, { body: k, size: 10, uploaded: new Date() });
    },
    delete: async (k: string) => {
      store.delete(k);
    },
    list: async () => ({
      objects: [...store].map(([key, v]) => ({ key, size: v.size, uploaded: v.uploaded })),
      truncated: false,
    }),
  };
  /* Backdate an object past the purge's grace period -- what a real
   * bucket holds for anything older than a day. */
  const age = (k: string) => {
    store.get(k)!.uploaded = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  };
  return { env: { ...base.env, CORKO_STILLS: bucket } as unknown as Env, store, puts, age };
}
const sreq = (path: string, init?: RequestInit) =>
  new Request(`https://corko.example${path}`, init);

describe("still routes", () => {
  it("refuses every method without the password", async () => {
    const { env } = bucketEnv("hunter2");
    for (const method of ["GET", "PUT", "DELETE"]) {
      const r = await worker.fetch(sreq("/still/st-abc", { method }), env);
      expect(r.status, method).toBe(401);
    }
    expect((await worker.fetch(sreq("/stills"), env)).status).toBe(401);
  });

  it("serves and stores once the password is right", async () => {
    const { env, store } = bucketEnv("hunter2");
    const put = await worker.fetch(
      sreq("/still/st-abc?k=hunter2", { method: "PUT", body: "bytes" }),
      env,
    );
    expect(put.status).toBe(201);
    expect(store.has("st-abc")).toBe(true);
    const got = await worker.fetch(sreq("/still/st-abc?k=hunter2"), env);
    expect(got.status).toBe(200);
    expect(got.headers.get("cache-control")).toContain("immutable");
    /* PRIVATE, because the response is behind a password -- a shared
     * cache must not hold it. */
    expect(got.headers.get("cache-control")).toContain("private");
  });

  it("does not overwrite an existing key, so an upload is idempotent", async () => {
    /* A key names one grabbed frame and is never rewritten, so a
     * re-import must not re-upload what is already there. */
    const { env, puts } = bucketEnv();
    await worker.fetch(sreq("/still/st-abc", { method: "PUT", body: "first" }), env);
    const again = await worker.fetch(sreq("/still/st-abc", { method: "PUT", body: "second" }), env);
    expect(again.status).toBe(204);
    expect(puts).toEqual(["st-abc"]); // the second never reached the bucket
  });

  it("404s a key that is not there, distinct from 501 with no bucket", async () => {
    /* The client has to tell "not configured" from "not stored": the
     * first means fall back to local storage, the second means this
     * frame genuinely is not shared. */
    const { env } = bucketEnv();
    expect((await worker.fetch(sreq("/still/st-nope"), env)).status).toBe(404);
    const { env: noBucket } = mockEnv();
    expect((await worker.fetch(sreq("/still/st-nope"), noBucket)).status).toBe(501);
    expect((await worker.fetch(sreq("/stills"), noBucket)).status).toBe(501);
  });

  it("REFUSES A KEY THAT IS NOT ONE OF OURS", async () => {
    /* The name goes straight into an object key, so the narrow rule from
     * validate.ts is repeated here rather than trusted from the client.
     * A doc and a bucket must not disagree about what a key is. */
    const { env } = bucketEnv();
    for (const bad of ["../secret", "st-../x", "nope", "st-" + "x".repeat(64), ""]) {
      const r = await worker.fetch(sreq(`/still/${encodeURIComponent(bad)}`), env);
      expect([400, 404], bad).toContain(r.status);
      expect(r.status, bad).not.toBe(200);
    }
  });

  it("deletes, which only the purge does", async () => {
    const { env, store, age } = bucketEnv();
    await worker.fetch(sreq("/still/st-abc", { method: "PUT", body: "x" }), env);
    age("st-abc");
    expect((await worker.fetch(sreq("/still/st-abc", { method: "DELETE" }), env)).status).toBe(204);
    expect(store.has("st-abc")).toBe(false);
  });

  it("WILL NOT DELETE, OR EVEN LIST, AN UPLOAD YOUNGER THAN A DAY", async () => {
    /* An import uploads before the board that references the frames has
     * reached every peer; a replica that lags sees them as orphans. The
     * grace period is what makes a purge run mid-import, or from a
     * browser that has not caught up, unable to take them (2026-09-01
     * audit). 409 rather than 204 so the client counts "did not go". */
    const { env, store, age } = bucketEnv();
    await worker.fetch(sreq("/still/st-new", { method: "PUT", body: "x" }), env);
    await worker.fetch(sreq("/still/st-old", { method: "PUT", body: "y" }), env);
    age("st-old");
    const listed = (await (await worker.fetch(sreq("/stills"), env)).json()) as { key: string }[];
    expect(listed.map((o) => o.key)).toEqual(["st-old"]);
    expect((await worker.fetch(sreq("/still/st-new", { method: "DELETE" }), env)).status).toBe(409);
    expect(store.has("st-new")).toBe(true);
    expect((await worker.fetch(sreq("/still/st-old", { method: "DELETE" }), env)).status).toBe(204);
  });

  it("DELETE of a key that is not there is 404, so the purge can count what went", async () => {
    /* R2's own delete is idempotent and cannot say whether anything was
     * removed; the route says, because "Reclaimed N frames" must be what
     * HAPPENED rather than what was attempted. */
    const { env } = bucketEnv();
    expect((await worker.fetch(sreq("/still/st-nope", { method: "DELETE" }), env)).status).toBe(404);
  });

  it("refuses an oversized PUT -- a still is a small thumbnail", async () => {
    /* The cap reads content-length, which every request in the real
     * runtime carries. Test Requests carry none unless set explicitly
     * (undici computes it at send time, and these are never sent), so it
     * is stated here rather than implied by a big body. */
    const { env, puts } = bucketEnv();
    const big = await worker.fetch(
      sreq("/still/st-big", {
        method: "PUT",
        body: "x",
        headers: { "content-length": "3000000" },
      }),
      env,
    );
    expect(big.status).toBe(413);
    expect(puts).toEqual([]); // never reached the bucket
  });

  it("the boot probe's HEAD carries the marker header -- a bare 200 proves nothing", async () => {
    /* vite's SPA fallback answers 200 text/html to ANY path, HEAD
     * included, so the client requires this header before believing a
     * bucket exists. Without it, every dev session chose the shared
     * store and cached index.html into IndexedDB as "frames". */
    const { env } = bucketEnv();
    const r = await worker.fetch(sreq("/stills", { method: "HEAD" }), env);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-corko-stills")).toBe("1");
  });

  it("lists what the bucket holds, which is the half the doc cannot know", async () => {
    const { env, age } = bucketEnv();
    await worker.fetch(sreq("/still/st-a", { method: "PUT", body: "x" }), env);
    await worker.fetch(sreq("/still/st-b", { method: "PUT", body: "y" }), env);
    age("st-a");
    age("st-b");
    const r = await worker.fetch(sreq("/stills"), env);
    expect(r.status).toBe(200);
    const listed = (await r.json()) as { key: string }[];
    expect(listed.map((o) => o.key).sort()).toEqual(["st-a", "st-b"]);
  });

  it("refuses a method it does not implement", async () => {
    const { env } = bucketEnv();
    expect((await worker.fetch(sreq("/still/st-a", { method: "POST" }), env)).status).toBe(405);
  });
});

describe("the /usage route", () => {
  it("sits behind the same gate as everything else", async () => {
    const { env } = mockEnv("hunter2");
    expect((await worker.fetch(sreq("/usage"), env)).status).toBe(401);
  });

  it("501s when the token or account is not configured -- the CORKO_STILLS pattern", async () => {
    const { env } = mockEnv();
    expect((await worker.fetch(sreq("/usage"), env)).status).toBe(501);
    const half = { ...env, CORKO_USAGE_TOKEN: "tok" } as Env;
    expect((await worker.fetch(sreq("/usage"), half)).status).toBe(501);
  });

  it("answers a digested report when configured, uncacheable to the browser", async () => {
    const { clearUsageCache } = await import("./usage");
    clearUsageCache();
    const { env } = mockEnv();
    const configured = {
      ...env,
      CORKO_USAGE_TOKEN: "tok",
      CORKO_ACCOUNT_ID: "acct",
      CORKO_PLAN: "paid",
    } as Env;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ data: { viewer: { accounts: [{}] } }, errors: null }),
        { status: 200 },
      )) as typeof fetch;
    try {
      const r = await worker.fetch(sreq("/usage"), configured);
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-store");
      const body = (await r.json()) as { plan: string; meters: { id: string }[] };
      expect(body.plan).toBe("paid");
      expect(body.meters.length).toBeGreaterThan(5);
    } finally {
      globalThis.fetch = realFetch;
      clearUsageCache();
    }
  });

  it("502s when the analytics API fails -- distinct from never-configured", async () => {
    const { clearUsageCache } = await import("./usage");
    clearUsageCache();
    const { env } = mockEnv();
    const configured = { ...env, CORKO_USAGE_TOKEN: "tok", CORKO_ACCOUNT_ID: "acct" } as Env;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    try {
      expect((await worker.fetch(sreq("/usage"), configured)).status).toBe(502);
    } finally {
      globalThis.fetch = realFetch;
      clearUsageCache();
    }
  });
});

/* ------------------------------------------------------------------ *
 *  PROJECTS AS ROOMS (worker/access.ts). A password opens a LIST of
 *  projects; a room is a project; the still routes are project-scoped;
 *  and the directory answers for what the key opens.
 * ------------------------------------------------------------------ */
describe("projects", () => {
  const access = { teamA: ["acme"], boss: "*" as const };

  it("/sync admits a room only when the key opens that project", async () => {
    const { env, log } = mockEnv(undefined, access);
    const wrong = await worker.fetch(req("/sync/corko-acme?k=nope"), env);
    expect(wrong.status).toBe(401);
    const other = await worker.fetch(req("/sync/corko-default?k=teamA"), env);
    expect(other.status).toBe(403);
    expect(log).not.toContain("room");
    expect((await worker.fetch(req("/sync/corko-acme?k=teamA"), env)).status).toBe(200);
    expect((await worker.fetch(req("/sync/corko-default?k=boss"), env)).status).toBe(200);
    expect((await worker.fetch(req("/sync/corko-acme?k=boss"), env)).status).toBe(200);
    expect(log.filter((l) => l === "room")).toHaveLength(3);
  });

  it("a room that is not a project is refused, even with the deployer's key", async () => {
    const { env } = mockEnv("boss");
    expect((await worker.fetch(req("/sync/verify-abc?k=boss"), env)).status).toBe(404);
    expect((await worker.fetch(req("/sync/corko-Bad%20Name?k=boss"), env)).status).toBe(404);
  });

  it("the legacy single password still opens the room every deployment has", async () => {
    const { env } = mockEnv("hunter2");
    expect((await worker.fetch(req("/sync/corko-default?k=hunter2"), env)).status).toBe(200);
  });

  it("stills are filed under the project, listed per project, and gated per project", async () => {
    const { env, store, age } = bucketEnv();
    (env as unknown as { CORKO_ACCESS: string }).CORKO_ACCESS = JSON.stringify(access);
    await worker.fetch(sreq("/still/st-a?k=boss", { method: "PUT", body: "x" }), env);
    await worker.fetch(sreq("/still/st-b?p=acme&k=teamA", { method: "PUT", body: "y" }), env);
    expect([...store.keys()]).toEqual(["st-a", "acme/st-b"]);
    age("st-a");
    age("acme/st-b");
    const dflt = (await (await worker.fetch(sreq("/stills?k=boss"), env)).json()) as { key: string }[];
    expect(dflt.map((o) => o.key)).toEqual(["st-a"]);
    const acme = (await (await worker.fetch(sreq("/stills?p=acme&k=teamA"), env)).json()) as { key: string }[];
    expect(acme.map((o) => o.key)).toEqual(["st-b"]);
    // teamA cannot see, fetch or delete the default project's frames
    expect((await worker.fetch(sreq("/stills?k=teamA"), env)).status).toBe(403);
    expect((await worker.fetch(sreq("/still/st-a?k=teamA"), env)).status).toBe(403);
    expect((await worker.fetch(sreq("/still/st-a?k=teamA", { method: "DELETE" }), env)).status).toBe(403);
    expect((await worker.fetch(sreq("/still/st-b?p=acme&k=teamA"), env)).status).toBe(200);
    expect((await worker.fetch(sreq("/still/st-b?p=acme&k=teamA", { method: "DELETE" }), env)).status).toBe(204);
    expect(store.has("acme/st-b")).toBe(false);
    expect((await worker.fetch(sreq("/still/st-a?p=Bad%20Name&k=boss"), env)).status).toBe(400);
  });

  it("/projects lists what the key opens, with each room's own stats", async () => {
    const { env, log } = mockEnv(undefined, access);
    expect((await worker.fetch(req("/projects?k=nope"), env)).status).toBe(401);
    const mine = (await (await worker.fetch(req("/projects?k=teamA"), env)).json()) as {
      admin: boolean;
      projects: { id: string; title: string; boards: number; touched: number | null }[];
    };
    expect(mine.admin).toBe(false);
    expect(mine.projects).toEqual([{ id: "acme", title: "T corko-acme", boards: 10, touched: 7 }]);
    const all = (await (await worker.fetch(req("/projects?k=boss"), env)).json()) as { admin: boolean; projects: { id: string }[] };
    expect(all.admin).toBe(true);
    expect(all.projects.map((p) => p.id)).toEqual(["default", "acme"]);
    expect(log.filter((l) => l.startsWith("stats:"))).toEqual(["stats:corko-acme", "stats:corko-default", "stats:corko-acme"]);
  });

  it("only the deployer can set up a project, and it then appears in their directory", async () => {
    const { env } = mockEnv(undefined, access);
    const post = (k: string, body: unknown) =>
      worker.fetch(req(`/projects?k=${k}`).url ? new Request(`https://corko.example/projects?k=${k}`, { method: "POST", body: JSON.stringify(body) }) : req("/"), env);
    expect((await post("teamA", { id: "harbor" })).status).toBe(403);
    expect((await post("boss", { id: "Bad Name" })).status).toBe(400);
    expect((await post("boss", { id: "harbor" })).status).toBe(204);
    const all = (await (await worker.fetch(req("/projects?k=boss"), env)).json()) as { projects: { id: string }[] };
    expect(all.projects.map((p) => p.id)).toEqual(["default", "acme", "harbor"]);
    // a team's list is still the map's -- the registry is the deployer's view
    const mine = (await (await worker.fetch(req("/projects?k=teamA"), env)).json()) as { projects: { id: string }[] };
    expect(mine.projects.map((p) => p.id)).toEqual(["acme"]);
    // and the deployer can open it: "*" opens any project-shaped room
    expect((await worker.fetch(req("/sync/corko-harbor?k=boss"), env)).status).toBe(200);
  });
});

/* ------------------------------------------------------------------ *
 *  TEAM PASSWORDS SET FROM THE APP (worker/access.ts): hashed in the
 *  directory, verified through the gate, deployer-only to set.
 * ------------------------------------------------------------------ */
describe("team passwords", () => {
  const access = { teamA: ["acme"], boss: "*" as const };
  const put = (env: Env, id: string, k: string, password: string) =>
    worker.fetch(
      new Request(`https://corko.example/projects/${id}/password?k=${k}`, {
        method: "PUT",
        body: JSON.stringify({ password }),
      }),
      env,
    );

  it("a password set in settings opens exactly its project, and clearing it shuts the door", async () => {
    const { env } = mockEnv(undefined, access);
    expect((await put(env, "acme", "boss", "swallows-2026")).status).toBe(204);
    const who = await (await worker.fetch(req("/auth?k=swallows-2026"), env)).json();
    expect(who).toEqual({ required: true, ok: true, projects: ["acme"], admin: false });
    expect((await worker.fetch(req("/sync/corko-acme?k=swallows-2026"), env)).status).toBe(200);
    expect((await worker.fetch(req("/sync/corko-default?k=swallows-2026"), env)).status).toBe(403);
    const has = await (await worker.fetch(req("/projects/acme/password?k=boss"), env)).json();
    expect(has).toEqual({ id: "acme", hasPassword: true, password: "swallows-2026" });

    expect((await put(env, "acme", "boss", "")).status).toBe(204);
    expect((await worker.fetch(req("/auth?k=swallows-2026"), env)).status).toBe(401);
    const gone = await (await worker.fetch(req("/projects/acme/password?k=boss"), env)).json();
    expect(gone).toEqual({ id: "acme", hasPassword: false, password: "" });
  });

  it("only the deployer may set one; a wrong password stays wrong", async () => {
    const { env } = mockEnv(undefined, access);
    expect((await put(env, "acme", "teamA", "x")).status).toBe(403);
    expect((await put(env, "acme", "nope", "x")).status).toBe(401);
    expect((await put(env, "Bad Name", "boss", "x")).status).toBe(400);
    await put(env, "acme", "boss", "right");
    expect((await worker.fetch(req("/auth?k=wrong"), env)).status).toBe(401);
    expect((await worker.fetch(req("/auth?k=right"), env)).status).toBe(200);
  });

  it("set-up can carry the team password in one step", async () => {
    const { env } = mockEnv(undefined, access);
    const r = await worker.fetch(
      new Request("https://corko.example/projects?k=boss", {
        method: "POST",
        body: JSON.stringify({ id: "harbor", password: "harbor-crew" }),
      }),
      env,
    );
    expect(r.status).toBe(204);
    const who = await (await worker.fetch(req("/auth?k=harbor-crew"), env)).json();
    expect(who).toEqual({ required: true, ok: true, projects: ["harbor"], admin: false });
  });

  it("the hash never equals the password and differs per salt", async () => {
    const a = await hashPassword("s1", "pw");
    const b = await hashPassword("s2", "pw");
    expect(a).not.toBe("pw");
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
    expect(await projectsForPassword("s1", { acme: a, other: b }, "pw")).toEqual(["acme"]);
    expect(await projectsForPassword("s1", { acme: a }, "")).toEqual([]);
  });
});

describe("the admin password set in the app", () => {
  const putAdmin = (env: Env, k: string, password: string) =>
    worker.fetch(
      new Request(`https://corko.example/admin/password?k=${encodeURIComponent(k)}`, {
        method: "PUT",
        body: JSON.stringify({ password }),
      }),
      env,
    );
  const auth = async (env: Env, k: string) => (await worker.fetch(req(`/auth?k=${encodeURIComponent(k)}`), env)).json();

  it("a fresh instance is open and says it is waiting to be set up", async () => {
    const { env } = mockEnv();
    expect(await auth(env, "")).toEqual({ required: false, ok: true, projects: ["default"], admin: true, setup: true });
  });

  it("the first visitor sets it, and from then on the gate is closed like a secret's", async () => {
    const { env } = mockEnv();
    expect((await putAdmin(env, "", "claim-pass-1")).status).toBe(204);
    expect(await auth(env, "")).toEqual({ required: true, ok: false });
    expect(await auth(env, "claim-pass-1")).toEqual({ required: true, ok: true, projects: ["default"], admin: true });
    expect((await worker.fetch(req("/sync/corko-default"), env)).status).toBe(401);
    expect((await worker.fetch(req("/sync/corko-default?k=claim-pass-1"), env)).status).toBe(200);
  });

  it("once set, nobody else can claim it again", async () => {
    const { env } = mockEnv();
    await putAdmin(env, "", "claim-pass-2");
    expect((await putAdmin(env, "", "someone-else")).status).toBe(401);
    expect((await putAdmin(env, "wrong-key", "someone-else")).status).toBe(401);
    expect(await auth(env, "someone-else")).toEqual({ required: true, ok: false });
  });

  it("refuses one shorter than six characters", async () => {
    const { env } = mockEnv();
    expect((await putAdmin(env, "", "short")).status).toBe(400);
    expect(await auth(env, "")).toMatchObject({ required: false, setup: true });
  });

  it("the admin can change it, and clearing it opens the instance again", async () => {
    const { env } = mockEnv();
    await putAdmin(env, "", "claim-pass-3");
    expect((await putAdmin(env, "claim-pass-3", "claim-pass-4")).status).toBe(204);
    expect(await auth(env, "claim-pass-3")).toEqual({ required: true, ok: false });
    expect(await auth(env, "claim-pass-4")).toMatchObject({ ok: true, admin: true });
    expect((await putAdmin(env, "claim-pass-4", "")).status).toBe(204);
    expect(await auth(env, "")).toMatchObject({ required: false, setup: true });
  });

  it("a team password only opens its project, even on an instance gated only by the app", async () => {
    const { env } = mockEnv();
    await putAdmin(env, "", "claim-pass-5");
    const r = await worker.fetch(
      new Request("https://corko.example/projects/acme/password?k=claim-pass-5", {
        method: "PUT",
        body: JSON.stringify({ password: "acme-crew-5" }),
      }),
      env,
    );
    expect(r.status).toBe(204);
    expect(await auth(env, "acme-crew-5")).toEqual({ required: true, ok: true, projects: ["acme"], admin: false });
    expect((await putAdmin(env, "acme-crew-5", "takeover")).status).toBe(403);
  });

  it("CORKO_PASSWORD still opens everything beside it -- the recovery", async () => {
    const { env } = mockEnv("recovery-secret");
    expect(await auth(env, "recovery-secret")).toMatchObject({ ok: true, admin: true });
    expect((await putAdmin(env, "recovery-secret", "claim-pass-6")).status).toBe(204);
    expect(await auth(env, "claim-pass-6")).toMatchObject({ ok: true, admin: true });
    expect(await auth(env, "recovery-secret")).toMatchObject({ ok: true, admin: true });
    expect(await auth(env, "")).toEqual({ required: true, ok: false });
  });

  it("GET says whether one is set, to the admin only, and never returns it", async () => {
    const { env } = mockEnv();
    await putAdmin(env, "", "claim-pass-7");
    expect((await worker.fetch(req("/admin/password"), env)).status).toBe(401);
    const v = await (await worker.fetch(req("/admin/password?k=claim-pass-7"), env)).json();
    expect(v).toEqual({ set: true, secret: false });
  });
});
