import { describe, expect, it } from "vitest";
import { node } from "../test/fixtures";
import { FIELD_TTL_MS, INSERT_TTL_MS, IntentJournal, MAX_BYTES, diffNode, type FieldEntry, type IntentEntry } from "./intent";

/* The pure half of the intent journal: what a local write records, and
 * how the record ages. The two-peer scenarios it exists for are in
 * ydoc.test.ts ("intent repair"). */

describe("diffNode", () => {
  it("records one field entry per changed field, keyed on the map's item id", () => {
    const before = { ...node("b1"), title: "Old", color: "red" };
    const after = { ...node("b1"), title: "New", color: "red", textSize: 20 };
    const out = diffNode(before, after, "7:12", 1000);
    expect(out.map((e) => (e.kind === "field" ? [e.key, e.before, e.after] : null))).toEqual([
      ["title", "Old", "New"],
      ["textSize", undefined, 20],
    ]);
    expect(out.every((e) => e.kind === "field" && e.item === "7:12" && e.t === 1000)).toBe(true);
  });

  it("records an insert per NEW child, at its index, and ignores reorders", () => {
    const before = node("s1", [node("b1"), node("b2")]);
    const after = node("s1", [node("b2"), node("bX"), node("b1")]);
    const out = diffNode(before, after, "1:1", 5);
    expect(out).toHaveLength(1);
    const e = out[0];
    expect(e.kind).toBe("insert");
    if (e.kind === "insert") {
      expect(e.nodeId).toBe("bX");
      expect(e.parentId).toBe("s1");
      expect(e.parentItem).toBe("1:1");
      expect(e.index).toBe(1);
      expect(e.node.id).toBe("bX");
    }
  });

  it("compares structured fields by value, so an identical notes array is no change", () => {
    const notes = [{ id: "n1", body: "hi", author: "A", state: "open" as const, createdAt: 1 }];
    const before = { ...node("b1"), notes: [...notes] };
    const after = { ...node("b1"), notes: notes.map((n) => ({ ...n })) };
    expect(diffNode(before, after, "1:1", 0)).toEqual([]);
  });
});

describe("IntentJournal", () => {
  const now = Date.now();
  const field = (t: number, nodeId = "b1"): IntentEntry => ({
    kind: "field",
    t,
    nodeId,
    item: "1:1",
    key: "title",
    before: "a",
    after: "b",
  });
  const insert = (t: number, nodeId = "bX"): IntentEntry => ({
    kind: "insert",
    t,
    nodeId,
    parentId: "s1",
    parentItem: "1:1",
    index: 0,
    node: node(nodeId),
  });

  it("ages fields out after a week and inserts after two days", () => {
    const j = new IntentJournal();
    j.add([field(now - FIELD_TTL_MS - 1), field(now - 1000), insert(now - INSERT_TTL_MS - 1), insert(now - 1)], now);
    expect(j.entries.map((e) => e.kind)).toEqual(["field", "insert"]);
  });

  it("drops a deliberately deleted child's insert and nothing else", () => {
    const j = new IntentJournal();
    j.add([insert(now - 3, "bX"), insert(now - 2, "bY"), field(now - 1)]);
    j.dropInserts(new Set(["bX"]));
    expect(j.entries.map((e) => e.nodeId)).toEqual(["bY", "b1"]);
  });

  it("round-trips through its storage and refuses garbage", () => {
    let held: string | null = null;
    const storage = { read: () => held, write: (v: string | null) => (held = v) };
    const a = new IntentJournal(storage);
    a.add([field(now - 2), insert(now - 1)]);
    expect(held).not.toBeNull();
    const b = new IntentJournal(storage);
    expect(b.entries).toEqual(a.entries);
    held = JSON.stringify([{ kind: "field" }, 42, { kind: "insert", t: 1, nodeId: "x" }]);
    expect(new IntentJournal(storage).entries).toEqual([]);
    a.clear();
    expect(held).toBeNull();
  });

  it("sheds the OLDEST entries when it outgrows its byte budget", () => {
    const j = new IntentJournal();
    const big = (t: number): IntentEntry => ({
      ...(field(t) as FieldEntry),
      after: "x".repeat(MAX_BYTES / 4),
    });
    j.add([1, 2, 3, 4, 5, 6].map((i) => big(now - 10 + i)));
    expect(JSON.stringify(j.entries).length).toBeLessThanOrEqual(MAX_BYTES);
    expect(j.entries[0].t).toBeGreaterThan(now - 9);
    expect(j.entries[j.entries.length - 1].t).toBe(now - 4);
  });
});
