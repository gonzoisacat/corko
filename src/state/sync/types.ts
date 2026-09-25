import type { Awareness } from "y-protocols/awareness";
import type { Doc } from "yjs";

/* ------------------------------------------------------------------ *
 *  The one seam between Corko and its network layer (spec Sec 3, Sec
 *  12; CLAUDE.md). Everything above talks only to `SyncProvider`; the
 *  concrete backend (PartyKit by default) is chosen by a `SyncFactory`.
 *  Swapping to a plain y-websocket / Hocuspocus server is a new factory
 *  implementing this interface -- no other change. Local IndexedDB
 *  persistence lives in ydoc.ts and is orthogonal: the doc still works
 *  offline if no provider ever connects.
 * ------------------------------------------------------------------ */

export type SyncStatus = "disconnected" | "connecting" | "connected";

/* A peer's shared presence (carried on Yjs awareness, not in the doc).
 * Identity is ephemeral and per-browser; `focusId` is the node the peer
 * is currently editing, so everyone else can ring-highlight it. */
export interface PresenceUser {
  clientId: number;
  name: string;
  color: string;
  focusId: string | null;
  field: string | null;
}

export interface SyncConfig {
  host: string;
  room: string;
}

export interface SyncProvider {
  readonly awareness: Awareness;
  /* Subscribe to connection status; returns an unsubscribe fn. */
  onStatus(cb: (status: SyncStatus) => void): () => void;
  /* Subscribe to initial-sync completion: true once the server's document
   * state has been received + merged, false while (re)connecting. Lets the
   * app tell "genuinely empty new board" from "board still arriving" -- so a
   * joining peer never sees the first-run picker before data lands. Fires the
   * current value on subscribe. Returns an unsubscribe fn. */
  onSynced(cb: (synced: boolean) => void): () => void;
  destroy(): void;
}

export type SyncFactory = (doc: Doc, config: SyncConfig) => SyncProvider;
