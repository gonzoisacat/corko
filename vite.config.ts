import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Yjs must be a single instance across the app and the sync provider
  // (y-websocket depends on yjs too). Two copies break instanceof checks
  // -- see yjs#438. Dedupe forces one.
  resolve: { dedupe: ["yjs"] },
  /* The Worker's routes, forwarded to the local `wrangler dev` so the dev
   * app behaves like the deployed one: without this Vite's SPA fallback
   * answered /auth with index.html, the client read that as "open, one
   * project, not the deployer", and the gate, the project switcher and
   * the shared still store never showed on :5173. The socket needs no
   * proxy -- the sync layer dials :8787 directly (state/sync/index.ts). */
  server: {
    /* IPv4 loopback, stated (owner-reported 2026-09-04: "localhost 5173
     * is not resolving on firefox"). Left to `localhost`, Node resolved
     * it to ::1 first on this Mac and Vite bound ONLY that, so the dev
     * server answered on [::1]:5173 and refused 127.0.0.1. Chrome falls
     * back between the two; his Firefox, behind a VPN extension, does
     * not. Bound to 127.0.0.1 every browser reaches it, by `localhost`
     * or by number. */
    host: "127.0.0.1",
    proxy: {
      "/auth": "http://127.0.0.1:8787",
      "/admin": "http://127.0.0.1:8787",
      "/projects": "http://127.0.0.1:8787",
      "/still": "http://127.0.0.1:8787",
      "/stills": "http://127.0.0.1:8787",
      "/usage": "http://127.0.0.1:8787",
    },
  },
});
