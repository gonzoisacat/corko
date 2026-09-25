/* ------------------------------------------------------------------ *
 *  Live verification harness for the sync Worker.
 *
 *  Run against the DEPLOYED Worker, always on a throwaway room name --
 *  never `corko-default`, which is the real project.
 *
 *      node scripts/verify-sync.mjs <host>      (e.g. 127.0.0.1:8787)
 *
 *  Why Node and not two browser tabs: y-websocket keeps a BroadcastChannel
 *  between same-origin tabs, so two tabs agree with each other even when
 *  the server is dead. Two Node processes-worth of clients have no such
 *  back channel, so anything that arrives here came through the Worker.
 * ------------------------------------------------------------------ */

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import WS from "ws";

const HOST = process.argv[2];
if (!HOST) {
  console.error("usage: node scripts/verify-sync.mjs <host>   e.g. 127.0.0.1:8787, or corko.<your-subdomain>.workers.dev");
  process.exit(2);
}
// Same rule as src/state/sync/websocket.ts: a local wrangler dev server is
// plain ws, anything else is wss. This is what lets Worker changes be
// verified BEFORE a deploy: `npm run dev:worker`, then
// `node scripts/verify-sync.mjs 127.0.0.1:8787`.
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(HOST);
const URL = `${LOCAL ? "ws" : "wss"}://${HOST}/sync`;
/* A room is a PROJECT now (worker/access.ts): `corko-<id>`, and only a
 * "*" key opens one the access map does not name -- which is what the
 * deployer's own password is. Still throwaway: nothing else ever opens
 * them. */
const room = (label) => `corko-verify-${label}-${Math.random().toString(36).slice(2, 8)}`;

let failures = 0;
const ok = (msg) => console.log(`  PASS  ${msg}`);
const bad = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};

/* The deployment's access password, if it has one. Passed in the
 * environment so it never lands in this file or in a shell history you'd
 * paste around:
 *     CORKO_KEY='...' npm run verify:sync
 * Without it, every check fails at "never synced" -- which is itself proof
 * the gate is doing its job. */
const KEY = process.env.CORKO_KEY ?? "";

function connect(roomName) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(URL, roomName, doc, {
    WebSocketPolyfill: WS,
    connect: true,
    disableBc: true, // belt and braces: no cross-client shortcut of any kind
    params: KEY ? { k: KEY } : {},
  });
  return { doc, provider };
}

const waitFor = (predicate, ms, label) =>
  new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve(true);
      if (Date.now() - started > ms) {
        console.log(`        (timed out after ${ms}ms waiting for ${label})`);
        return resolve(false);
      }
      setTimeout(tick, 100);
    };
    tick();
  });

const synced = (p, ms = 15000) => waitFor(() => p.synced, ms, "initial sync");

/* ---- 1. two independent peers converge -------------------------- */
async function twoPeers() {
  console.log("\n1. Two concurrent peers, edits in BOTH directions");
  const r = room("peers");
  const a = connect(r);
  const b = connect(r);
  if (!(await synced(a.provider))) return bad("peer A never synced");
  if (!(await synced(b.provider))) return bad("peer B never synced");
  ok("both peers reached initial sync");

  a.doc.getMap("t").set("from-a", "alpha");
  const sawA = await waitFor(() => b.doc.getMap("t").get("from-a") === "alpha", 10000, "A -> B");
  sawA ? ok("A's edit reached B") : bad("A's edit never reached B");

  b.doc.getMap("t").set("from-b", "bravo");
  const sawB = await waitFor(() => a.doc.getMap("t").get("from-b") === "bravo", 10000, "B -> A");
  sawB ? ok("B's edit reached A") : bad("B's edit never reached A");

  // simultaneous writes to DIFFERENT keys must both survive (CRDT merge)
  a.doc.getMap("t").set("race", "a-wrote");
  b.doc.getMap("t").set("race-b", "b-wrote");
  const merged = await waitFor(
    () =>
      a.doc.getMap("t").get("race-b") === "b-wrote" && b.doc.getMap("t").get("race") === "a-wrote",
    10000,
    "simultaneous merge",
  );
  merged ? ok("simultaneous edits merged both ways") : bad("simultaneous edits did not converge");

  a.provider.destroy();
  b.provider.destroy();
}

