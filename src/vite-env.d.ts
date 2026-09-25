/// <reference types="vite/client" />

interface ImportMetaEnv {
  /* Host of the Yjs sync backend (Corko's own Cloudflare Worker). In dev
   * this is the local `wrangler dev` server; a production build defaults to
   * its own origin, since the Worker serves the app and the rooms together.
   * Falls back to 127.0.0.1:8787 when unset in dev. */
  readonly VITE_SYNC_HOST?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
