/* ------------------------------------------------------------------ *
 *  The shared access password, client side.
 *
 *  The GATE IS THE SERVER's (worker/index.ts rejects /sync without the
 *  right key). Nothing here is a security boundary -- the bundle is public
 *  and the sync URL is reachable directly, so a check in the app would be
 *  theatre. This exists only so the UI can tell "wrong password" from
 *  "network down", which a refused websocket cannot express, and so the
 *  password is typed once per browser rather than every load.
 *
 *  Stored in localStorage next to the other per-browser prefs. That means
 *  it is readable by anything running on this origin -- acceptable for a
 *  password a whole team shares anyway, and the alternative (retyping it
 *  every reload) is the kind of friction that gets a password written on
 *  a sticky note.
 * ------------------------------------------------------------------ */

const KEY = "corko-access-key";

/* In-memory fallback for when localStorage is unavailable (private mode,
 * storage disabled). Without it the gate PASSED -- checkAccess was handed
 * the typed key directly -- but the sync provider then read storedKey(),
 * got "", and the Worker refused the socket: the exact
 * "Waiting for the shared board..." hang the gate exists to prevent, in
 * the one browser mode where storage silently fails. The key just doesn't
 * survive a reload, which matches what private mode means. */
let memKey = "";

export interface AccessState {
  /* Does this deployment have a password set at all? False means the
   * server is open -- surfaced in the UI so it can't stay that way by
   * accident. */
  required: boolean;
  /* Did the key we hold satisfy it? */
  ok: boolean;
  /* What it opens (worker/access.ts): the concrete project list, and
   * whether the grant was "*" -- the deployer. Present only when ok. */
  projects?: string[];
  admin?: boolean;
  /* No password of any kind yet (worker/index.ts): the instance is open
   * and waiting for its Admin password, which the setup card sets. */
  setup?: boolean;
}

/* The shortest Admin password the server takes (ADMIN_MIN_LENGTH in
 * worker/index.ts, which is the one that counts). */
export const ADMIN_MIN_LENGTH = 6;

/* "Skip for now" on the setup card, remembered for THIS browser only:
 * everyone else who opens an unset instance still sees the card, which
 * is what tells them to ask the person who sent the link. */
const SKIP_KEY = "corko-admin-setup-skipped";
export function setupSkipped(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
}
export function skipSetup(): void {
  try {
    localStorage.setItem(SKIP_KEY, "1");
  } catch {
    /* storage disabled: the card comes back next load, which is harmless */
  }
}

/* Set, change or (with "") remove the Admin password. The status is the
 * answer: 204 done, 400 too short, 401/403 not allowed -- which on the
 * setup card means somebody set one first -- 0 no server. */
export async function putAdminPassword(password: string, key = storedKey()): Promise<number> {
  try {
    const r = await fetch(`/admin/password?k=${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ password }),
    });
    return r.status;
  } catch {
    return 0;
  }
}

/* The last answer /auth gave, for the topbar's project switcher. */
let last: AccessState | null = null;
export const accessInfo = (): AccessState | null => last;

export function storedKey(): string {
  try {
    return localStorage.getItem(KEY) ?? memKey;
  } catch {
    return memKey; // storage disabled (private mode); the user retypes per load
  }
}

export function storeKey(k: string): void {
  memKey = k;
  try {
    localStorage.setItem(KEY, k);
  } catch {
    /* storage disabled -- memKey above carries it for this page's lifetime */
  }
}

export function clearKey(): void {
  memKey = "";
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/* Ask the server whether a password is required and whether ours works.
 *
 * A network failure is NOT an auth failure: returning `ok: false` there
 * would throw up a password screen every time the wifi drops, and the app
 * is meant to work offline off its IndexedDB copy. So an unreachable
 * server reports "not required, ok" and the normal sync retry/offline path
 * takes over. The server still refuses the socket if the key is wrong, so
 * nothing is let through by being optimistic here. */
export async function checkAccess(key = storedKey()): Promise<AccessState> {
  try {
    const res = await fetch(`/auth?k=${encodeURIComponent(key)}`, { cache: "no-store" });
    const state = (await res.json()) as AccessState;
    if (state.ok) last = state;
    return state;
  } catch {
    return { required: false, ok: true };
  }
}
