import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { board4 } from "../test/fixtures";
import { KANBAN_LEVELS, KANBAN_TEMPLATE, kanbanBoard } from "./boardTypes";
import { sanitizeBoard } from "./validate";
import { boardFilePayload } from "../board/BoardsMenu";
import { addBoardRaw, doc, getSnapshot, ops, projectMap } from "./ydoc";
import { MIN_TIERS } from "./landingTemplates";

/* ------------------------------------------------------------------ *
 *  BOARD TYPES (2026-08-15).
 *
 *  What these pin is the property the whole design rests on: a type is a
 *  RENDERER, so the doc has to carry one optional word and nothing else.
 *  Two things follow, and both are tested here because both are how the
 *  feature stays safe in a room where ten people run different bundles:
 *
 *   - a cut board writes NO type at all, so nothing about the existing
 *     project changes shape;
 *   - a type this build does not know is DROPPED rather than kept, so a
 *     file from a newer build degrades to a stacked board instead of to
 *     a blank one.
 * ------------------------------------------------------------------ */

type YMap = Y.Map<unknown>;
type YArr = Y.Array<YMap>;

beforeEach(() => {
  doc.transact(() => {
    const boards = projectMap.get("boards");
    if (boards instanceof Y.Array) (boards as YArr).delete(0, (boards as YArr).length);
    projectMap.set("title", "Test project");
    const tags = projectMap.get("tags");
    if (tags instanceof Y.Array) (tags as YArr).delete(0, (tags as YArr).length);
    const fields = projectMap.get("fields");
    if (fields instanceof Y.Array) (fields as YArr).delete(0, (fields as YArr).length);
  }, "local");
});

describe("the kanban template", () => {
  it("is a two-rung ladder -- the roots ARE the columns", () => {
    expect(KANBAN_LEVELS).toHaveLength(2);
    expect(KANBAN_LEVELS).toHaveLength(MIN_TIERS); // the floor flatten needs
    expect(KANBAN_LEVELS.map((l) => l.name)).toEqual(["Column", "Card"]);
  });

  it("seeds several columns -- one would not read as the shape", () => {
    const b = kanbanBoard("K");
    expect(b.type).toBe("kanban");
    expect(b.roots.length).toBeGreaterThan(1);
    // something to drag on arrival, and empty columns to drag it into
    expect(b.roots[0].children.length).toBeGreaterThan(0);
    expect(b.roots[1].children).toHaveLength(0);
  });

  it("mints fresh ids per build, so two kanban boards never collide", () => {
    const a = kanbanBoard("A");
    const b = kanbanBoard("B");
    const ids = (x: typeof a) => [x.id, ...x.roots.flatMap((r) => [r.id, ...r.children.map((c) => c.id)])];
    expect(new Set([...ids(a), ...ids(b)]).size).toBe(ids(a).length + ids(b).length);
  });

  it("carries no cards from anything real (state/seed.ts's rule)", () => {
    const titles = kanbanBoard("K").roots.flatMap((r) => r.children.map((c) => c.title));
    for (const t of titles) expect(t).toMatch(/^Card \d+$/);
  });
});

describe("the type survives the doc", () => {
  it("round-trips through addBoardFromTemplate", () => {
    const id = ops.addBoardFromTemplate(KANBAN_TEMPLATE);
    const b = getSnapshot().boards.find((x) => x.id === id)!;
    expect(b.type).toBe("kanban");
    expect(b.levels).toHaveLength(2);
    expect(b.roots.length).toBeGreaterThan(1);
  });

  it("a CUT board writes no type at all -- absent is what keeps old builds correct", () => {
    const id = addBoardRaw(board4());
    const b = getSnapshot().boards.find((x) => x.id === id)!;
    expect(b.type).toBeUndefined();
    // and nothing is on the Y.Map either, not merely absent from the snapshot
    const boards = projectMap.get("boards") as YArr;
    const m = boards.toArray().find((x) => x.get("id") === id)!;
    expect(m.get("type")).toBeUndefined();
  });

  it("duplicateBoard keeps the type (a copy of a kanban board is a kanban board)", () => {
    const id = ops.addBoardFromTemplate(KANBAN_TEMPLATE);
    const copy = ops.duplicateBoard(id);
    expect(getSnapshot().boards.find((x) => x.id === copy)!.type).toBe("kanban");
  });

  it("a board FILE carries it, so an exported kanban board arrives as one", () => {
    const id = ops.addBoardFromTemplate(KANBAN_TEMPLATE);
    const src = getSnapshot().boards.find((x) => x.id === id)!;
    const file = boardFilePayload(src, [], []);
    const back = sanitizeBoard(JSON.parse(JSON.stringify(file)));
    expect(back?.type).toBe("kanban");
  });
});

describe("sanitizeBoard and the type", () => {
  const typeOf = (raw: unknown) => sanitizeBoard(raw)?.type;

  it("keeps the two it knows", () => {
    expect(typeOf({ ...board4(), type: "kanban" })).toBe("kanban");
    expect(typeOf({ ...board4(), type: "cut" })).toBe("cut");
  });

  it("leaves an absent type absent rather than filling it in", () => {
    expect(typeOf(board4())).toBeUndefined();
  });

  it("DROPS a type it has no renderer for, so the board still draws", () => {
    // a file written by a future build: degrade to the stacked renderer,
    // never to a blank pane
    expect(typeOf({ ...board4(), type: "pinboard" })).toBeUndefined();
    expect(typeOf({ ...board4(), type: 7 })).toBeUndefined();
    expect(typeOf({ ...board4(), type: { evil: true } })).toBeUndefined();
  });
});
