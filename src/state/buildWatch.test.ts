import { describe, expect, it } from "vitest";
import { compareBuild, readBuild, worse, type BuildStamp } from "./buildWatch";

/* The shape vite actually emits, which is what this parses in anger --
 * both hashed assets in the head, plus the epoch declaration. */
const head = (js: string, css: string, epoch?: number) => `
  <head>
    <meta charset="UTF-8" />
    ${epoch === undefined ? "" : `<meta name="corko-build-epoch" content="${epoch}" />`}
    <title>Corko -- Beat Board</title>
    <script type="module" crossorigin src="/assets/index-${js}.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-${css}.css">
  </head>`;

describe("readBuild", () => {
  it("takes both hashed assets, not just the script", () => {
    const b = readBuild(head("AAA", "BBB", 1));
    expect(b.assets).toBe("/assets/index-AAA.js /assets/index-BBB.css");
    expect(b.epoch).toBe(1);
  });

  /* The order in the file is vite's business, so it must not be part of
   * the identity -- otherwise a reshuffle reads as a new deployment. */
  it("is a SET, so the order in the file does not matter", () => {
    const a = readBuild(`<script src="/assets/index-A.js"></script><link href="/assets/index-B.css">`);
    const b = readBuild(`<link href="/assets/index-B.css"><script src="/assets/index-A.js"></script>`);
    expect(a.assets).toBe(b.assets);
  });

  it("counts an asset named twice once", () => {
    const b = readBuild(`<link rel="modulepreload" href="/assets/index-A.js"><script src="/assets/index-A.js">`);
    expect(b.assets).toBe("/assets/index-A.js");
  });

  /* A build from before the epoch existed must not read as a mismatch,
   * or the first deploy carrying this would paint every open tab red. */
  it("no epoch tag reads as zero", () => {
    expect(readBuild(head("AAA", "BBB")).epoch).toBe(0);
    expect(readBuild(`<meta name="corko-build-epoch" content="nonsense" />`).epoch).toBe(0);
  });

  it("reads the tag whichever quotes it wears", () => {
    expect(readBuild(`<meta name='corko-build-epoch' content='4'>`).epoch).toBe(4);
  });

  /* A dev server's entry is not hashed, so there is nothing to find --
   * which is what keeps the light green in dev with no env check. */
  it("finds nothing in a dev document", () => {
    const b = readBuild(`<head><script type="module" src="/src/main.tsx"></script></head>`);
    expect(b).toEqual({ assets: "", epoch: 0 });
  });
});

describe("compareBuild", () => {
  const mine: BuildStamp = { assets: "/assets/index-AAA.js", epoch: 2 };

  it("the same build is the latest build", () => {
    expect(compareBuild(mine, { ...mine })).toBe("latest");
  });

  it("different assets are an ordinary update", () => {
    expect(compareBuild(mine, { assets: "/assets/index-ZZZ.js", epoch: 2 })).toBe("update");
  });

  it("a stylesheet-only change still counts", () => {
    const a: BuildStamp = { assets: "/assets/index-A.css /assets/index-A.js", epoch: 0 };
    expect(compareBuild(a, { assets: "/assets/index-B.css /assets/index-A.js", epoch: 0 })).toBe("update");
  });

  it("a higher epoch is critical, whatever the assets say", () => {
    expect(compareBuild(mine, { assets: mine.assets, epoch: 3 })).toBe("critical");
    expect(compareBuild(mine, { assets: "/assets/index-ZZZ.js", epoch: 3 })).toBe("critical");
  });

  /* A ROLLBACK leaves clients ahead of the deployment. That is not an
   * emergency: the assets differ, so it reads as the ordinary update it
   * is, and nobody is told their work is at risk when it is not. */
  it("a LOWER epoch is not critical", () => {
    expect(compareBuild(mine, { assets: "/assets/index-ZZZ.js", epoch: 1 })).toBe("update");
  });
});

/* The edge serves old and new alternately while a deploy rolls out, so
 * a watcher that believed each poll would flicker. Once behind, behind. */
describe("worse", () => {
  it("climbs and never descends", () => {
    expect(worse("latest", "update")).toBe("update");
    expect(worse("update", "latest")).toBe("update");
    expect(worse("update", "critical")).toBe("critical");
    expect(worse("critical", "latest")).toBe("critical");
    expect(worse("latest", "latest")).toBe("latest");
  });
});
