# Changelog

Every release is a git tag `vX.Y.Z` on the commit that sets that
version in `package.json` and adds its entry here. If you run your own
Corko, this is the file to read before you update (the recipe is in
`docs/deploy.md`, "Updating"). Each entry says which of two kinds of
release it is:

- **Ordinary.** Deploy it whenever. Open tabs turn the deploy light
  yellow and keep working on the old build until they reload.
- **Coordinated reload.** The shape of the stored document changed, so
  an old build and the new one cannot share a room safely. Open tabs
  turn the light red; deploy at a quiet moment and have everyone
  reload. The release notes name the epoch it bumps to.

Versions stay below 1.0 until user accounts exist (spec Phase 7).

## 0.9.9 -- 2026-10-29 -- ordinary (epoch 1)

- **A board's look is the board's.** The frame and wall, card corners,
  tilt, pushpins and shadows, the images switch and the note dots now
  belong to the board, like the backdrop: everyone sees the same board.
  Change them in Options (Global settings) or with the board's own
  controls. Your own look is still there behind the Overrides button
  beside the steering wheel; switch it on to see yours instead. The
  first time an admin opens a board after this update, that admin's
  look for it becomes the board's.
- **A board link carries your view.** Copy link now includes Detail or
  Overview, the zoom and what is folded, and opening it shows the board
  as it was dressed, with the reader's overrides switched off.

## 0.9.8 -- 2026-10-28 -- ordinary (epoch 1)

- **A link to one board.** Each board in the Boards menu has a Copy
  link button. Someone whose browser already has the password opens
  straight onto that board; anyone else gets the password screen first.
  A link to a deleted board asks which board to open. A link into a
  project your password doesn't open says so.
- **One-click deploys and Update Corko build again on Cloudflare.**
  Since esbuild 0.28.2 came out, Cloudflare's npm refused the lockfile
  ("Missing: esbuild@0.28.2 from lock file"); the lockfile now records
  it. Nothing else changed version.
- **A cancelled drag on the Free Grid no longer moves anything.** When
  the browser interrupted a drag, the grid saved the cards wherever the
  pointer was at that moment -- and past the board's left or top edge,
  that shifted every card on the board. Now the cards go back, as they
  do when you press Escape.

## 0.9.7 -- 2026-10-18 -- ordinary (epoch 1)

- **Shift-click on the Free Grid adds or removes one card**, the same as
  Cmd-click. It used to select a range in the board's stored order,
  which on a grid lit up cards scattered all over it.
- **Dragging a selection on the Free Grid no longer turns the board into
  a ghost.** A stray text highlight -- which Shift-click used to extend
  across the board -- could start the browser's own text drag instead of
  the card drag. The grid now refuses that drag and clears the highlight
  when you press a card.

## 0.9.6 -- 2026-10-06 -- ordinary (epoch 1)

- **An update notice for admins** in the top bar, left of the deploy
  light: a quiet "Corko 0.9.5" with this instance's version, and a blue
  "Update" pill when a newer Corko release is out. Its panel says what changed, whether everyone must
  reload together, how to update, and opens the usage meters. Nobody
  else sees it; an admin's browser checks GitHub at most every six
  hours.
- **Playback speed in the Player**: a gauge button beside the duration
  opens a 0.25x-2x slider, remembered per board.

## 0.9.5 -- 2026-09-25 -- ordinary (epoch 1)

- Update Corko no longer asks you to copy in a workflow file your copy
  already has.
- The README and the deploy guide describe the Deploy to Cloudflare
  button and the Admin password; the staging copy is named correctly.

## 0.9.4 -- 2026-09-25 -- ordinary (epoch 1)

- **Update Corko**, a workflow in every one-click copy: Actions -> Update
  Corko -> Run workflow applies the newest release, keeps your own edits,
  and Cloudflare redeploys. A copy made before 0.9.4 needs its
  `.github/workflows/update-corko.yml` copied in once, by hand.
- The pull-request closer runs only on the public repo.

## 0.9.3 -- 2026-09-24 -- ordinary (epoch 1)

- **Deploy to Cloudflare button** in the README: a copy in your GitHub,
  built and deployed by Cloudflare, no terminal.

- **Set the Admin password in the app.** A fresh instance opens on a
  setup card that sets it; Project/Share settings changes or removes it.
  `CORKO_PASSWORD` still works beside it and is the way back in if it is
  forgotten.
- The usage meters are set in the Cloudflare dashboard after deploying,
  and `wrangler.jsonc` keeps them across deploys (`keep_vars`).
- Removed `postinstall-postinstall`, which broke installs on machines
  that have Yarn, including Cloudflare's build.

## 0.9.2 -- 2026-09-24 -- ordinary (epoch 1)

- `docs/deploy.md` is rewritten as a plain how-to: a short checklist,
  seven numbered steps, cost, updating, backups and troubleshooting.

## 0.9.1 -- 2026-09-21 -- ordinary (epoch 1)

The release the public repo starts from.

- `CONTRIBUTING.md`: suggestions as issues, no pull requests merged,
  and an automation that closes any on arrival.
- README and `docs/deploy.md` are self-contained; the guide says where
  your data lives and carries the proxy export settings itself.
- `scripts/verify-sync.mjs` takes the host as an argument.
- The maintainer's own instance config is no longer in `wrangler.jsonc`.

## 0.9.0 -- 2026-09-21 -- ordinary (epoch 1)

The first numbered release: everything built to date, and the first
one meant to be deployed by someone other than the maintainer.

- The checked-in `wrangler.jsonc` deploys clean on a free Cloudflare
  account with nothing created first: no still bucket, no account id,
  the free plan's limits. Shared stills and the usage meters are
  switched on by editing that file (`docs/deploy.md` steps 6 and 7).
- `docs/deploy.md` has a short free-plan checklist at its head and an
  "Updating" recipe.
- The boot splash's jingle is gone, file and all.
- What is built: three board types (Beat Map with its Overview, Columns,
  Free Grid) joined by nested boards; configurable tiers; real-time
  multiplayer with projects as password-scoped rooms and folders;
  metadata categories, display slots, tags, a project palette, notes
  with seven states and a full-width sheet, group edits; pictures on
  and beside cards; Player mode, EDL import with shared stills, a
  timecode calculator; dark mode, keyboard driving, a deploy light.
  Not built: user accounts and per-board permissions.
