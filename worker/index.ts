import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { dailyTakenAt, loadDoc, saveDaily, saveDoc } from "./docStore";
import { getUsage } from "./usage";
import {
  DEFAULT_PROJECT,
  PROJECT_ID,
  allows,
  grantFor,
  hashPassword,
  parseAccess,
  projectsForPassword,
  randomSalt,
  sameSecret,
  projectOfRoom,
  projectsOf,
  roomFor,
  stillKeyOfObject,
  stillListPrefix,
  stillListedIn,
  stillObjectKey,
  type Grant,
} from "./access";

/* ------------------------------------------------------------------ *
 *  Corko sync server (spec Sec 3) -- a Cloudflare Worker plus one
 *  Durable Object per room.
 *
 *  This replaced `party/server.ts` (PartyKit) on 2026-08-01. Same job,
 *  same runtime, same Cloudflare servers -- PartyKit was only ever the
 *  middleman that packaged it, and it stopped being maintained: no
 *  release since 2025-09, its hosted platform permanently out of custom
 *  domains, and its deploy API emits a `new_classes` Durable Object
 *  migration that Cloudflare's own free plan rejects (the free plan takes
 *  SQLite-backed objects only -- see `new_sqlite_classes` in
 *  wrangler.jsonc, which is the whole reason this file exists).
 *
 *  It is deliberately thin, exactly as its predecessor was: the entire
 *  data model lives client-side in the Yjs doc and the server only relays
 *  and persists CRDT updates. Nothing here understands boards, cards or
 *  tags, and it should stay that way.
 *
 *  The protocol is plain y-websocket, spoken with `y-protocols` -- which
 *  is first-party Yjs and already a direct dependency, so this trades a
 *  dead dependency for no new one.
 * ------------------------------------------------------------------ */

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/* How long to sit on a changed doc before writing it to storage. Yjs
 * emits an update per keystroke-ish; persisting each one would be a
 * storage write per character. The doc is already safe in memory and in
 * every client's IndexedDB, so this only bounds what a hard eviction
 * could lose. */
const PERSIST_DEBOUNCE_MS = 3000;

/* How often the room takes its daily copy (docStore.ts), and how early
 * an alarm may fire and still count as "a day later" -- alarms are not
 * exact, and a copy an hour early is better than one skipped. */
const DAILY_COPY_MS = 24 * 60 * 60 * 1000;
/* When the room last persisted a change -- what the directory shows as
 * "last touched". */
const TOUCHED_KEY = "meta:touched";
/* The directory object's keys (see the /registry branch of fetch). */
const REGISTRY_KEY = "registry";
const SALT_KEY = "salt";
const PASSWORDS_KEY = "passwords"; // { [project]: pbkdf2 hex }
/* The plaintext beside the hash, READABLE BY THE DEPLOYER ONLY, so
 * Project settings can show and copy a team password after a reload
 * (owner, 2026-09-02: the Copy button). A step down from never-stored,
 * taken knowingly: it is a shared team password behind the deployer's
 * own, and the deployer could set any value anyway. The hash still does
 * the verifying. */
const PLAIN_KEY = "passwords-plain"; // { [project]: password }
/* THE ADMIN PASSWORD SET FROM INSIDE THE APP (2026-09-24): a "*" key,
 * like CORKO_PASSWORD, kept as a hash ONLY -- unlike a team password
 * there is no plaintext beside it and nothing can read it back. A fresh
 * instance has none and no secrets, so it is open and reports `setup`;
 * the first visitor sets one from the setup card, and from then on the
 * gate is closed exactly as if the secret had been set. CORKO_PASSWORD
 * still works beside it, which is the recovery: whoever owns the
 * Cloudflare account can always set that secret. */
const ADMIN_KEY = "admin"; // pbkdf2 hex, same salt as the team passwords
const DIRECTORY_NAME = "directory";
/* The shortest admin password the app or the route accepts. NOT
 * exported: the Worker's entry module may export only handlers, and a
 * plain value here stops the runtime from starting. */
const ADMIN_MIN_LENGTH = 6;

/* WHAT A PASSWORD OPENS, remembered for a minute in this isolate: the
 * gate runs on every still fetch, and a PBKDF2 derivation plus a
 * Durable Object round trip per image is not a price to pay per image.
 * A miss is remembered briefly too, so a guess costs a derivation only
 * every few seconds. Cleared whenever a password changes. */
const VERIFY_HIT_MS = 60_000;
const VERIFY_MISS_MS = 5_000;
const verified = new Map<string, { grant: Grant | null; at: number }>();
/* WHETHER AN ADMIN PASSWORD HAS BEEN SET IN THE APP, remembered briefly
 * per isolate: only asked when no secret configures the gate, and then on
 * every request. A "set" answer is kept longer than an "unset" one, so
 * a password set in another isolate closes this one's door within
 * seconds. Keyed on the namespace binding, so a test's fresh env is a
 * fresh answer. On an unreachable directory the gate fails CLOSED here:
 * nothing else works without Durable Objects anyway, and failing open
 * would expose an instance that has a password. */