/* ---- 2. presence ------------------------------------------------- */
async function presence() {
  console.log("\n2. Awareness (presence), including cleanup on disconnect");
  const r = room("presence");
  const a = connect(r);
  const b = connect(r);
  await synced(a.provider);
  await synced(b.provider);

  a.provider.awareness.setLocalStateField("user", { name: "Peer A" });
  b.provider.awareness.setLocalStateField("user", { name: "Peer B" });

  const sawPeer = await waitFor(
    () => [...b.provider.awareness.getStates().values()].some((s) => s.user?.name === "Peer A"),
    10000,
    "A's presence at B",
  );
  sawPeer ? ok("B sees A's presence") : bad("B never saw A's presence");

  a.provider.destroy(); // A leaves
  const gone = await waitFor(
    () => ![...b.provider.awareness.getStates().values()].some((s) => s.user?.name === "Peer A"),
    15000,
    "A's presence to clear",
  );
  gone ? ok("A's presence cleared after disconnect (no ghost cursor)") : bad("A left a ghost cursor");
  b.provider.destroy();
}

/* ---- 3. a big board ---------------------------------------------- */
async function bigBoard(nodeCount = 3200) {
  console.log(`\n3. A ${nodeCount}-node board through a first sync`);
  const r = room("big");
  const a = connect(r);
  if (!(await synced(a.provider))) return bad("writer never synced");

  const t0 = Date.now();
  a.doc.transact(() => {
    const arr = a.doc.getArray("nodes");
    const batch = [];
    for (let i = 0; i < nodeCount; i++) {
      const m = new Y.Map();
      m.set("id", `n-${i}`);
      m.set("title", `Beat ${i} -- a title of roughly realistic length`);
      batch.push(m);
    }
    arr.push(batch);
  });
  ok(`wrote ${nodeCount} nodes locally in ${Date.now() - t0}ms`);

  // a FRESH peer must receive the whole thing from the server
  const t1 = Date.now();
  const b = connect(r);
  const got = await waitFor(() => b.doc.getArray("nodes").length === nodeCount, 45000, "full board at a fresh peer");
  got
    ? ok(`a fresh peer pulled all ${nodeCount} nodes in ${Date.now() - t1}ms`)
    : bad(`fresh peer only got ${b.doc.getArray("nodes").length}/${nodeCount} nodes`);

  a.provider.destroy();
  b.provider.destroy();
  return r;
}

/* ---- 4. persistence across a full disconnect + idle --------------- */
async function idleAndWake(seconds) {
  console.log(`\n4. Everyone disconnects, ${seconds}s idle, then a fresh peer returns`);
  const r = room("idle");
  const a = connect(r);
  if (!(await synced(a.provider))) return bad("writer never synced");
  a.doc.getMap("t").set("written-before-idle", "still here");
  await new Promise((res) => setTimeout(res, 4000)); // let the 3s persist debounce fire
  a.provider.destroy();
  ok("wrote a value, then closed the only connection");

  await new Promise((res) => setTimeout(res, seconds * 1000));

  const b = connect(r);
  if (!(await synced(b.provider, 20000))) return bad("returning peer never synced");
  const survived = await waitFor(
    () => b.doc.getMap("t").get("written-before-idle") === "still here",
    10000,
    "the value to come back",
  );
  survived
    ? ok(`value survived ${seconds}s with the room empty (object rebuilt from storage)`)
    : bad("value did NOT survive -- persistence or the wake path is broken");
  b.provider.destroy();
}

