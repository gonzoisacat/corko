import { describe, expect, it } from "vitest";
import { board4, node } from "../test/fixtures";
import { collectVocab, countColorUses, countTagUses } from "./boardVocab";
import { level } from "../test/fixtures";
import type { Board, Node } from "../state/types";

/* ------------------------------------------------------------------ *
 *  What counts as a board "using" a piece of the project vocabulary.
 *  This drives two surfaces that must agree: the legend shows only the
 *  tags a board uses, and boardFilePayload exports only the definitions
 *  a board references -- both read collectVocab, so this is the one
 *  definition of "referenced" (a slot placement counts even with no
 *  value filled in yet).
 * ------------------------------------------------------------------ */

describe("collectVocab", () => {
  it("is empty for a null or untouched board", () => {
    expect(collectVocab(null).tagIds.size).toBe(0);
    const vanilla = collectVocab(board4());
    expect(vanilla.tagIds.size).toBe(0);
    expect(vanilla.fieldIds.size).toBe(0);
  });

  it("collects tags and value keys at every depth", () => {
    const b = board4();
    b.roots[0].tags = ["tag-reel"]; // a root-tier card
    const scene = b.roots[0].children[0].children[0];
    scene.values = { "fld-tc": "01:00:00:00" };
    scene.children[2].tags = ["tag-alice"]; // a leaf
    const v = collectVocab(b);
    expect([...v.tagIds].sort()).toEqual(["tag-alice", "tag-reel"]);
    expect([...v.fieldIds]).toEqual(["fld-tc"]);
  });

  it("counts a category placed in a slot even with no value yet", () => {
    const b = board4();
    b.roots[0].children[0].children[0].children[0].slots = { br: "fld-day" };
    expect([...collectVocab(b).fieldIds]).toEqual(["fld-day"]);
  });

  it("ignores an empty slot entry", () => {
    const b = board4();
    const beat = node("bx");
    beat.slots = { tl: "" };
    b.roots[0].children[0].children[0].children.push(beat);
    expect(collectVocab(b).fieldIds.size).toBe(0);
  });
});

describe("countColorUses", () => {
  /* An override is only ever worn by a card that NAMES it, which is what
   * makes this a plain count -- and what makes it the right question to
   * gate the Remove confirm on: nothing wears it, nothing changes. */
  const painted = (id: string, color?: string): Node => ({
    ...node(id),
    ...(color ? { color } : {}),
  });

  const board = (): Board => ({
    id: "bd1",
    title: "b",
    levels: [level("scene"), level("beat")],
    legend: [],
    roots: [
      painted("s1", "archival"),
      {
        ...node("s2"),
        children: [painted("b1", "archival"), painted("b2", "other"), painted("b3")],
      },
    ],
  });

  it("counts every card naming the entry, at any depth", () => {
    expect(countColorUses(board(), "archival")).toBe(2);
    expect(countColorUses(board(), "other")).toBe(1);
  });

  it("answers 0 for an entry nothing wears -- the case that skips the dialog", () => {
    expect(countColorUses(board(), "unused")).toBe(0);
  });

  it("is unbothered by a missing board or a blank id", () => {
    expect(countColorUses(null, "archival")).toBe(0);
    expect(countColorUses(board(), "")).toBe(0);
  });
});

describe("countTagUses: only ask when something is lost, the tag edition", () => {
  const tagged = (id: string, ...tags: string[]): Node => ({ ...node(id), tags });
  const boardWith = (id: string, roots: Node[]): Board => ({
    id,
    title: id,
    levels: [level("l1", "Scene"), level("l2", "Beat")],
    legend: [],
    roots,
  });

  /* Tags are PROJECT-level (ADR 0002): a tag unused on the board you are
   * looking at can be worn three boards over, so the count walks every
   * board -- the one way this differs from countColorUses. */
  it("counts across EVERY board, at any depth", () => {
    const a = boardWith("a", [
      { ...node("s1"), children: [tagged("b1", "structure"), tagged("b2", "other")] },
    ]);
    const b = boardWith("b", [tagged("s2", "structure")]);
    expect(countTagUses([a, b], "structure")).toBe(2);
    expect(countTagUses([a, b], "other")).toBe(1);
  });

  it("answers 0 for a tag nothing wears -- the case that skips the dialog", () => {
    const a = boardWith("a", [tagged("s1", "worn")]);
    expect(countTagUses([a], "unworn")).toBe(0);
    expect(countTagUses([], "worn")).toBe(0);
    expect(countTagUses([a], "")).toBe(0);
  });
});