const ADMIN_SET_MS = 60_000;
const ADMIN_UNSET_MS = 5_000;
const adminSeen = new WeakMap<object, { set: boolean; at: number }>();
async function adminIsSet(env: Env): Promise<boolean> {
  const slot = env.CORKO_ROOM as unknown as object;
  const now = Date.now();
  const hit = adminSeen.get(slot);
  if (hit && now - hit.at < (hit.set ? ADMIN_SET_MS : ADMIN_UNSET_MS)) return hit.set;
  let set = true;
  try {
    const r = await directoryOf(env).fetch(new Request("https://room/admin"));
    if (r.ok) set = ((await r.json()) as { set?: unknown }).set === true;
  } catch {
    /* unreachable: closed, per the header */
  }
  adminSeen.set(slot, { set, at: now });
  return set;
}
const DAILY_SLACK_MS = 60 * 60 * 1000;

export interface Env {
  CORKO_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  /* The shared access password, set as a Cloudflare SECRET:
   *     npx wrangler secret put CORKO_PASSWORD
   * Deliberately not in wrangler.jsonc (committed) and never a VITE_ var
   * (those bake into the public bundle). Undefined = no gate; see
   * `authState`. */
  CORKO_PASSWORD?: string;
  /* WHO MAY OPEN WHICH PROJECT (worker/access.ts): a secret holding
   *     { "<password>": ["acme", "birds"], "<another>": "*" }
   * Optional. Without it CORKO_PASSWORD alone opens every project, which
   * is exactly what a single-project deployment has always had. */
  CORKO_ACCESS?: string;
  /* WHERE SHARED STILLS LIVE (Phase C). Optional on purpose: with no
   * bucket bound, the still routes answer 501 and the client falls back
   * to its own IndexedDB -- which is Phase B's behavior exactly, so a
   * deployment that has not provisioned R2 keeps working and simply does
   * not share pictures.
   *
   *     npx wrangler r2 bucket create corko-stills
   *
   * ...plus the `r2_buckets` entry in wrangler.jsonc. R2 has a permanent
   * 10 GB free tier and no egress charge -- about 700,000 stills at the
   * 480px thumbnails the grabber writes. */
  CORKO_STILLS?: R2Bucket;
  /* USAGE METERS (worker/usage.ts). The token is a READ-ONLY Account
   * Analytics token, set as a secret exactly like the password:
   *     npx wrangler secret put CORKO_USAGE_TOKEN
   * Never the deploy token -- that one can edit Workers, and least
   * privilege says a meter reads and nothing else. Unset = /usage
   * answers 501 and the app says "not configured", the CORKO_STILLS
   * pattern. The account id is a plain var in wrangler.jsonc (it is
   * not a secret -- it is in every dashboard URL and grants nothing
   * without a token); the plan var picks which limits table the
   * meters are read against. */
  CORKO_USAGE_TOKEN?: string;
  CORKO_ACCOUNT_ID?: string;
  CORKO_PLAN?: string;
}

/* A blob key, and NARROW on purpose: it is concatenated into an R2
 * object name, so anything that is not one of our own minted keys has no
 * business reaching the bucket. Mirrors validate.ts's rule for the same
 * string, which is what stops a doc and a bucket disagreeing about what
 * a key is. */
const STILL_KEY = /^st-[A-Za-z0-9_-]{1,40}$/;

/* A still is a ~15-40 KB thumbnail (board/stills.ts caps the long edge at
 * 480px), so anything approaching this is not a still -- it is someone
 * pushing arbitrary bytes at the bucket through a gated but unmetered
 * route. Generous on purpose: the cap exists to bound abuse, not to
 * second-guess a big JPEG. */
const STILL_MAX_BYTES = 2_000_000;

/* HOW LONG A FRESH UPLOAD IS OFF-LIMITS TO THE PURGE. A still reaches the
 * bucket before the doc that references it reaches every peer -- the
 * import uploads first and the board syncs after, and a colleague's
 * replica can lag by however long their tab was closed. Inside this
 * window an object is neither listed to the purge nor deletable by it,
 * so a sweep run mid-import, or from a browser that has not caught up,
 * cannot take frames that a board is about to point at. A day, because
 * the purge is tidiness and a day's delay costs nothing; a genuinely
 * orphaned frame is simply swept tomorrow. */
const STILL_GRACE_MS = 24 * 60 * 60 * 1000;
const inGrace = (o: { uploaded?: Date } | null, now: number): boolean =>
  !!o && now - (o.uploaded?.getTime() ?? 0) < STILL_GRACE_MS;

/* Compare without leaking the answer through timing. Overkill for one
 * shared password over TLS, but it costs three lines. */

/* The one place the gate is decided, used by BOTH the /auth probe and the
 * websocket route -- so the thing the UI asks about and the thing actually
 * enforced can never drift apart.
 *
 * No password configured => open, exactly as the deployment was before the
 * gate existed. That is a deliberate fail-OPEN: the alternative locks the
 * owner out of his own instance the moment this ships and before he has
 * set a secret, with no way in. The app surfaces it (`required: false`
 * drives an "unprotected" marker) so it can't quietly stay that way. */
export interface AuthState {
  required: boolean;
  ok: boolean;
  /* What the key opens, spelled out -- `projects` is the concrete list
   * (for "*" that is every project the map names) and `admin` says the
   * grant was "*". Present only when `ok`. */
  projects?: string[];
  admin?: boolean;
  /* No password of any kind yet: the app offers the admin setup card. */
  setup?: boolean;
}
const directoryOf = (env: Env): DurableObjectStub =>
  env.CORKO_ROOM.get(env.CORKO_ROOM.idFromName(DIRECTORY_NAME));

