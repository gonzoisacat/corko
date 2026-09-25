# Corko

A lightweight, collaborative beat-boarding app for documentary editing.
Free, open-source, self-deployable.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/gonzoisacat/corko)

**To run your own copy**, click the button above, or see
[docs/deploy.md](docs/deploy.md). One Cloudflare Worker serves the app
and the sync server together, on Cloudflare's free plan.

## What it is

A cut as a collapsible hierarchy of cards -- Act, Scene, Beat, or any
ladder you name -- fast at tens of thousands of cards, shared live with a
small team, and self-deployed on one Cloudflare Worker. Everything below
is built and in daily use.

- **Three board types, joined by nested boards.** The **Beat Map** (the
  cut: collapsible swimlanes down to card rows, with a zoomed-out
  **Overview** that draws the whole cut as colored proxies), **Columns**
  (a kanban over the same data) and the **Free Grid** (a corkboard with
  cards on a lattice, pictures, yarn between pins, and a frame). A card
  can stand in for another board; a Beat Map can be laid out as a new
  Free Grid in one click.
- **Configurable tiers**: one recursive node type; a node's tier is its
  depth in the board's own named ladder. Templates for the common
  ladders, or build your own.
- **Real-time multiplayer** on Yjs: presence, a ring on the card someone
  is editing, offline edits that merge on reconnect, and a repair pass
  that converges the duplicates concurrent moves can create. Projects
  are rooms with their own team passwords; folders inside a project.
- **Metadata**: a project-wide vocabulary of categories, values on any
  card, six display slots on the card face, tags (as edge tabs or as a
  split of the card's color), a color palette, notes with seven states
  and a full-width notes sheet, group edits across a selection.
- **Pictures**: an image on any card, fill / fit / tiled, or standing
  beside a scene card; text overrides for type over a photo.
- **Footage**: a Player mode that mints cards from frames of a proxy
  with timecode; a CMX3600 EDL import that grabs a frame per shot, with
  the stills shared through R2; a timecode calculator.
- **Chrome**: dark mode, keyboard driving of every surface, a deploy
  light that tells a tab it is behind, a hidden pinboard designer for
  the mark. Tooltips on everything.
- **Not built**: user accounts and per-board permissions. Everyone who
  can open a project can edit all of it. Corko is a beat board, not a
  general whiteboard, and stays that way on purpose.

## Architecture

State and rendering are cleanly separated: the render layer reads
immutable snapshots of a Yjs document and calls `ops.*` in
`src/state/ydoc.ts`, the one writer, each op one transaction. Most
files carry a header saying what they own and why; read it before
changing one.

```
src/
  state/     the Yjs doc, snapshot projection, ops (the ONLY writer),
             the pure models (tiers, grid lattice, timecode, EDL,
             notes, the palette), local per-browser stores
    sync/    the swappable multiplayer layer (self-hosted default)
  board/     the render layer: panes, the three board types, the
             Overview, panels, menus, drag, keyboard
  ui/        shared pieces: editable text, float panels, dialogs,
             the splash and the mark
worker/      the Cloudflare Worker + Durable Object sync server (Yjs
             relay, snapshot persistence, the password gate, projects,
             shared stills, usage meters); wrangler.jsonc configures it
```

## Run it

```bash
npm install
npm run dev
```

`npm run dev` runs the Vite app and a local `wrangler dev` sync server together.
Then open the URL Vite prints (default http://localhost:5173). Open it in
two windows to see multiplayer. No third-party account is needed for local
dev; the app also works fully offline if the sync server isn't running.

Other scripts:

```bash
npm run dev:web    # just the Vite app
npm run dev:worker # just the local sync server (port 8787)
npm run build      # type-check + production build
npm run preview    # serve the production build
npm run typecheck  # types only
npm run deploy     # build + deploy to your own Cloudflare (see docs/deploy.md)
npm test           # the headless test suite
```

## Deploying

See **[docs/deploy.md](docs/deploy.md)** -- a free-plan checklist,
then deploy, set a password, what it costs, and how to update.
Releases are tags with an entry each in [CHANGELOG.md](CHANGELOG.md).
Two things to know before you deploy: there are no user accounts yet,
so everyone with the URL and the password shares one project with
equal rights; and a fresh deployment is **open until you set
`CORKO_PASSWORD`**.

## Suggestions and bugs

Open an issue. Corko takes suggestions, not pull requests --
[CONTRIBUTING.md](CONTRIBUTING.md) says why and what makes a report
useful.

## License

AGPL-3.0-or-later -- full text in [LICENSE](LICENSE). The Affero clause
is what keeps every *deployed* copy open, not just every distributed
one.
