import { WebsocketProvider } from "y-websocket";
import { storedKey } from "../access";
import type { SyncFactory } from "./types";

/* ------------------------------------------------------------------ *
 *  Default sync backend: a plain y-websocket provider against Corko's
 *  own Cloudflare Worker (worker/index.ts).
 *
 *  This replaced the PartyKit provider on 2026-08-01. PartyKit's was a
 *  y-websocket FORK, so this is the same protocol and the same events --
 *  which is why the swap is one file, exactly as sync/types.ts predicted
 *  it would be.
 *
 *  y-websocket builds its URL as `serverUrl + "/" + room`, so the server
 *  routes on `/sync/<room>`. It also keeps a BroadcastChannel between
 *  tabs on the same origin: two tabs stay in step even with the network
 *  down, which is free offline behavior but worth remembering when
 *  testing -- two tabs agreeing does NOT prove the server is reachable.
 * ------------------------------------------------------------------ */

export const createWebsocketSync: SyncFactory = (doc, { host, room }) => {
  // A local wrangler dev server is plain ws; anything else is wss. Never
  // derive this from the page protocol alone -- the dev server is http
  // while a deployed Worker is always https.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  const url = `${local ? "ws" : "wss"}://${host}/sync`;

  /* The access password rides along as a query param -- y-websocket's only
   * hook for this, and the server checks it before upgrading the socket
   * (worker/index.ts). It is read ONCE here rather than per reconnect,
   * because y-websocket's `params` is a plain object baked into the URL;
   * changing the password therefore needs a reload, which is the same
   * moment everyone has to re-enter it anyway. */
  const provider = new WebsocketProvider(url, room, doc, {
    connect: true,
    params: { k: storedKey() },
  });
  return {
    awareness: provider.awareness,
    onStatus(cb) {
      const handler = (e: { status: "disconnected" | "connecting" | "connected" }) => cb(e.status);
      provider.on("status", handler);
      return () => provider.off("status", handler);
    },
    onSynced(cb) {
      const handler = (state: boolean) => cb(state);
      // "sync", not the legacy "synced": y-websocket emits both with the same
      // boolean, but only "sync" is in its types (and PartyKit's fork was
      // pinned to the old name).
      provider.on("sync", handler);
      if (provider.synced) cb(true); // fire current value on subscribe
      return () => provider.off("sync", handler);
    },
    destroy() {
      provider.destroy();
    },
  };
};