/* What a key opens by the DIRECTORY's hashes -- the admin password set
 * in the app ("*") or a team password (its projects) -- asked only when
 * the access map did not answer. */
async function directoryGrant(env: Env, key: string): Promise<Grant | null> {
  const now = Date.now();
  const hit = verified.get(key);
  if (hit && now - hit.at < (hit.grant ? VERIFY_HIT_MS : VERIFY_MISS_MS)) return hit.grant;
  let grant: Grant | null = null;
  try {
    const r = await directoryOf(env).fetch(
      new Request("https://room/verify", { method: "POST", body: JSON.stringify({ password: key }) }),
    );
    if (r.ok) {
      const v = (await r.json()) as { admin?: unknown; ids?: unknown };
      const ids = Array.isArray(v.ids) ? v.ids.filter((x): x is string => typeof x === "string" && PROJECT_ID.test(x)) : [];
      grant = v.admin === true ? "*" : ids.length ? ids : null;
    }
  } catch {
    /* the directory is unreachable: the map alone decides */
  }
  verified.set(key, { grant, at: now });
  return grant;
}

/* Is there a gate at all? A secret configures one; so does an admin
 * password set in the app. Neither = open, and the instance is waiting
 * to be set up. */
async function gated(env: Env): Promise<boolean> {
  return !!parseAccess(env.CORKO_ACCESS, env.CORKO_PASSWORD) || (await adminIsSet(env));
}

/* The grant behind a key, or null: the map first (sync, the deployer's
 * tool), then the directory (the admin or a team password typed into
 * the app). */
async function grantOf(env: Env, key: string | null): Promise<Grant | null> {
  if (!(await gated(env))) return "*";
  const map = parseAccess(env.CORKO_ACCESS, env.CORKO_PASSWORD);
  const fromMap = map ? grantFor(map, key) : null;
  if (fromMap) return fromMap;
  if (!key) return null;
  return directoryGrant(env, key);
}
export async function authState(env: Env, key: string | null): Promise<AuthState> {
  if (!(await gated(env))) return { required: false, ok: true, projects: [DEFAULT_PROJECT], admin: true, setup: true };
  const map = parseAccess(env.CORKO_ACCESS, env.CORKO_PASSWORD);
  const grant = await grantOf(env, key);
  if (!grant) return { required: true, ok: false };
  return { required: true, ok: true, projects: projectsOf(map, grant), admin: grant === "*" };
}
/* The project a still/list request is about: `?p=`, else the default. */
function projectParam(url: URL): string | null {
  const p = url.searchParams.get("p") ?? DEFAULT_PROJECT;
  return PROJECT_ID.test(p) ? p : null;
}

export class CorkoRoom implements DurableObject {
  private doc = new Y.Doc();
  private awareness = this.makeAwareness();

  /* An Awareness, minus the two things a RELAY must not have.
   *
   * The class starts a 3s expiry interval in its constructor, and a
   * pending setInterval blocks hibernation outright (the runtime cannot
   * recreate the callback after eviction -- see the DO lifecycle docs). So
   * with it running, a room with one idle tab open NEVER hibernates and
   * bills duration the entire time; the hibernation API this file is built
   * on was being defeated by its own awareness object. The server doesn't
   * need the timer: every y-websocket CLIENT runs the same 30s expiry over
   * its own copy, so a stale state a crashed peer leaves behind is dropped
   * client-side regardless (worst case, a new joiner shows it for ~30s).
   * Clearing a private field of a pinned first-party dependency is ugly;
   * if the field ever moves, this degrades to exactly the always-resident
   * status quo it fixes, not to breakage.
   *
   * It also drops the server's own local state: the constructor sets `{}`,
   * which made a fresh room answer probes with an awareness frame nobody
   * asked for, kept a phantom entry in every handshake, and -- renewed by
   * that same interval -- re-broadcast a heartbeat to every client every
   * 15s. A relay is not a peer. */
  private makeAwareness(): awarenessProtocol.Awareness {
    const aw = new awarenessProtocol.Awareness(this.doc);
    const withTimer = aw as unknown as { _checkInterval?: number };
    if (withTimer._checkInterval !== undefined) clearInterval(withTimer._checkInterval);
    aw.setLocalState(null);
    return aw;
  }
  private loaded: Promise<void>;
  private persistTimer: number | null = null;

  /* The live sockets, asked for fresh every time rather than kept in a Set.
   * With the hibernation API the object can be evicted and rebuilt between
   * messages, which would empty any in-memory collection while the sockets
   * themselves stay open -- so the runtime's list is the only one that can
   * be trusted. */
  private get sockets(): WebSocket[] {
    return this.state.getWebSockets();
  }

  /* Which awareness client ids arrived over which socket, so a disconnect
   * retracts exactly that peer's presence and nobody else's (otherwise a
   * closed tab leaves a ghost cursor). Stored ON the socket, for the same
   * reason: a Map here would not survive hibernation. */
  private ownedIds(ws: WebSocket): Set<number> {
    const att = ws.deserializeAttachment() as { ids?: number[] } | null;
    return new Set(att?.ids ?? []);
  }
  private setOwnedIds(ws: WebSocket, ids: Set<number>) {
    ws.serializeAttachment({ ids: [...ids] });
  }

