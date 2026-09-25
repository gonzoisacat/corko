import { describe, expect, it } from "vitest";
import { sanitizeBoard } from "./validate";
import { STORY_TEMPLATES } from "./storyTemplates";
import type { Node } from "./types";

/* ------------------------------------------------------------------ *
 *  The story-structure scaffolds: sparse by contract. Every rubric maps
 *  onto a three-tier ladder, the named stages are scene lanes, and no
 *  template ships a single beat -- the structure is the scaffolding you
 *  fill, not somebody's finished movie.
 * ------------------------------------------------------------------ */

/* stage-lane count per rubric -- the number IS the structure */
const STAGE_COUNTS: Record<string, number> = {
  "story-three-act": 9,
  "story-hero": 12,
  "story-freytag": 10, // five stages x two unnamed scenes
  "story-circle": 8,
  "story-fichtean": 6,
  "story-15-beats": 15,
  "story-seven-point": 7,
};

describe("story templates", () => {
  it("covers exactly the rubrics the counts table names", () => {
    expect(STORY_TEMPLATES.map((t) => t.id).sort()).toEqual(Object.keys(STAGE_COUNTS).sort());
  });

  for (const t of STORY_TEMPLATES) {
    describe(t.name, () => {
      const board = t.build();

      it("builds a three-tier board that survives the sanitizer", () => {
        expect(board.levels).toHaveLength(3);
        const clean = sanitizeBoard(JSON.parse(JSON.stringify(board)));
        expect(clean).not.toBeNull();
        expect(clean!.roots.length).toBe(board.roots.length);
      });

      it("has the rubric's stage lanes, every one beat-free", () => {
        const scenes = board.roots.flatMap((a) => a.children);
        expect(scenes).toHaveLength(STAGE_COUNTS[t.id]);
        for (const s of scenes) expect(s.children).toHaveLength(0);
      });

      it("mints fresh unique ids per build", () => {
        const ids = (n: Node): string[] => [n.id, ...n.children.flatMap(ids)];
        const a = board.roots.flatMap(ids);
        expect(new Set(a).size).toBe(a.length); // unique within a build
        const b = t.build().roots.flatMap(ids);
        expect(a.some((id) => b.includes(id))).toBe(false); // fresh across builds
      });
    });
  }
});
