import { describe, expect, it } from "vitest";
import { MAX_TIERS, sanitizeBoard, sanitizeProject } from "./validate";

describe("sanitizeBoard", () => {
  it("rejects values that are not boards at all", () => {
    expect(sanitizeBoard(null)).toBeNull();
    expect(sanitizeBoard("board")).toBeNull();
    expect(sanitizeBoard({ foo: 1 })).toBeNull();
    expect(sanitizeBoard({ levels: [], roots: [] })).toBeNull(); // no usable ladder
    expect(sanitizeBoard({ levels: [null, 7], roots: [] })).toBeNull();
  });

  it("coerces a messy but recognizable file into a well-formed board", () => {
    const b = sanitizeBoard({
      title: 42,
      levels: [
        { id: "a", name: "Top", variant: "bogus", fields: null, height: 99999, aspect: -3, bandHeight: 9999 },
        { id: "b", name: "Leaf", fields: { color: true } },
        { id: "a", name: "duplicate ladder entry" },
      ],
      roots: [
        {
          id: "n1",
          title: "ok",
          children: [
            { id: "n2", title: 7, children: [{ id: "n3", title: "below the leaf tier" }] },
            { id: "n2", title: "duplicate id" },
            "not a node",
          ],
        },
        { id: "n4" }, // no children key at all
      ],
      legend: [{ id: "x", label: "L", bg: "javascript:alert(1)" }, null],
      maxRowBeats: 99,
      cardSpacing: 1,
    })!;

    expect(b.title).toBe("Untitled board"); // non-string title dropped
    expect(b.levels.map((l) => l.id)).toEqual(["a", "b"]); // dup ladder entry dropped
    expect(b.levels[0].variant).toBe("scene"); // unknown variant coerced
    expect(b.levels[0].height).toBe(400); // clamped to the UI range
    expect(b.levels[0].aspect).toBe(0.2);
    expect(b.levels[0].bandHeight).toBe(200); // band height clamped too

    expect(b.roots.map((r) => r.id)).toEqual(["n1", "n4"]);
    const kids = b.roots[0].children;
    expect(kids).toHaveLength(2); // junk entry dropped
    expect(kids[0].id).toBe("n2");
    expect(kids[0].title).toBe(""); // non-string title dropped
    // below-leaf children are KEPT now (2026-08-02): they're stowed
    // content (a demoted lane's beats), and a file must not lose a stow
    expect(kids[0].children.map((c) => c.id)).toEqual(["n3"]); // below-leaf node kept (stowed)
    expect(kids[1].id).not.toBe("n2"); // colliding id regenerated

    expect(b.legend[0].bg).toBe("#fcecad"); // non-hex color replaced
    expect(b.maxRowBeats).toBe(10); // clamped to the UI ranges
    expect(b.cardSpacing).toBe(8);
  });

  it("caps the ladder at MAX_TIERS", () => {
    const levels = Array.from({ length: 9 }, (_, i) => ({ id: "l" + i, name: "L" + i }));
    const b = sanitizeBoard({ levels, roots: [] })!;
    expect(b.levels).toHaveLength(MAX_TIERS);
  });

  it("drops tier-bound legend entries pointing at levels the file lacks", () => {
    const b = sanitizeBoard({
      levels: [{ id: "scene" }, { id: "beat" }],
      roots: [],
      legend: [
        { id: "tier:scene", label: "Scene", bg: "#e7c8f7", tier: "scene" },
        { id: "tier:ghost", label: "Ghost", bg: "#ffffff", tier: "no-such-level" },
        { id: "blue", label: "B-roll", bg: "#cfe3f4" },
      ],
    })!;
    expect(b.legend.map((e) => e.id)).toEqual(["tier:scene", "blue"]);
  });

  it("keeps a valid board unchanged in the ways that matter", () => {
    const clean = {
      title: "My cut",
      levels: [
        { id: "scene", name: "Scene", variant: "scene", fields: { subtitle: false, tag: false, color: false, notes: true } },
        { id: "beat", name: "Beat", variant: "scene", fields: { subtitle: false, tag: false, color: true, notes: true }, textSize: 15 },
      ],
      legend: [{ id: "yellow", label: "Beat", bg: "#fcecad", border: "#efd98a" }],
      roots: [
        { id: "s1", title: "Opening", collapsed: false, children: [{ id: "b1", title: "Aerial", collapsed: false, color: "yellow", children: [] }] },
      ],
    };
    const b = sanitizeBoard(clean)!;
    expect(b.title).toBe("My cut");
    expect(b.levels[1].textSize).toBe(15);
    expect(b.roots[0].children[0].color).toBe("yellow");
    expect(b.legend).toHaveLength(1);
  });

  /* A card's metadata values arrive as untrusted key/value junk. Keys are
   * taken on trust (they're reconciled at import, where the file's own
   * categories get merged), but a blank or non-string value must never enter
   * the doc -- it's indistinguishable from an unfilled category, so it would
   * be permanent invisible weight. */
  it("keeps well-formed card values and drops the junk", () => {
    const b = sanitizeBoard({
      levels: [{ id: "beat", name: "Beat", variant: "scene", fields: {} }],
      roots: [
        {
          id: "b1",
          title: "One",
          values: { "fld-day": "DAY 06", "fld-blank": "", "fld-num": 7, "": "no key" },
          children: [],
        },
        { id: "b2", title: "Two", values: "not an object", children: [] },
        { id: "b3", title: "Three", values: {}, children: [] },
      ],
    })!;
    expect(b.roots[0].values).toEqual({ "fld-day": "DAY 06" });
    expect(b.roots[1].values).toBeUndefined();
    expect(b.roots[2].values).toBeUndefined();
  });

  it("normalizes notes, and reads a pre-notes-system string as one note", () => {
    const b = sanitizeBoard({
      levels: [{ id: "beat", name: "Beat", variant: "scene", fields: {} }],
      roots: [
        {
          id: "b1",
          title: "One",
          notes: [
            { id: "nt1", body: "Real note", author: "Derek", state: "resolved", createdAt: 5 },
            { id: "nt2", body: "", author: "Sam" }, // no body: not a note
            { body: "No id is fine", state: "nonsense" },
            "junk",
          ],
          children: [],
        },
        { id: "b2", title: "Two", notes: "an old single note", children: [] },
        { id: "b3", title: "Three", notes: "", children: [] },
        { id: "b4", title: "Four", notes: { not: "a list" }, children: [] },
      ],
    })!;
    const [one, two, three, four] = b.roots;
    expect(one.notes!.map((n) => n.body)).toEqual(["Real note", "No id is fine"]);
    // the old second state reads as "done" (state/noteStates.ts)
    expect(one.notes![0]).toMatchObject({ author: "Derek", state: "done", createdAt: 5 });
    expect(one.notes![1].state).toBe("open"); // an unknown state is open
    // the same derived id the doc migration mints, so a file and a doc agree
    expect(two.notes).toEqual([
      { id: "nt-b2-0", body: "an old single note", author: "", state: "open", createdAt: 0 },
    ]);
    expect(three.notes).toBeUndefined();
    expect(four.notes).toBeUndefined();
  });

  it("keeps the implementation note's author and time only with the words, and never on a reply", () => {
    const b = sanitizeBoard({
      levels: [{ id: "beat", name: "Beat", variant: "scene", fields: {} }],
      roots: [
        {
          id: "n1",
          title: "A",
          children: [],
          notes: [
            { id: "nt1", body: "Q", impl: "Done it", implBy: "Quinn", implAt: 5, replies: [{ id: "nt2", body: "R", impl: "no", implBy: "X", implAt: 1 }] },
            { id: "nt3", body: "Q2", implBy: "Ghost", implAt: 9 },
          ],
        },
      ],
    })!;
    const [a, c] = b.roots[0].notes!;
    expect(a).toMatchObject({ impl: "Done it", implBy: "Quinn", implAt: 5 });
    expect(a.replies![0].impl).toBeUndefined();
    expect(a.replies![0].implBy).toBeUndefined();
    expect(c.implBy).toBeUndefined();
    expect(c.implAt).toBeUndefined();
  });

  it("keeps replies one level deep", () => {
    const b = sanitizeBoard({
      levels: [{ id: "beat", name: "Beat", variant: "scene", fields: {} }],
      roots: [
        {
          id: "b1",
          title: "One",
          notes: [
            {
              id: "nt1",
              body: "Question",
              replies: [{ id: "nt2", body: "Answer", replies: [{ id: "nt3", body: "Too deep" }] }],
            },
          ],
          children: [],
        },
      ],
    })!;
    const note = b.roots[0].notes![0];
    expect(note.replies!.map((r) => r.body)).toEqual(["Answer"]);
    expect(note.replies![0].replies).toBeUndefined();
  });

  it("keeps the file's category definitions, dropping malformed ones", () => {
    const b = sanitizeBoard({
      levels: [{ id: "beat", name: "Beat", variant: "scene", fields: {} }],
      roots: [],
      fields: [
        { id: "fld-day", name: "Shoot day" },
        { id: "fld-day", name: "Duplicate id" },
        { id: "fld-num", name: 7 },
        { name: "no id" },
        "junk",
      ],
    })!;
    expect(b.fields).toEqual([
      { id: "fld-day", name: "Shoot day" },
      { id: "fld-num", name: "" },
    ]);
  });
});

