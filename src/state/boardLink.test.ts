import { describe, expect, it } from "vitest";
import { boardLinkFor, readBoardParam } from "./boardLink";

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
