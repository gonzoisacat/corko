import { useSyncExternalStore } from "react";
import { DEFAULT_PLAYER_PREFS, type PlayerPrefs } from "./player";
import { scoped } from "./project";

/* ------------------------------------------------------------------ *
 *  The player's knobs, PER BOARD, per browser -- which tier the capture
 *  button mints, the rate, the start timecode, the two stamp boxes.
 *  Local like fold.ts and settings.ts: which proxy you are watching and
 *  what you call its start are facts about this desk, not about the
 *  cut. The video itself is never stored anywhere; you pick the file
 *  again next session.
 * ------------------------------------------------------------------ */

const KEY = scoped("corko-player");

type Stored = Record<string, Partial<PlayerPrefs>>;

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Stored;
    }
  } catch {
    /* ignore */
  }
  return {};
}

let store = load();
let version = 0;
const listeners = new Set<() => void>();
const cache = new Map<string, { v: number; value: PlayerPrefs }>();

function normalize(p: Partial<PlayerPrefs> | undefined): PlayerPrefs {
  const d = DEFAULT_PLAYER_PREFS;
  return {
    verb: p?.verb === "apply" ? "apply" : "create",
    tierDepth: typeof p?.tierDepth === "number" && p.tierDepth >= 0 ? Math.floor(p.tierDepth) : d.tierDepth,
    // "" is a real value: the file said nothing and nobody has picked
    rateLabel: typeof p?.rateLabel === "string" ? p.rateLabel : d.rateLabel,
    startTC: typeof p?.startTC === "string" ? p.startTC : d.startTC,
    followEmbedded: p?.followEmbedded !== false,
    stampTimecode: p?.stampTimecode !== false,
    stampRuntime: p?.stampRuntime !== false,
    still: p?.still !== false,
    tagsOpen: p?.tagsOpen !== false,
  };
}

export function playerPrefsFor(boardId: string): PlayerPrefs {
  const hit = cache.get(boardId);
  if (hit && hit.v === version) return hit.value;
  const value = normalize(store[boardId]);
  cache.set(boardId, { v: version, value });
  return value;
}

export function setPlayerPref<K extends keyof PlayerPrefs>(boardId: string, key: K, value: PlayerPrefs[K]) {
  store = { ...store, [boardId]: { ...store[boardId], [key]: value } };
  version++;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function usePlayerPrefs(boardId: string): PlayerPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => playerPrefsFor(boardId),
    () => playerPrefsFor(boardId),
  );
}