  constructor(
    private state: DurableObjectState,
    _env: Env,
  ) {
    // The doc is garbage-collected only when we're NOT persisting history;
    // we store a flat snapshot, so gc is safe and keeps the doc small.
    this.loaded = this.state.blockConcurrencyWhile(async () => {
      const stored = await loadDoc(this.state.storage);
      if (stored) Y.applyUpdate(this.doc, stored, "storage");
      await this.armDailyCopy();
    });

    // Broadcast every doc change to everyone except whoever caused it, and
    // schedule a save. `origin` is the socket for a remote update, so the
    // sender isn't echoed its own bytes back.
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      /* The storage load is not a change. On a post-hibernation rebuild the
       * constructor applies the stored doc while sockets are still attached;
       * without this guard that load re-broadcast the ENTIRE doc to every
       * connected client on every wake (they already have it -- hibernation
       * only happens after the debounce has flushed) and re-persisted the
       * bytes it had just read. Clients that ARE missing state get it the
       * right way, through the sync handshake on connect. */
      if (origin === "storage") return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      const msg = encoding.toUint8Array(enc);
      for (const ws of this.sockets) if (ws !== origin) this.send(ws, msg);
      this.schedulePersist();
    });

    this.awareness.on(
      "update",
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const changed = added.concat(updated, removed);
        if (!changed.length) return;
        // remember which socket owns which presence, for cleanup on close
        if (origin && typeof (origin as WebSocket).serializeAttachment === "function") {
          const ws = origin as WebSocket;
          const owned = this.ownedIds(ws);
          for (const id of added) owned.add(id);
          for (const id of removed) owned.delete(id);
          this.setOwnedIds(ws, owned);
        }
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
        const msg = encoding.toUint8Array(enc);
        for (const ws of this.sockets) this.send(ws, msg);
      },
    );
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      /* The deployer's directory asks each room what it holds. The one
       * place the server reads INTO the doc, and it reads two things:
       * the project's title and how many boards it has. Kept this thin
       * on purpose -- the server is a relay, not a second model. */
      /* THE REGISTRY: projects the deployer set up from inside the app,
       * kept by ONE object named "directory" -- a name no /sync path can
       * reach (it is not corko-<project>), so it is only ever spoken to
       * by the Worker's /projects handlers. Plain storage, no doc. A
       * project also exists by being named in CORKO_ACCESS; the
       * directory is the union of the two. */
      const path = new URL(req.url).pathname;
      /* Team passwords (worker/access.ts): set, cleared, listed by id,
       * and verified -- all inside this object, so the salt and the
       * hashes never leave it. */
      if (path === "/password" && req.method === "PUT") {
        const body = (await req.json().catch(() => null)) as { id?: unknown; password?: unknown } | null;
        const id = typeof body?.id === "string" ? body.id : "";
        const password = typeof body?.password === "string" ? body.password : "";
        if (!PROJECT_ID.test(id)) return new Response("bad project", { status: 400 });
        const entries = (await this.state.storage.get<Record<string, string>>(PASSWORDS_KEY)) ?? {};
        const plain = (await this.state.storage.get<Record<string, string>>(PLAIN_KEY)) ?? {};
        if (password) {
          let salt = await this.state.storage.get<string>(SALT_KEY);
          if (!salt) {
            salt = randomSalt();
            await this.state.storage.put(SALT_KEY, salt);
          }
          entries[id] = await hashPassword(salt, password);
          plain[id] = password;
        } else {
          delete entries[id];
          delete plain[id];
        }
        await this.state.storage.put(PASSWORDS_KEY, entries);
        await this.state.storage.put(PLAIN_KEY, plain);
        return new Response(null, { status: 204 });
      }
      if (path === "/passwords") {
        /* Which projects HAVE one comes from the hashes (the truth); the
         * plaintext rides beside it where it exists -- an entry set
         * before the plaintext was kept has a hash and no text. */
        const entries = (await this.state.storage.get<Record<string, string>>(PASSWORDS_KEY)) ?? {};
        const plain = (await this.state.storage.get<Record<string, string>>(PLAIN_KEY)) ?? {};
        return Response.json({ ids: Object.keys(entries).sort(), plain });
      }
      if (path === "/admin") {
        if (req.method === "PUT") {
          const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
          const password = typeof body?.password === "string" ? body.password : "";
          if (password) {
            let salt = await this.state.storage.get<string>(SALT_KEY);
            if (!salt) {
              salt = randomSalt();
              await this.state.storage.put(SALT_KEY, salt);
            }
            await this.state.storage.put(ADMIN_KEY, await hashPassword(salt, password));
          } else {
            await this.state.storage.delete(ADMIN_KEY);
          }
          return new Response(null, { status: 204 });
        }
        return Response.json({ set: !!(await this.state.storage.get<string>(ADMIN_KEY)) });
      }
      if (path === "/verify" && req.method === "POST") {
        /* One derivation, then the admin hash and every team hash
         * compared against it. */
        const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
        const password = typeof body?.password === "string" ? body.password : "";
        const salt = await this.state.storage.get<string>(SALT_KEY);
        const entries = (await this.state.storage.get<Record<string, string>>(PASSWORDS_KEY)) ?? {};
        const adminHash = await this.state.storage.get<string>(ADMIN_KEY);
        const h = salt && password ? await hashPassword(salt, password) : "";
        const admin = !!h && !!adminHash && sameSecret(h, adminHash);
        const ids = h ? await projectsForPassword(salt!, entries, password) : [];
        return Response.json({ admin, ids });
      }
      if (path === "/registry") {
        const have = (await this.state.storage.get<string[]>(REGISTRY_KEY)) ?? [];
        if (req.method === "POST") {
          const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
          const id = typeof body?.id === "string" ? body.id : "";
          if (!PROJECT_ID.test(id)) return new Response("bad project", { status: 400 });
          if (!have.includes(id)) await this.state.storage.put(REGISTRY_KEY, [...have, id]);
          return Response.json({ ok: true, id });
        }
        return Response.json(have);
      }
      if (path === "/stats") {
        await this.loaded;
        const project = this.doc.getMap("project");
        const boards = project.get("boards");
        const touched = await this.state.storage.get<number>(TOUCHED_KEY);
        return Response.json({
          title: typeof project.get("title") === "string" ? project.get("title") : "",
          boards: boards instanceof Y.Array ? boards.length : 0,
          touched: typeof touched === "number" ? touched : null,
          empty: this.doc.store.clients.size === 0,
        });
      }
      return new Response("expected websocket", { status: 426 });
    }
    await this.loaded;

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    /* The HIBERNATION api (`acceptWebSocket` + the webSocket* methods), not
     * `accept()` + addEventListener. The latter is the older pattern and its
     * message events never fired here at all -- the object would send its
     * opening handshake happily and then never hear a word back, so every
     * client hung forever waiting for sync step 2. This is also the cheaper
     * of the two: an idle room stops billing duration instead of sitting
     * resident. The cost is that the object can be rebuilt between messages,
     * which is why nothing that matters is kept in a plain field (see
     * `sockets` and `ownedIds` above, and the `loaded` await below). */
    this.state.acceptWebSocket(server);
    this.setOwnedIds(server, new Set());

    // Step 1 of the sync handshake: tell the newcomer what we have, so it
    // can send back whatever we're missing.
    const sync = encoding.createEncoder();
    encoding.writeVarUint(sync, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(sync, this.doc);
    this.send(server, encoding.toUint8Array(sync));

    // ...and hand over everyone's presence, so cursors appear immediately
    // rather than on the next heartbeat.
    const states = this.awareness.getStates();
    if (states.size > 0) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        aw,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]),
      );
      this.send(server, encoding.toUint8Array(aw));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /* Hibernation entry points. The object may have been rebuilt since the
   * socket was accepted, so every one of these waits for the doc to be
   * reloaded from storage before touching it. */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    await this.loaded;
    this.onMessage(ws, message);
  }

  async webSocketClose(ws: WebSocket) {
    await this.loaded;
    await this.onClose(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.loaded;
    await this.onClose(ws);
  }

  /* The daily copy (docStore.ts). Alarms are the one timer a hibernated
   * object honors, so this fires whether or not anyone is connected; a
   * room nobody has opened since yesterday simply re-copies the same
   * bytes. */
  async alarm() {
    await this.loaded;
    try {
      const now = Date.now();
      const at = await dailyTakenAt(this.state.storage);
      if (at === null || now - at >= DAILY_COPY_MS - DAILY_SLACK_MS) {
        await saveDaily(this.state.storage, Y.encodeStateAsUpdate(this.doc), now);
      }
    } catch (err) {
      console.error("corko: daily copy failed", err);
    }
    await this.armDailyCopy();
  }

  private async armDailyCopy() {
    try {
      const storage = this.state.storage;
      if (typeof storage.getAlarm !== "function") return;
      if ((await storage.getAlarm()) === null) await storage.setAlarm(Date.now() + DAILY_COPY_MS);
    } catch (err) {
      console.error("corko: could not arm the daily copy", err);
    }
  }

  private onMessage(ws: WebSocket, message: ArrayBuffer | string) {
    // binary only -- a string frame is not this protocol
    if (typeof message === "string") return;
    const bytes = new Uint8Array(message);
    try {
      const dec = decoding.createDecoder(bytes);
      const enc = encoding.createEncoder();
      const type = decoding.readVarUint(dec);
      if (type === MESSAGE_SYNC) {
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        // `ws` as the origin keeps the doc's update handler from echoing
        // this back to the sender
        syncProtocol.readSyncMessage(dec, enc, this.doc, ws);
        // length 1 means the reply is just the message type -- nothing to say
        if (encoding.length(enc) > 1) this.send(ws, encoding.toUint8Array(enc));
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), ws);
      }
    } catch (err) {
      // One bad frame must not take the room down for everyone else.
      console.error("corko: bad message", err);
    }
  }

  private async onClose(ws: WebSocket) {
    const owned = this.ownedIds(ws);
    if (owned.size) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [...owned], null);
    }
    try {
      ws.close();
    } catch {
      /* already gone */
    }
    /* Last one out saves the doc: the object can be evicted the moment
     * nobody is connected, and a pending debounce would never fire. The
     * closing socket may still be listed, so it doesn't count itself.
     * AWAITED, so the handler's promise -- the one thing the runtime is
     * known to wait for -- does not settle until the bytes are down. It
     * was fire-and-forget until 2026-09-01, which left the save two awaits
     * short of the write when the handler returned. */
    if (this.sockets.filter((s) => s !== ws).length === 0) await this.persist();
  }

  private send(ws: WebSocket, msg: Uint8Array) {
    try {
      ws.send(msg);
    } catch {
      /* a dead socket is the runtime's to reap; webSocketClose will fire */
    }
  }

  private schedulePersist() {
    if (this.persistTimer !== null) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, PERSIST_DEBOUNCE_MS) as unknown as number;
  }

  private async persist() {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    try {
      /* A flat snapshot, not an update log: the log grows without bound and
       * this doc is rewritten wholesale often enough that compaction would
       * dominate. Always the current state -- across as many keys as it
       * takes, because a single storage value caps out at 2 MB on every
       * plan (worker/docStore.ts explains what that ceiling costs). */
      const result = await saveDoc(this.state.storage, Y.encodeStateAsUpdate(this.doc));
      if (result === "written") await this.state.storage.put(TOUCHED_KEY, Date.now());
      /* An empty doc over a stored snapshot is the one write the store
       * turns down: it means this object came up without its snapshot
       * (a refused read) and has nothing to say yet. The copy on disk is
       * the better one; leave it. */
      if (result === "refused-empty") console.error("corko: not persisting an empty doc over a stored snapshot");
    } catch (err) {
      console.error("corko: persist failed", err);
    }
  }
}

