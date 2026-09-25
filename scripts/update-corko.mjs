#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 *  UPDATE A COPY OF CORKO TO A NEWER RELEASE (owner's option A,
 *  2026-09-25).
 *
 *  Run by .github/workflows/update-corko.yml in a stranger's copy, which
 *  fetches THIS file from the public repo's main branch each time rather
 *  than running the copy's own -- so a fix here reaches every copy. It
 *  runs in the copy's checkout. The copy is
 *  the private repo the Deploy to Cloudflare button makes, and it is
 *  NOT a fork: Cloudflare imports the release as one fresh commit
 *  ("source repo import") and renames the project in package.json and
 *  wrangler.jsonc. It shares no history with the public repo, so there
 *  is no "Sync fork" and a plain merge would conflict everywhere.
 *
 *  What works instead is the release tags. The copy knows its version
 *  (package.json), and the public repo has a tag for it and for every
 *  release since. So: fetch the public repo's tags, take the change
 *  between the copy's version and the target, and apply it with a
 *  THREE-WAY merge (`git apply --3way`). The copy's own edits -- the
 *  renamed project, a bucket switched on -- survive unless a release
 *  changed the same lines, and then this stops and names the files
 *  rather than guessing.
 *
 *  `.github/` is never touched: the token a workflow runs with may not
 *  write workflow files, so a push that did would be refused whole. When
 *  a release changes them this says so and the owner copies them by
 *  hand.
 *
 *  It commits, and the workflow pushes; the push is what makes
 *  Cloudflare rebuild and redeploy.
 *
 *      node scripts/update-corko.mjs [version]
 *
 *  UPSTREAM (a URL or a local path) overrides the public repo, which is
 *  how this is tested against a release that is not pushed yet.
 *  GITHUB_STEP_SUMMARY, when set, receives a report in Markdown.
 * ------------------------------------------------------------------ */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const UPSTREAM = process.env.UPSTREAM || "https://github.com/gonzoisacat/corko.git";
const TAG_NS = "refs/tags/corko-upstream/";

/* ---- pure halves, pinned by scripts/update-corko.test.ts ---------- */

export const parseVersion = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

export const compareVersions = (a, b) => {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};

/* The newest of a list of tag names, ignoring anything not vX.Y.Z. */
export const latestVersion = (tags) =>
  tags
    .map((t) => t.replace(/^v/, ""))
    .filter((t) => parseVersion(t))
    .sort(compareVersions)
    .pop() ?? null;

/* The CHANGELOG entries after `from`, up to and including `to`: each
 * `## X.Y.Z -- date -- kind` heading with its body. `coordinated` is
 * whether any of them asks everyone to reload together. */
export function entriesBetween(changelog, from, to) {
  const parts = changelog.split(/^(?=## )/m);
  const entries = [];
  for (const part of parts) {
    const head = /^## (\d+\.\d+\.\d+)\b(.*)$/m.exec(part);
    if (!head) continue;
    const v = head[1];
    if (compareVersions(v, from) > 0 && compareVersions(v, to) <= 0) entries.push({ version: v, text: part.trim() });
  }
  return { entries, coordinated: entries.some((e) => /coordinated reload/i.test(e.text.split("\n")[0])) };
}

/* ---- the run ------------------------------------------------------- */

const git = (args, opts = {}) => execFileSync("git", args, { encoding: "utf8", ...opts }).trim();

function summary(md) {
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
}

function fail(md) {
  summary(md);
  process.exit(1);
}

function main() {
  const requested = (process.argv[2] || "").trim();
  const current = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  if (!parseVersion(current)) fail(`This copy's package.json has no release version ("${current}"), so there is nothing to update from.`);

  git(["fetch", "--quiet", "--no-tags", UPSTREAM, `+refs/tags/*:${TAG_NS}*`]);
  const tags = git(["for-each-ref", "--format=%(refname)", TAG_NS]).split("\n").filter(Boolean).map((r) => r.slice(TAG_NS.length));
  const target = requested ? requested.replace(/^v/, "") : latestVersion(tags);
  if (!target || !parseVersion(target)) fail(`"${requested}" is not a release version.`);
  if (!tags.includes(`v${target}`)) fail(`There is no release ${target}.`);
  if (!tags.includes(`v${current}`)) fail(`This copy is at ${current}, which is not a published release, so it cannot be updated automatically.`);

  const order = compareVersions(target, current);
  if (order === 0) {
    summary(`## Already up to date\n\nThis copy is at Corko ${current}, the ${requested ? "requested" : "latest"} release.`);
    return;
  }
  if (order < 0) fail(`This copy is at ${current}, newer than ${target}. Updating never goes backwards.`);

  const from = `${TAG_NS}v${current}`;
  const to = `${TAG_NS}v${target}`;
  const changed = git(["diff", "--name-only", from, to]).split("\n").filter(Boolean);
  const workflows = changed.filter((f) => f.startsWith(".github/"));
  const patch = execFileSync("git", ["diff", "--binary", "--full-index", from, to, "--", ".", ":(exclude).github"]);

  if (patch.length) {
    try {
      execFileSync("git", ["apply", "--3way", "--whitespace=nowarn"], { input: patch, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      const conflicted = git(["diff", "--name-only", "--diff-filter=U"]).split("\n").filter(Boolean);
      git(["reset", "--hard", "--quiet"]);
      git(["clean", "-fd", "--quiet"]);
      fail(
        `## Update to ${target} stopped\n\nNothing was changed. ` +
          (conflicted.length
            ? `Your copy has its own edits on the same lines this release changes, in:\n\n${conflicted.map((f) => `- \`${f}\``).join("\n")}\n\nUndo your edit to those lines, or make the release's change to them by hand, then run this again.`
            : `The change would not apply:\n\n\`\`\`\n${String(e.stderr || e.message).trim()}\n\`\`\``),
      );
    }
  }

  git(["add", "-A"]);
  const status = git(["status", "--porcelain"]);
  if (!status) {
    summary(`## Nothing to apply\n\n${current} and ${target} differ only in files this update leaves alone.`);
    return;
  }

  const changelog = git(["show", `${to}:CHANGELOG.md`]);
  const { entries, coordinated } = entriesBetween(changelog, current, target);
  git(["-c", "user.name=Update Corko", "-c", "user.email=update-corko@users.noreply.github.com", "commit", "--quiet", "-m", `Update Corko to ${target}`, "-m", `From ${current}. Applied by the Update Corko workflow.`]);

  summary(
    [
      `## Updated Corko from ${current} to ${target}`,
      "",
      "Pushing this commit makes Cloudflare build and deploy it, which takes a few minutes.",
      coordinated
        ? "\n**This update needs everyone to reload together.** Tell your team to reload once the deploy finishes. Until they do, their tabs show a red light in the top bar."
        : "\nOpen tabs will show a yellow light in the top bar. Reloading can wait.",
      workflows.length
        ? `\n**This release also changes GitHub workflow files, which an update cannot write.** Copy these from the release by hand:\n\n${workflows.map((f) => `- \`${f}\``).join("\n")}`
        : "",
      "",
      "### What changed",
      "",
      entries.map((e) => e.text).join("\n\n") || "(no changelog entries)",
    ].join("\n"),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
