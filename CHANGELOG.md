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
