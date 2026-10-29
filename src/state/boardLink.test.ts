import { describe, expect, it } from "vitest";
import { board4 } from "../test/fixtures";
import { boardLinkFor, decodeFolds, encodeFolds, laneIds, readBoardParam, readViewParams } from "./boardLink";

describe("board links", () => {
  it("names the project and the board, and nothing else", () => {
    const link = boardLinkFor("https://corko.example.dev/?p=clb&x=1#frag", "clb", "bd-abc123-4");
    expect(link).toBe("https://corko.example.dev/?p=clb&b=bd-abc123-4");
  });

  it("names the default project too, so a browser's remembered project cannot win", () => {
    expect(boardLinkFor("https://corko.example.dev/", "default", "bd-1")).toBe("https://corko.example.dev/?p=default&b=bd-1");
  });

  it("reads an id-shaped board param and refuses anything else", () => {
    expect(readBoardParam("?p=clb&b=bd-abc123-4")).toBe("bd-abc123-4");
    expect(readBoardParam("?p=clb")).toBeNull();
    expect(readBoardParam("?b=")).toBeNull();
    expect(readBoardParam("?b=%3Cscript%3E")).toBeNull();
    expect(readBoardParam("?b=" + "x".repeat(81))).toBeNull();
  });

  it("round-trips", () => {
    const link = boardLinkFor("http://127.0.0.1:8787/", "harbor", "c-mk2zq9ab-7");
    expect(readBoardParam(new URL(link).search)).toBe("c-mk2zq9ab-7");
  });
});

describe("a board link's view", () => {
  const board = () => board4();

  it("round-trips the folds as a bitmap over the board's lanes", () => {
    const b = board();
    const lanes = laneIds(b);
    expect(lanes.length).toBeGreaterThan(1);
    const folded = new Set([lanes[0], lanes[lanes.length - 1]]);
    const code = encodeFolds(b, (id) => folded.has(id));
    expect(code).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
    expect(decodeFolds(b, code)).toEqual(folded);
  });

  it("carries nothing when nothing is folded", () => {
    expect(encodeFolds(board(), () => false)).toBe("");
  });

  it("skips the folds when the board changed shape since the copy", () => {
    const b = board();
    const code = encodeFolds(b, () => true);
    const [, rest] = code.split(".");
    expect(decodeFolds(b, `${laneIds(b).length + 1}.${rest}`)).toBeNull();
    expect(decodeFolds(b, "nonsense")).toBeNull();
  });

  it("puts the view in the link and reads it back, every value checked", () => {
    const link = boardLinkFor("https://c.example.dev/", "clb", "bd-1", {
      view: "overview",
      zoom: 0.4567,
      column: 1,
      depth: 2,
      folds: "3.Bw",
    });
    expect(readViewParams(new URL(link).search)).toEqual({
      view: "overview",
      zoom: 0.457,
      column: 1,
      depth: 2,
      folds: "3.Bw",
    });
    expect(readViewParams("?v=x&z=-1&c=99&f=bad")).toBeNull();
  });

  it("leaves a typed board's zoom off when it is the whole board", () => {
    expect(boardLinkFor("https://c.example.dev/", "clb", "bd-1", { factor: 1 })).not.toContain("x=");
    expect(boardLinkFor("https://c.example.dev/", "clb", "bd-1", { factor: 1.4 })).toContain("x=1.4");
  });
});
