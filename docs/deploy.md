# Deploy your own Corko

One Cloudflare Worker serves the app and the sync server together. It
runs on Cloudflare's free plan.

## The short version

- Make a free Cloudflare account at dash.cloudflare.com.
- Install Node 20 or newer, clone this repo, and run `npm install`.
- `npx wrangler login` -- authorizes this machine against your account.
- `npm run deploy` -- builds and deploys, then prints your URL,
  `https://corko.<your-subdomain>.workers.dev`.
- `npx wrangler secret put CORKO_PASSWORD` -- sets the password.
- Open the URL, type the password, make a board. Send your team the URL
  and the password.

Everything below is detail on those steps and the optional extras.

## 1. Try it locally

```bash
git clone <this-repo>
cd corko
npm install
npm run dev
```

Open <http://localhost:5173>. Open it in two windows to see
multiplayer. `npm run dev` runs the app and a local sync server on port
8787, with its own storage in `.wrangler/`.

## 2. Deploy

```bash
npx wrangler login
npm run deploy
```

Wrangler prints your URL. The Worker serves the app and the sync
connection from that one address.

To change the first part of the URL, edit `"name": "corko"` in
`wrangler.jsonc` before deploying. To use your own domain, add a
`routes` entry to `wrangler.jsonc` and deploy again.

## 3. Set a password

```bash
npx wrangler secret put CORKO_PASSWORD
```

It takes effect immediately, with no redeploy. Until it is set, anyone
with the URL can open the instance. To check it:

```bash
curl -i https://corko.<your-subdomain>.workers.dev/auth
# 401  {"required":true,"ok":false}   <- password set
# 200  {"required":false,"ok":true}   <- no password yet
```

## 4. Projects and team passwords (optional)

One instance can hold several projects. Each project has its own boards
and can have its own password. Your `CORKO_PASSWORD` opens all of them.

**From inside the app:** the project name at the top left is a menu.
With your password it offers **Set up new project...** and **Project
settings...**, where you name a project and set, change or clear its
team password. A team password opens that one project only.

**From the command line**, when one password should open several
projects, set an access map:

```bash
npx wrangler secret put CORKO_ACCESS
# paste, for example:
# {"swallows-2026":["swallows"],"harbor-cut":["harbor"],"my-own-password":"*"}
```

- Each key is a password; its list is the projects it opens.
- `"*"` opens every project.
- A project id is lower-case letters, digits, `-` and `_`, up to 40
  characters.
- Every instance starts with a project called `default`.

People open a project at `https://<your-host>/?p=<id>`. A password that
opens one project goes straight there; one that opens several asks
which.

To move boards between projects, use **Export project...** or a board's
export in one, then **Load project...** or **Load board...** in the
other.

## 5. A staging copy (optional)

```bash
npm run deploy:staging
npx wrangler secret put CORKO_PASSWORD --env staging
```

This deploys a second instance, `<name>-staging`, at its own address
with its own storage. Use it to try passwords and projects before
setting them up for real.

## 6. Shared frame stills (optional)

The EDL import grabs a still for every shot. By default the stills stay
in the browser that ran the import. To share them with everyone:

```bash
npx wrangler r2 bucket create corko-stills
```

Then uncomment the `r2_buckets` line in `wrangler.jsonc` and run
`npm run deploy` again. Create the bucket before deploying with the line
uncommented. R2 needs a card on file, including on its free tier.

## 7. Usage meters (optional)

**Cmd/Ctrl+U** in the app opens a panel showing how much of Cloudflare's
limits the instance is using.

1. In the Cloudflare dashboard: **My Profile -> API Tokens -> Create
   Token -> Custom**, with one permission: **Account -> Account
   Analytics -> Read**.
2. ```bash
   npx wrangler secret put CORKO_USAGE_TOKEN
   ```
3. In `wrangler.jsonc`, set `CORKO_ACCOUNT_ID` to your account id
   (`npx wrangler whoami` prints it) and `CORKO_PLAN` to `"free"` or
   `"paid"`.
4. Run `npm run deploy` again.

## What it costs

The free plan allows **100,000 requests a day**. Serving the app does not
count against it, and sync messages count at 20 to 1. A team of ten
editing all day uses a few percent.

Over the limit, the free plan stops serving until the count resets at
**00:00 UTC**. The **Workers Paid plan ($5/month)** bills overage in
cents instead of stopping.

## Updating

Each release is a git tag with an entry in `CHANGELOG.md`. Every entry
says whether it is **ordinary** or a **coordinated reload**.

1. Read the changelog entries since your version (`npm pkg get version`
   prints yours).
2. In the app, **Export project...** from the Boards menu.
3. ```bash
   git pull
   npm install
   npm run deploy
   ```
4. For a **coordinated reload**, have everyone reload after the deploy.
   Open tabs show a red light in the top bar until they do. After an
   ordinary release the light is yellow, and reloading can wait.

Secrets, projects, boards and stills all carry over.

## Backups

Your projects are stored in your Cloudflare account. The instance keeps
two rolling snapshots and a daily copy. **Export project...** in the
Boards menu saves every board to one file on your machine.

## Troubleshooting

- **"Waiting for the shared board..." does not go away:** check the
  password with the `/auth` request in step 3.
- **Collaborators don't see frame stills:** set up step 6.
- **A board file from another instance shows no stills:** board files
  carry references to stills, not the stills. Re-run the EDL import to
  grab them again.
- **A video will not import:** it must be **H.264 in an .mp4**. The best
  proxy is H.264 High profile, 8-bit 4:2:0, progressive, about 960 px on
  the long edge, at exactly the sequence's frame rate, with a keyframe
  every second, no audio, and the whole sequence with no slate, bars or
  handles. With ffmpeg:

  ```
  ffmpeg -i in.mov -c:v libx264 -profile:v high -pix_fmt yuv420p \
    -vf scale=960:-2 -g <fps> -keyint_min <fps> -sc_threshold 0 \
    -bf 0 -b:v 3M -an -movflags +faststart out.mp4
  ```

## License

AGPL-3.0-or-later. The full text is in `LICENSE`. If you run a modified
copy for others over a network, offer them its source.