describe("sanitizeProject", () => {
  const board = (id: string, title: string) => ({
    id,
    title,
    levels: [
      { id: "scene", name: "Scene", variant: "scene", fields: {} },
      { id: "beat", name: "Beat", variant: "scene", fields: { color: true } },
    ],
    roots: [{ id: id + "-s1", title: "Opening", children: [] }],
  });

  it("rejects values that are not projects at all", () => {
    expect(sanitizeProject(null)).toBeNull();
    expect(sanitizeProject({ title: "no boards key" })).toBeNull();
    expect(sanitizeProject({ boards: [] })).toBeNull();
    expect(sanitizeProject({ boards: [{ nope: 1 }, "board"] })).toBeNull(); // none usable
  });

  it("keeps the usable boards and drops the rest", () => {
    const p = sanitizeProject({
      title: "Season 3",
      boards: [board("bd1", "Master"), { junk: true }, board("bd2", "Act one")],
    })!;
    expect(p.title).toBe("Season 3");
    expect(p.boards.map((b) => b.title)).toEqual(["Master", "Act one"]);
    expect(p.boards[0].roots[0].title).toBe("Opening");
  });

  it("defaults a missing/mistyped project title", () => {
    expect(sanitizeProject({ title: 7, boards: [board("bd1", "One")] })!.title).toBe("Untitled project");
  });

  it("normalizes the project's vocabularies, and never leaves them missing", () => {
    const p = sanitizeProject({
      title: "Season 3",
      boards: [board("bd1", "Master")],
      fields: [{ id: "fld-day", name: "Shoot day" }, { name: "no id" }],
    })!;
    expect(p.fields).toEqual([{ id: "fld-day", name: "Shoot day" }]);
    // absent in the file -> empty arrays, not undefined (the doc writers and
    // every consumer treat these as arrays)
    const bare = sanitizeProject({ boards: [board("bd1", "One")] })!;
    expect(bare.fields).toEqual([]);
    expect(bare.tags).toEqual([]);
  });
});
