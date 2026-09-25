import { useSyncExternalStore } from "react";
import { roomName } from "../project";
import { removeAwarenessStates, type Awareness } from "y-protocols/awareness";
import { doc } from "../ydoc";
import { createWebsocketSync } from "./websocket";
import type { PresenceUser, SyncFactory, SyncProvider, SyncStatus } from "./types";

/* ------------------------------------------------------------------ *
 *  Multiplayer store (spec Sec 7). Owns the single live SyncProvider and
 *  projects Yjs *awareness* (ephemeral presence, separate from the doc)
 *  into React via useSyncExternalStore -- the same external-store pattern
 *  as board/drag.ts. The doc itself syncs through the provider; the ops
 *  layer and IndexedDB persistence are untouched.
 *
 *  Presence carried per client: { user:{name,color}, focus:{id,field} }.
 *  We expose remote peers (for the presence bar) and a nodeId -> peer map
 *  (for edit-focus rings). Local state never appears in either.
 * ------------------------------------------------------------------ */

const ROOM = roomName; // a room is a project -- state/project.ts
// Explicit VITE_SYNC_HOST wins; otherwise a production build talks to its own
// origin (the Worker serves the app AND the rooms, so one deploy just works),
// and dev falls back to the local `wrangler dev` port.
//
// NOTE the isolation trick this enables, unchanged from before: writing
// .env.local with a dead VITE_SYNC_HOST BEFORE `npm run dev` gives an offline
// instance that cannot touch the live room. Delete it before any build -- a
// VITE_ var bakes into the bundle.
const HOST =
  import.meta.env.VITE_SYNC_HOST ??
  (import.meta.env.PROD ? window.location.host : "127.0.0.1:8787");

/* ---- ephemeral per-browser identity (no auth; Phase 7) ------------ */

const NAMES = ["Otter", "Heron", "Marten", "Finch", "Vixen", "Lynx", "Wren", "Ibis", "Stoat", "Crane"];
const PALETTE = ["#e5484d", "#3a7bd5", "#2f9e44", "#d6409f", "#e8830c", "#8b5cf6", "#0d9488", "#c2410c"];

export interface LocalUser {
  name: string;
  color: string;
}

function loadLocalUser(): LocalUser {
  try {
    const saved = localStorage.getItem("corko-user");
    if (saved) return JSON.parse(saved) as LocalUser;
  } catch {
    /* ignore malformed / unavailable storage */
  }
  const user: LocalUser = {
    name: NAMES[Math.floor(Math.random() * NAMES.length)],
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
  };
  try {
    localStorage.setItem("corko-user", JSON.stringify(user));
  } catch {
    /* ignore */
  }
  return user;
}

const localUser = loadLocalUser();

/* ---- store state -------------------------------------------------- */

let provider: SyncProvider | null = null;
let awareness: Awareness | null = null;

let status: SyncStatus = "disconnected";
let synced = false; // has the server's document state been received + merged?
const EMPTY_PEERS: PresenceUser[] = [];
const EMPTY_FOCUS: Map<string, PresenceUser> = new Map();
let peers: PresenceUser[] = EMPTY_PEERS;
let focus: Map<string, PresenceUser> = EMPTY_FOCUS;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/* Rebuild the remote-peer projections from awareness. New array/map refs
 * only when awareness actually changes, so useSyncExternalStore stays
 * stable between unrelated renders. */
function rebuildPresence() {
  if (!awareness) {
    peers = EMPTY_PEERS;
    focus = EMPTY_FOCUS;
    return;
  }
  const self = awareness.clientID;
  const nextPeers: PresenceUser[] = [];
  const nextFocus = new Map<string, PresenceUser>();
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === self) return;
    const u = (state as { user?: { name?: string; color?: string } }).user;
    if (!u) return;
    const f = (state as { focus?: { id?: string; field?: string } }).focus;
    const peer: PresenceUser = {
      clientId,
      name: u.name ?? "Someone",
      color: u.color ?? "#888888",
      focusId: f?.id ?? null,
      field: f?.field ?? null,
    };
    nextPeers.push(peer);
    if (peer.focusId) nextFocus.set(peer.focusId, peer);
  });
  peers = nextPeers.length ? nextPeers : EMPTY_PEERS;
  focus = nextFocus.size ? nextFocus : EMPTY_FOCUS;
}

/* Connect once for the tab's lifetime. Guarded so React StrictMode's
 * double-invoke (and any accidental re-call) is a no-op; we deliberately
 * never destroy on unmount -- the connection outlives component churn. */
export function connectSync(factory: SyncFactory = createWebsocketSync): void {
  if (provider) return;
  provider = factory(doc, { host: HOST, room: ROOM });
  awareness = provider.awareness;
  awareness.setLocalStateField("user", { name: localUser.name, color: localUser.color });
  awareness.on("change", () => {
    rebuildPresence();
    emit();
  });
  provider.onStatus((s) => {
    status = s;
    emit();
  });
  provider.onSynced((v) => {
    if (v) synced = true; // latches: once we've seen the server board, stay synced
    emit();
  });

  // Clean up when the tab goes away so peers/the server don't keep a ghost
  // connection. `pagehide` fires reliably on navigation, reload, and close.
  // On a real unload (not bfcache) also destroy the provider to close the
  // socket immediately; on bfcache (persisted) keep it for a possible restore.
  const cleanup = (e: PageTransitionEvent) => {
    if (awareness) removeAwarenessStates(awareness, [awareness.clientID], "pagehide");
    if (!e.persisted) provider?.destroy();
  };
  window.addEventListener("pagehide", cleanup);

  // Coming back from bfcache: pagehide removed our awareness state, so
  // without this we'd be a ghost -- seeing peers while invisible to them.
  const restore = (e: PageTransitionEvent) => {
    if (e.persisted && awareness) {
      awareness.setLocalStateField("user", { name: localUser.name, color: localUser.color });
    }
  };
  window.addEventListener("pageshow", restore);

  rebuildPresence();
  emit();
}

/* Publish which node/field the local user is editing (or clear it). */
export function setFocus(id: string | null, field: string | null): void {
  if (!awareness) return;
  awareness.setLocalStateField("focus", id ? { id, field } : null);
}

/* ---- hooks -------------------------------------------------------- */

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, () => status, () => "disconnected");
}

/* True once the server's document state has been received (or the doc was
 * already synced). Latches on; used to gate the first-run template picker so a
 * joining peer never wipes the board before it arrives. */
export function useSynced(): boolean {
  return useSyncExternalStore(subscribe, () => synced, () => false);
}

/* App.tsx's `settled` rule, readable outside React: the server's state has
 * arrived, OR this tab has had a few seconds and is not connected (solo,
 * offline, a local deployment with no Worker), so there is nothing more
 * to wait for. What the purge asks before it will run -- a replica that
 * has not caught up sees every newer board's images as orphans. */
const STARTED_AT = Date.now();
const SETTLE_MS = 4000;
export function isSettled(): boolean {
  return synced || (Date.now() - STARTED_AT > SETTLE_MS && status !== "connected");
}

export function usePresence(): PresenceUser[] {
  return useSyncExternalStore(subscribe, () => peers, () => EMPTY_PEERS);
}

export function useRemoteFocus(): Map<string, PresenceUser> {
  return useSyncExternalStore(subscribe, () => focus, () => EMPTY_FOCUS);
}

export function useLocalUser(): LocalUser {
  return localUser;
}