/* The Worker in front: websocket upgrades go to the room's Durable Object,
 * everything else is the built app (Workers Assets -- no R2 bucket, which
 * is what let this stay on the free plan and off a credit card). */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const key = url.searchParams.get("k");

    /* What the UI asks before it tries to connect, so it can show a
     * password screen (or an "unprotected" marker) instead of a silently
     * failing socket. It is NOT the gate -- the gate is on /sync below.
     * This endpoint only exists so the app can tell "wrong password" from
     * "network down", which a refused websocket cannot express. */
    if (url.pathname === "/auth") {
      const state = await authState(env, key);
      return Response.json(state, {
        status: state.ok ? 200 : 401,
        headers: { "cache-control": "no-store" },
      });
    }

    // `/sync/<room>` -- the shape y-websocket builds (serverUrl + "/" + room),
    // so the client needs no custom URL handling.
    /* ---- SHARED STILLS (Phase C) ----
     *
     * SERVED THROUGH THE WORKER, NOT FROM A PUBLIC BUCKET, and that is
     * the whole reason this route exists rather than a bucket URL: the
     * boards sit behind CORKO_PASSWORD, and a public R2 URL would leave
     * the cut gated and the pictures wide open to anyone with a link.
     * Running the same `authState` both /auth and /sync drive means the
     * gate cannot drift between them.
     *
     * GET is cacheable for a year because a key is immutable -- it names
     * one grabbed frame and is never rewritten. THE BROWSER'S cache is
     * the one doing that work, and it is the only one: `private` forbids
     * shared caches (deliberately -- the response is behind a password),
     * and Worker-generated responses are not edge-cached by default
     * anyway. Each viewer fetches each still once, which at team scale
     * is fine; if it ever is not, the known move is the Cache API keyed
     * WITHOUT the password param, weighed against what caching a gated
     * response at the edge gives up. */
    if (url.pathname.startsWith("/still/")) {
      const grant = await grantOf(env, key);
      if (!grant) return new Response("unauthorized", { status: 401 });
      const project = projectParam(url);
      if (!project) return new Response("bad project", { status: 400 });
      if (!allows(grant, project)) return new Response("forbidden", { status: 403 });
      const still = decodeURIComponent(url.pathname.slice("/still/".length));
      if (!STILL_KEY.test(still)) return new Response("bad key", { status: 400 });
      /* The object lives under the project's prefix (worker/access.ts):
       * a project's frames are its own, and its purge lists only them. */
      const name = stillObjectKey(project, still);
      /* No bucket bound: say so plainly rather than 404ing, so the client
       * can tell "not configured" from "not there" and fall back to
       * local storage instead of showing empty cards forever. */
      if (!env.CORKO_STILLS) return new Response("no still store", { status: 501 });

      if (req.method === "GET" || req.method === "HEAD") {
        const obj = await env.CORKO_STILLS.get(name);
        if (!obj) return new Response("not found", { status: 404 });
        return new Response(req.method === "HEAD" ? null : obj.body, {
          headers: {
            "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
            "cache-control": "private, max-age=31536000, immutable",
            etag: obj.httpEtag,
          },
        });
      }
      if (req.method === "PUT") {
        /* Bounded, because this is a gated but unmetered write route: a
         * still is a small thumbnail, and anything bigger is not one.
         * Enforced off content-length, which every real request carries
         * (the runtime sets it for a Blob body); a lengthless stream is
         * left to R2, which refuses unknown-length uploads itself. */
        const len = Number(req.headers.get("content-length") ?? NaN);
        if (len > STILL_MAX_BYTES) return new Response("too large", { status: 413 });
        /* A key is immutable, so an existing one is not overwritten --
         * that makes an upload idempotent and means a re-import cannot
         * cost bandwidth for frames already there. */
        if (await env.CORKO_STILLS.head(name)) {
          return new Response(null, { status: 204 });
        }
        await env.CORKO_STILLS.put(name, req.body, {
          httpMetadata: { contentType: req.headers.get("content-type") ?? "image/jpeg" },
        });
        return new Response(null, { status: 201 });
      }
      if (req.method === "DELETE") {
        /* Used ONLY by the purge, which is a deliberate button with a
         * preview -- never a background sweep. A peer whose project has
         * not finished syncing is indistinguishable from a board that
         * does not exist, so an automatic cleaner would eventually delete
         * live stills and be locally correct to do it.
         *
         * 404 for a key that was not there, so the client can COUNT what
         * actually went -- R2's own delete is idempotent and cannot say,
         * and "Reclaimed N frames" must be what happened rather than what
         * was attempted. The extra head() is one class-B op on a route
         * only the purge button ever drives. */
        const obj = await env.CORKO_STILLS.head(name);
        if (!obj) return new Response("not found", { status: 404 });
        /* Too new to be known unreferenced -- see STILL_GRACE_MS. 409 so
         * the client counts it as "did not go" rather than as an error. */
        if (inGrace(obj, Date.now())) return new Response("too new to purge", { status: 409 });
        await env.CORKO_STILLS.delete(name);
        return new Response(null, { status: 204 });
      }
      return new Response("method not allowed", { status: 405 });
    }

    /* Every key the bucket holds, for the purge's mark-and-sweep. The
     * doc side supplies what is REFERENCED; only the bucket can say what
     * EXISTS, and the difference is what can be reclaimed. */
    if (url.pathname === "/stills") {
      const grant = await grantOf(env, key);
      if (!grant) return new Response("unauthorized", { status: 401 });
      const project = projectParam(url);
      if (!project) return new Response("bad project", { status: 400 });
      if (!allows(grant, project)) return new Response("forbidden", { status: 403 });
      if (!env.CORKO_STILLS) return new Response("no still store", { status: 501 });
      /* HEAD is the boot probe: the client only needs to know whether a
       * bucket is bound, and listing a large bucket to answer that would
       * be a real cost on every page load.
       *
       * THE MARKER HEADER IS THE PROOF THIS IS THE WORKER. A dev server
       * with SPA fallback (vite) answers 200 text/html to ANY path, HEAD
       * included -- so a bare 200 made every dev session choose the
       * shared store and cache index.html into IndexedDB as "frames"
       * whenever a still's blob was missing locally. The client requires
       * this header before believing a bucket exists; nothing that is
       * not this route will ever send it. */
      if (req.method === "HEAD") {
        return new Response(null, { status: 200, headers: { "x-corko-stills": "1" } });
      }
      const out: { key: string; size: number }[] = [];
      let cursor: string | undefined;
      const now = Date.now();
      /* Paged, because a bucket can outgrow one listing and a purge that
       * silently saw only the first page would report the rest as
       * unreferenced. Objects inside STILL_GRACE_MS are left OUT, so the
       * purge never even offers them -- the count it shows is the count
       * it can act on. */
      do {
        const page = await env.CORKO_STILLS.list({ cursor, limit: 1000, prefix: stillListPrefix(project) });
        for (const o of page.objects) {
          if (inGrace(o, now) || !stillListedIn(project, o.key)) continue;
          out.push({ key: stillKeyOfObject(project, o.key), size: o.size });
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return Response.json(out, { headers: { "cache-control": "no-store" } });
    }

    /* THE DIRECTORY: every project this key opens, with what each room
     * holds. The deployer's bird's-eye view (a "*" grant sees them all);
     * anyone else sees their own list, which is what the project switcher
     * draws. Rooms are asked one by one -- a Durable Object namespace
     * cannot enumerate itself, so the set of projects IS the access map,
     * and each room answers for its own contents. */
    /* THE ADMIN PASSWORD, set from the app: claimed from the setup card
     * while the instance is open (anyone there is admin, which is what
     * open means), then changed or cleared from Project settings by a
     * "*" key. GET says whether one is set; nothing reads it back. */
    if (url.pathname === "/admin/password") {
      const state = await authState(env, key);
      if (!state.ok) return new Response("unauthorized", { status: 401 });
      if (!state.admin) return new Response("forbidden", { status: 403 });
      if (req.method === "GET") {
        return Response.json(
          { set: await adminIsSet(env), secret: !!parseAccess(env.CORKO_ACCESS, env.CORKO_PASSWORD) },
          { headers: { "cache-control": "no-store" } },
        );
      }
      if (req.method === "PUT") {
        const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
        const password = typeof body?.password === "string" ? body.password : "";
        if (password && password.length < ADMIN_MIN_LENGTH) return new Response("too short", { status: 400 });
        const r = await directoryOf(env).fetch(
          new Request("https://room/admin", { method: "PUT", body: JSON.stringify({ password }) }),
        );
        verified.clear();
        adminSeen.delete(env.CORKO_ROOM as unknown as object);
        return new Response(null, { status: r.ok ? 204 : 500 });
      }
      return new Response("method not allowed", { status: 405 });
    }

    /* A PROJECT'S TEAM PASSWORD, set or cleared from Project settings
     * (deployer only), and whether one is set. The password goes to the
     * directory, which hashes it; nothing here keeps it. */
    const pw = url.pathname.match(/^\/projects\/([^/]+)\/password$/);
    if (pw) {
      const state = await authState(env, key);
      if (!state.ok) return new Response("unauthorized", { status: 401 });
      if (!state.admin) return new Response("forbidden", { status: 403 });
      const id = decodeURIComponent(pw[1]);
      if (!PROJECT_ID.test(id)) return new Response("bad project", { status: 400 });
      if (req.method === "PUT") {
        const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
        const password = typeof body?.password === "string" ? body.password : "";
        const r = await directoryOf(env).fetch(
          new Request("https://room/password", { method: "PUT", body: JSON.stringify({ id, password }) }),
        );
        verified.clear();
        return new Response(null, { status: r.ok ? 204 : 500 });
      }
      if (req.method === "GET") {
        const r = await directoryOf(env).fetch(new Request("https://room/passwords"));
        const v = r.ok ? ((await r.json()) as { ids: string[]; plain: Record<string, string> }) : { ids: [], plain: {} };
        const password = typeof v.plain[id] === "string" ? v.plain[id] : "";
        return Response.json(
          { id, hasPassword: v.ids.includes(id), password },
          { headers: { "cache-control": "no-store" } },
        );
      }
      return new Response("method not allowed", { status: 405 });
    }

    if (url.pathname === "/projects") {
      const state = await authState(env, key);
      if (!state.ok) return new Response("unauthorized", { status: 401 });
      const directory = directoryOf(env);
      /* SETTING UP A NEW PROJECT is the deployer's alone (owner,
       * 2026-09-02): a "*" key registers the id; the room itself comes
       * into being the first time someone opens it. Giving a TEAM a way
       * in is still the access map, which only the deployer can edit --
       * the app says so when it creates one. */
      if (req.method === "POST") {
        if (!state.admin) return new Response("forbidden", { status: 403 });
        const body = (await req.json().catch(() => null)) as { id?: unknown; password?: unknown } | null;
        const id = typeof body?.id === "string" ? body.id : "";
        if (!PROJECT_ID.test(id)) return new Response("bad project", { status: 400 });
        const r = await directory.fetch(new Request("https://room/registry", { method: "POST", body: JSON.stringify({ id }) }));
        if (!r.ok) return new Response(null, { status: 500 });
        /* A team password typed into the set-up dialog rides along, so
         * setting up a project and handing a team its way in is one
         * step (owner, 2026-09-02: the CLI note was "pretty baroque"). */
        const password = typeof body?.password === "string" ? body.password : "";
        if (password) {
          await directory.fetch(
            new Request("https://room/password", { method: "PUT", body: JSON.stringify({ id, password }) }),
          );
          verified.clear();
        }
        return new Response(null, { status: 204 });
      }
      let ids = state.projects ?? [];
      if (state.admin) {
        try {
          const extra = (await (await directory.fetch(new Request("https://room/registry"))).json()) as string[];
          ids = [...new Set([...ids, ...extra.filter((x) => PROJECT_ID.test(x))])];
        } catch {
          /* the registry is additive; without it the map's list stands */
        }
      }
      const rows = await Promise.all(
        ids.map(async (id) => {
          try {
            const room = env.CORKO_ROOM.get(env.CORKO_ROOM.idFromName(roomFor(id)));
            const r = await room.fetch(new Request("https://room/stats"));
            const stats = (await r.json()) as { title: string; boards: number; touched: number | null };
            return { id, ...stats };
          } catch {
            return { id, title: "", boards: 0, touched: null };
          }
        }),
      );
      return Response.json({ admin: !!state.admin, projects: rows }, { headers: { "cache-control": "no-store" } });
    }

    /* USAGE METERS -- how close this deployment is to its Cloudflare
     * limits, digested for the app's usage panel. Same gate as
     * everything else; 501 with no token, the CORKO_STILLS pattern, so
     * an unconfigured deployment says "not wired up" rather than
     * erroring. The analytics call is cached five minutes inside
     * getUsage, so an open panel cannot spend API quota. */
    if (url.pathname === "/usage") {
      if (!(await authState(env, key)).ok) return new Response("unauthorized", { status: 401 });
      if (!env.CORKO_USAGE_TOKEN || !env.CORKO_ACCOUNT_ID) {
        return new Response("no usage token", { status: 501 });
      }
      try {
        return Response.json(await getUsage(env), {
          headers: { "cache-control": "no-store" },
        });
      } catch (err) {
        /* The analytics API being down or the token being wrong are the
         * app's "couldn't read usage" -- distinct from 501's "was never
         * set up". Logged for wrangler tail; the message itself may name
         * the account, so it stays server-side. */
        console.error("corko: usage fetch failed", err);
        return new Response("usage unavailable", { status: 502 });
      }
    }

    if (url.pathname.startsWith("/sync/")) {
      /* THE ACTUAL GATE. Enforced here, before the upgrade, because this is
       * the one place every connection passes -- and because a check in the
       * app would be theatre: the bundle is public and this URL is reachable
       * directly. No password, no document. */
      const grant = await grantOf(env, key);
      if (!grant) return new Response("unauthorized", { status: 401 });
      const room = decodeURIComponent(url.pathname.slice("/sync/".length));
      if (room) {
        /* A room is a project (worker/access.ts): `corko-<project>`, and
         * the key has to open that project, not merely be a key. */
        const project = projectOfRoom(room);
        if (!project) return new Response("no such room", { status: 404 });
        if (!allows(grant, project)) return new Response("forbidden", { status: 403 });
        const id = env.CORKO_ROOM.idFromName(room);
        return env.CORKO_ROOM.get(id).fetch(req);
      }
    }
    return env.ASSETS.fetch(req);
  },
};
