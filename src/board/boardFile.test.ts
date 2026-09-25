import { describe, expect, it } from "vitest";
import { boardFilePayload } from "./BoardsMenu";
import { sanitizeBoard } from "../state/validate";
import { board4 } from "../test/fixtures";
import type { FieldDef, TagDef } from "../state/types";

/* ------------------------------------------------------------------ *
 *  What a board FILE has to carry (ADR 0002).
 *
 *  A board leaving this project takes the definitions its cards reference
 *  with it -- otherwise it lands in another project with tag ids and value
 *  keys that resolve to nothing, and the repair pass strips them on
 *  arrival: the marks and the values are simply gone, silently.
 *
 *  Only the ones actually USED, though. A project's whole vocabulary in
 *  every board file would import categories the file never mentions.
 * ------------------------------------------------------------------ */

const tag = (id: string, name: string): TagDef => ({
  id,
  name,
  color: "#e5484d",
  pos: 0,
  reach: 12,
  span: 26,
  offset: 0,
  shape: "flat",
  visible: true,
});

const fields: FieldDef[] = [
  { id: "fld-day", name: "Shoot day" },
  { id: "fld-tc", name: "TC in" },
  { id: "fld-unused", name: "Never filled in" },
];
const tags = [tag("tag-alice", "Alice"), tag("tag-unused", "Nobody")];

function boardWithMetadata() {
  const b = board4();
  const s1 = b.roots[0].children[0].children[0];
  s1.children[0].values = { "fld-day": "DAY 06" }; // a beat
  s1.children[1].tags = ["tag-alice"];
  s1.values = { "fld-tc": "01:00:00:00" }; // ...and a scene, not just leaves
  return b;
}

describe("boardFilePayload", () => {
  it("carries the tag + category definitions its cards reference", () => {
    const file = boardFilePayload(boardWithMetadata(), tags, fields);
    expect(file.tags?.map((t) => t.id)).toEqual(["tag-alice"]);
    expect(file.fields?.map((f) => f.id)).toEqual(["fld-day", "fld-tc"]);
  });

  it("carries a category referenced only by a display SLOT", () => {
    // A placed-but-unfilled category is still a reference: the card is laid
    // out for it (collectVocab counts it for the same reason). The payload
    // used to walk tags + values itself and missed this, so a layout-only
    // placement exported without its definition -- and the receiving
    // project's repair pass deleted the placement on arrival.
    const b = board4();
    b.roots[0].children[0].children[0].children[0].slots = { tl: "fld-day" };
    const file = boardFilePayload(b, tags, fields);
    expect(file.fields?.map((f) => f.id)).toEqual(["fld-day"]);

    // and the slot itself survives the file round trip
    const back = sanitizeBoard(JSON.parse(JSON.stringify(file)))!;
    expect(back.roots[0].children[0].children[0].children[0].slots).toEqual({ tl: "fld-day" });
  });

  it("carries nothing when the board references nothing", () => {
    const file = boardFilePayload(board4(), tags, fields);
    expect(file.tags).toEqual([]);
    expect(file.fields).toEqual([]);
  });

  it("round-trips through the sanitizer with its values intact", () => {
    // the path a real file takes: JSON out, untrusted JSON back in
    const file = boardFilePayload(boardWithMetadata(), tags, fields);
    const back = sanitizeBoard(JSON.parse(JSON.stringify(file)))!;
    expect(back.fields?.map((f) => f.name)).toEqual(["Shoot day", "TC in"]);
    const scene = back.roots[0].children[0].children[0];
    expect(scene.values).toEqual({ "fld-tc": "01:00:00:00" });
    expect(scene.children[0].values).toEqual({ "fld-day": "DAY 06" });
    expect(scene.children[1].tags).toEqual(["tag-alice"]);
  });
});
