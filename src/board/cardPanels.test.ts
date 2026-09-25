import { describe, expect, it, beforeEach } from "vitest";
import { imagePanel, metaPanel, notePanel, textPanel } from "./cardPanels";

const all = [notePanel, metaPanel, imagePanel, textPanel];
const openOn = [notePanel, metaPanel, imagePanel, textPanel].map((p) => p);

/* ONE CARD AT A TIME (owner-reported 2026-09-10): opening a door on
 * another card closes what was standing on the last one, so closing the
 * panel in front can never uncover a different card's behind it. */
describe("the per-card panels", () => {
  beforeEach(() => all.forEach((p) => p.close()));

  it("opening the same door on another card leaves only the new one", () => {
    metaPanel.open("card-a", "b1", 1, 10, 10);
    metaPanel.open("card-b", "b1", 1, 20, 20);
    expect(metaPanel.get()?.nodeId).toBe("card-b");
  });

  /* The reported shape: a second card's door opened over the first, and
   * closing it revealed the first still standing. */
  it("another card's door closes the first card's, so nothing is uncovered", () => {
    metaPanel.open("card-a", "b1", 1, 10, 10);
    notePanel.open("card-b", "b1", 1, 20, 20);
    expect(metaPanel.get()).toBe(null);
    notePanel.close();
    expect(all.every((p) => p.get() === null)).toBe(true);
  });

  /* ...and the thing that must SURVIVE it: the note and the metadata of
   * ONE card are the pair those separate doors exist for. */
  it("the same card's doors still stand together", () => {
    notePanel.open("card-a", "b1", 1, 10, 10);
    metaPanel.open("card-a", "b1", 1, 20, 20);
    expect(notePanel.get()?.nodeId).toBe("card-a");
    expect(metaPanel.get()?.nodeId).toBe("card-a");
  });

  it("holds for every door, not just the two named ones", () => {
    for (const first of openOn) {
      all.forEach((p) => p.close());
      first.open("card-a", "b1", 1, 0, 0);
      imagePanel.open("card-z", "b1", 1, 0, 0);
      const standing = all.filter((p) => p.get() !== null);
      expect(standing.every((p) => p.get()?.nodeId === "card-z")).toBe(true);
    }
  });

  /* A SUBJECT OF MANY (2026-09-12, his "mixed panel"): the metadata and
   * text doors open on the selection when the card they were opened
   * from is part of one. The one-card rule becomes one-SUBJECT: a door
   * on a card inside the set stands, one outside it shuts. */
  it("opens on a set, and a door on a card inside the set stands", () => {
    notePanel.open("card-b", "b1", 1, 10, 10);
    metaPanel.open("card-a", "b1", 1, 20, 20, { ids: ["card-a", "card-b", "card-c"] });
    expect(metaPanel.get()?.ids).toEqual(["card-a", "card-b", "card-c"]);
    expect(metaPanel.get()?.nodeId).toBe("card-a");
    expect(notePanel.get()?.nodeId).toBe("card-b");
  });

  it("a door on a card outside the set shuts", () => {
    notePanel.open("card-z", "b1", 1, 10, 10);
    metaPanel.open("card-a", "b1", 1, 20, 20, { ids: ["card-a", "card-b"] });
    expect(notePanel.get()).toBe(null);
  });

  it("a single open still reads as a subject of one", () => {
    metaPanel.open("card-a", "b1", 1, 10, 10);
    expect(metaPanel.get()?.ids).toEqual(["card-a"]);
    metaPanel.open("", "b1", 0, 10, 10);
    expect(metaPanel.get()?.ids).toEqual([]);
  });

  /* A FOLLOW NEVER CLOSES ANOTHER CARD'S DOOR (2026-09-12): the pinned
   * panel re-opening on the card you just selected -- by click, arrow,
   * chevron or a frame capture -- used to shut a note you were typing
   * into on another card. Only a deliberate open does that. */
  it("a follow leaves another card's door standing", () => {
    notePanel.open("card-a", "b1", 1, 10, 10);
    metaPanel.open("card-b", "b1", 1, 20, 20, { follow: true });
    expect(notePanel.get()?.nodeId).toBe("card-a");
    expect(metaPanel.get()?.nodeId).toBe("card-b");
    metaPanel.open("card-c", "b1", 1, 20, 20);
    expect(notePanel.get()).toBe(null);
  });

  it("moving a panel does not disturb its own card's other doors", () => {
    notePanel.open("card-a", "b1", 1, 10, 10);
    metaPanel.open("card-a", "b1", 1, 20, 20);
    metaPanel.moveTo(99, 99);
    expect(notePanel.get()?.nodeId).toBe("card-a");
    expect(metaPanel.get()).toMatchObject({ x: 99, y: 99 });
  });
});
