import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT,
  allows,
  grantFor,
  knownProjects,
  parseAccess,
  projectOfRoom,
  projectsOf,
  roomFor,
  stillKeyOfObject,
  stillListPrefix,
  stillListedIn,
  stillObjectKey,
} from "./access";

/* The gate's pure half: which password opens which project. */

describe("parseAccess", () => {
  it("is open with neither secret, and the legacy password alone means everything", () => {
    expect(parseAccess(undefined, undefined)).toBeNull();
    const m = parseAccess(undefined, "hunter2")!;
    expect(grantFor(m, "hunter2")).toBe("*");
    expect(grantFor(m, "hunter3")).toBeNull();
  });

  it("reads per-password project lists, keeps '*', and drops what it cannot use", () => {
    const m = parseAccess(
      JSON.stringify({
        teamA: ["acme", "acme", "Bad Name", "birds"],
        boss: "*",
        "": ["ghost"],
        junk: 42,
        nothing: ["NOPE!"],
      }),
      "legacy",
    )!;
    expect(grantFor(m, "teamA")).toEqual(["acme", "birds"]);
    expect(grantFor(m, "boss")).toBe("*");
    expect(grantFor(m, "legacy")).toBe("*");
    expect(grantFor(m, "")).toBeNull();
    expect(grantFor(m, "junk")).toBeNull();
    expect(grantFor(m, "nothing")).toBeNull();
  });

  it("a malformed map grants nothing but does not disable the legacy password", () => {
    expect(parseAccess("{not json", undefined)).toBeNull();
    const m = parseAccess("{not json", "legacy")!;
    expect(grantFor(m, "legacy")).toBe("*");
  });
});

describe("membership", () => {
  const m = parseAccess(JSON.stringify({ teamA: ["acme"], boss: "*" }), undefined)!;

  it("a list opens exactly its projects; '*' opens all of them, default included", () => {
    expect(allows(["acme"], "acme")).toBe(true);
    expect(allows(["acme"], DEFAULT_PROJECT)).toBe(false);
    expect(allows("*", "anything")).toBe(true);
    expect(knownProjects(m)).toEqual(["default", "acme"]);
    expect(projectsOf(m, "*")).toEqual(["default", "acme"]);
    expect(projectsOf(m, ["acme"])).toEqual(["acme"]);
    expect(knownProjects(null)).toEqual(["default"]);
  });

  it("rooms are projects, and the default project's room is the one every deployment already has", () => {
    expect(roomFor("default")).toBe("corko-default");
    expect(roomFor("acme")).toBe("corko-acme");
    expect(projectOfRoom("corko-default")).toBe("default");
    expect(projectOfRoom("corko-acme")).toBe("acme");
    expect(projectOfRoom("verify-abc")).toBeNull();
    expect(projectOfRoom("corko-Bad Name")).toBeNull();
  });
});

describe("still keys per project", () => {
  it("the default project keeps bare keys; every other project is a prefix", () => {
    expect(stillObjectKey("default", "st-a")).toBe("st-a");
    expect(stillObjectKey("acme", "st-a")).toBe("acme/st-a");
    expect(stillListPrefix("default")).toBe("");
    expect(stillListPrefix("acme")).toBe("acme/");
  });

  it("a listing shows a project only its own frames", () => {
    expect(stillListedIn("default", "st-a")).toBe(true);
    expect(stillListedIn("default", "acme/st-a")).toBe(false);
    expect(stillListedIn("acme", "acme/st-a")).toBe(true);
    expect(stillListedIn("acme", "acmeco/st-a")).toBe(false);
    expect(stillKeyOfObject("acme", "acme/st-a")).toBe("st-a");
    expect(stillKeyOfObject("default", "st-a")).toBe("st-a");
  });
});
