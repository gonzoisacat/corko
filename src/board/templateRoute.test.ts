import { describe, expect, it, beforeEach } from "vitest";
import { templatePicker } from "./TemplatePicker";

/* WHERE A NEW BOARD LANDS (owner-reported 2026-09-10: "New board..."
 * from the right pane's Boards menu opened it in the LEFT pane).
 *
 * The route is a module-level slot: a pane's Boards menu names itself
 * when it opens the picker, and the landing screen -- which is on screen
 * for every opening, not just the first run -- may only fill the slot
 * when it is empty. It used to overwrite, and App's landing route always
 * points at pane a, so every pane's "New board..." became pane a's. */
describe("the template picker's route", () => {
  beforeEach(() => templatePicker.close());

  it("is empty until somebody asks for somewhere", () => {
    expect(templatePicker.route()).toBe(null);
  });

  it("opening with a route keeps it", () => {
    const right = () => {};
    templatePicker.open(right);
    expect(templatePicker.route()).toBe(right);
  });

  /* THE BUG, stated as a test: the landing screen mounts a tick after
   * the menu opened the picker, and must not take the wheel. */
  it("a fallback offered afterwards does NOT displace it", () => {
    const right = () => {};
    const landing = () => {};
    templatePicker.open(right);
    templatePicker.offerRoute(landing);
    expect(templatePicker.route()).toBe(right);
  });

  /* ...while first run, where nobody went through open(), still gets
   * somewhere to put its board. */
  it("a fallback is taken when nobody named anywhere", () => {
    const landing = () => {};
    templatePicker.offerRoute(landing);
    expect(templatePicker.route()).toBe(landing);
  });

  it("closing forgets the route, so the next opening starts clean", () => {
    templatePicker.open(() => {});
    templatePicker.close();
    expect(templatePicker.route()).toBe(null);
  });

  /* Opening REPLACES rather than offering: the pane you asked from this
   * time is the pane you meant, whatever the last one was. */
  it("a second opening names its own pane", () => {
    const a = () => {};
    const b = () => {};
    templatePicker.open(a);
    templatePicker.close();
    templatePicker.open(b);
    expect(templatePicker.route()).toBe(b);
  });
});
