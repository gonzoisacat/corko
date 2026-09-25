/* ------------------------------------------------------------------ *
 *  WHO MAY OPEN WHICH PROJECT -- the pure half of the gate.
 *
 *  A PROJECT is a room is a doc is a password scope (owner's design,
 *  2026-09-01: one person deploys, runs several productions, hands each
 *  team its own password; the deployer sees everything). Folders inside
 *  a project tidy; only a project separates, because one Yjs doc means
 *  anyone who connects has all of it -- so the separation has to be here,
 *  at the sync boundary, or it is theatre.
 *
 *  The map is one secret holding JSON:
 *
 *      CORKO_ACCESS = { "<password>": ["acme", "birds"],
 *                       "<another>":  "*" }
 *
 *  A list is the projects that password opens; "*" opens every project
 *  (the deployer). Project ids are short lower-case slugs -- they become
 *  room names, R2 prefixes and URL params, so there is no room for
 *  spaces or case games. The one project that always exists is
 *  `default`, whose room is `corko-default`: the room every deployment
 *  has used since Phase 3, so an instance that never sets CORKO_ACCESS
 *  keeps working exactly as it did.
 *
 *  CORKO_PASSWORD (the original single secret) still works and means
 *  "*". Both may be set; the deployer usually keeps the old one as their
 *  own. With NEITHER set the gate is open, as it always was -- shipping a
 *  gate that locks the owner out before it is configured would be worse.
 * ------------------------------------------------------------------ */

export const DEFAULT_PROJECT = "default";
export const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export const roomFor = (project: string): string => `corko-${project}`;
export const projectOfRoom = (room: string): string | null => {
  if (!room.startsWith("corko-")) return null;
  const p = room.slice("corko-".length);
  return PROJECT_ID.test(p) ? p : null;
};

export type Grant = string[] | "*";

export interface AccessMap {
  /* password -> what it opens */
  grants: Map<string, Grant>;
}

/* null = no gate at all (neither secret set). */
export function parseAccess(json: string | undefined, legacyPassword: string | undefined): AccessMap | null {
  const grants = new Map<string, Grant>();
  if (json) {
    try {
      const v = JSON.parse(json) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [pw, g] of Object.entries(v as Record<string, unknown>)) {
          if (!pw) continue;
          if (g === "*") grants.set(pw, "*");
          else if (Array.isArray(g)) {
            const ids = g.filter((x): x is string => typeof x === "string" && PROJECT_ID.test(x));
            if (ids.length) grants.set(pw, [...new Set(ids)]);
          }
        }
      }
    } catch {
      /* a malformed map grants nothing; the legacy password below may still open the door */
    }
  }
  if (legacyPassword) grants.set(legacyPassword, "*");
  return grants.size ? { grants } : null;
}

/* Constant-time in value; length-leaking, which for a password of a
 * handful of words is fine. */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function grantFor(map: AccessMap, key: string | null): Grant | null {
  if (key === null) return null;
  for (const [pw, g] of map.grants) if (sameSecret(key, pw)) return g;
  return null;
}

export const allows = (grant: Grant, project: string): boolean =>
  grant === "*" || grant.includes(project);

/* Every project the map names, plus `default` first: what "*" means in
 * concrete terms, and what the deployer's directory lists. */
export function knownProjects(map: AccessMap | null): string[] {
  const set = new Set<string>([DEFAULT_PROJECT]);
  if (map) for (const g of map.grants.values()) if (g !== "*") for (const p of g) set.add(p);
  return [DEFAULT_PROJECT, ...[...set].filter((p) => p !== DEFAULT_PROJECT).sort()];
}

/* What a grant opens, spelled out. */
export const projectsOf = (map: AccessMap | null, grant: Grant): string[] =>
  grant === "*" ? knownProjects(map) : [...grant];

/* Where a project's stills live in the bucket. The default project keeps
 * BARE keys, because that is what every existing object is named; every
 * other project gets a prefix, so a project's purge can list its own
 * frames and no one else's. */
export const stillObjectKey = (project: string, key: string): string =>
  project === DEFAULT_PROJECT ? key : `${project}/${key}`;
export const stillListPrefix = (project: string): string =>
  project === DEFAULT_PROJECT ? "" : `${project}/`;
/* The default's listing sees the whole bucket; anything with a slash in
 * it belongs to another project. */
export const stillListedIn = (project: string, objectKey: string): boolean =>
  project === DEFAULT_PROJECT ? !objectKey.includes("/") : objectKey.startsWith(`${project}/`);
export const stillKeyOfObject = (project: string, objectKey: string): string =>
  project === DEFAULT_PROJECT ? objectKey : objectKey.slice(project.length + 1);

/* ---- TEAM PASSWORDS SET FROM INSIDE THE APP (2026-09-02) ----
 *
 * The access map is a secret, and a Worker cannot write secrets -- so a
 * password the deployer types into Project settings lives in the
 * directory object's storage instead, as a salted PBKDF2 hash; the
 * password itself is never stored and cannot be read back, only
 * replaced or cleared. One team password per project (a password that
 * opens several projects is still the map's job). The gate consults the
 * map first, then asks the directory. */
export const PBKDF2_ITERATIONS = 20_000;

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export function randomSalt(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return hex(b.buffer);
}

export async function hashPassword(salt: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return hex(bits);
}

/* A password's projects, against the stored hashes. One derivation
 * (the salt is shared), then a constant-time compare per entry. */
export async function projectsForPassword(
  salt: string,
  entries: Record<string, string>,
  password: string,
): Promise<string[]> {
  if (!password) return [];
  const h = await hashPassword(salt, password);
  return Object.entries(entries)
    .filter(([, stored]) => sameSecret(h, stored))
    .map(([id]) => id)
    .sort();
}