/* ---- 5. an open socket that has been idle still works ------------- */
async function idleSocketStillWorks(seconds) {
  console.log(`\n5. A socket left OPEN and idle for ${seconds}s, then used`);
  const r = room("idlesock");
  const a = connect(r);
  const b = connect(r);
  await synced(a.provider);
  await synced(b.provider);
  ok("two peers connected, now going quiet");

  await new Promise((res) => setTimeout(res, seconds * 1000));

  a.doc.getMap("t").set("after-idle", "landed");
  const landed = await waitFor(() => b.doc.getMap("t").get("after-idle") === "landed", 15000, "post-idle edit");
  landed
    ? ok(`an edit after ${seconds}s of silence still reached the other peer`)
    : bad("an edit after idling did NOT propagate -- hibernation wake is broken");

  a.provider.destroy();
  b.provider.destroy();
}

/* ---- 6. a snapshot too big for ONE storage value ------------------ *
 *
 *  A Durable Object caps key + value combined at 2 MB on EVERY plan, and
 *  the room's snapshot used to live under one key -- so past that ceiling
 *  the put threw into a catch nobody tails, and the next hibernation
 *  rebuild silently rolled the project back. worker/docStore.ts splits it
 *  across `doc:0..n` instead.
 *
 *  docStore.test.ts pins that logic against a fake Map. This is the part
 *  a fake cannot prove: that REAL Durable Object storage takes the
 *  multi-key write, keeps it atomic, and hands every chunk back after the
 *  object has been evicted and rebuilt. Checks 3 and 4 don't reach it --
 *  a 3200-node board encodes to ~300 KB, comfortably inside one chunk. */
async function overOneChunk(mb = 3) {
  console.log(`\n6. A ~${mb} MB snapshot (more than one storage value holds)`);
  const r = room("chunked");
  const a = connect(r);
  if (!(await synced(a.provider))) return bad("writer never synced");

  // ~1 KB per row, so `mb` megabytes of content in mb*1000 rows
  const rows = mb * 1000;
  a.doc.transact(() => {
    const arr = a.doc.getArray("bulk");
    const batch = [];
    for (let i = 0; i < rows; i++) batch.push(`row ${i} ` + "x".repeat(1000));
    arr.push(batch);
  });
  const bytes = Y.encodeStateAsUpdate(a.doc).length;
  bytes > 2_000_000
    ? ok(`wrote a ${(bytes / 1e6).toFixed(2)} MB snapshot -- past the single-value ceiling`)
    : bad(`snapshot is only ${(bytes / 1e6).toFixed(2)} MB -- this check proves nothing`);

  // let the 3s persist debounce flush, then take every client away so the
  // room can only come back from storage
  await new Promise((res) => setTimeout(res, 6000));
  a.provider.destroy();
  await new Promise((res) => setTimeout(res, 8000));

  const b = connect(r);
  const back = await waitFor(
    () => b.doc.getArray("bulk").length === rows,
    60000,
    "the whole multi-chunk snapshot",
  );
  back
    ? ok(`all ${rows} rows came back from storage after every client left`)
    : bad(`only ${b.doc.getArray("bulk").length}/${rows} rows returned -- chunked persistence is broken`);

  // ...and it must be the same bytes, not merely the same count
  const intact = b.doc.getArray("bulk").get(rows - 1) === a.doc.getArray("bulk").get(rows - 1);
  intact ? ok("the last row survived byte-for-byte (no torn chunk)") : bad("content differs after reload");
  b.provider.destroy();
}

const idleSecs = Number(process.env.IDLE_SECS ?? 45);
console.log(`Corko sync verification -> ${URL}`);
console.log("(throwaway rooms only; corko-default is never touched)");
console.log(KEY ? "using CORKO_KEY from the environment" : "no CORKO_KEY set -- expect failures if the deployment is gated");

await twoPeers();
await presence();
await bigBoard();
await idleAndWake(idleSecs);
await idleSocketStillWorks(idleSecs);
await overOneChunk();

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
