import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { ops } from "../state/useBoard";
import { TEMPLATES } from "../state/seed";
import { STORY_TEMPLATES } from "../state/storyTemplates";
import { applyLook, LOOKS, matchesLook, useSettings } from "../state/settings";
import { PALETTES, paletteSwatches, paletteTierColor } from "../colors";

/* ------------------------------------------------------------------ *
 *  Template picker (Board-structure v1). Shown at board CREATION only:
 *  - first run (the doc has no roots), where it cannot be dismissed, and
 *  - via "New board..." in the options menu, where it replaces the
 *    current board behind an explicit confirm (pre-Phase-4: one board).
 *
 *  Open state is a tiny module store (same pattern as board/cardMenu.ts)
 *  so any pane's Boards menu can open it while App renders it once. The
 *  opener passes what to do with the new board's id -- that's how the
 *  board lands in the PANE that asked for it (split view).
 * ------------------------------------------------------------------ */

/* Two screens behind one store (owner's call, 2026-08-02). The door is
 * the SIMPLE landing (board/LandingPicker.tsx): three shapes and
 * "Custom...". This full shelf -- every ladder, the worked examples, the
 * seven story rubrics -- is still here, parked one keypress away (`m`),
 * because it is a lot to meet on the way in but it isn't worth losing.
 * Both openers (first run, "New board...") start on the simple one. */
export type PickerMode = "simple" | "full";

let open = false;
let mode: PickerMode = "simple";
let pending: ((boardId: string) => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const templatePicker = {
  /* `onCreated` opens the new board wherever the caller wants it (the
   * pane whose Boards menu was used). */
  open(onCreated?: (boardId: string) => void) {
    open = true;
    mode = "simple";
    pending = onCreated ?? null;
    emit();
  },
  /* A FALLBACK ROUTE, and it only ever fills a GAP (2026-09-10). The
   * first-run picker is rendered by App directly, without going through
   * open(), so somebody has to say where its board lands -- but it is
   * ALSO on screen for every `open()` call, and while this overwrote
   * whatever was there, it clobbered the route the caller had set one
   * tick earlier. The cost was the bug the owner reported: "New
   * board..." from the RIGHT pane's Boards menu opened the board in the
   * LEFT pane, because App's landing route always points at pane a.
   *
   * `open()` sets a route and `close()` clears one, so an empty `pending`
   * means nobody asked for anywhere in particular, which is exactly when
   * a fallback should apply. */
  offerRoute(onCreated?: (boardId: string) => void) {
    if (!pending) pending = onCreated ?? null;
  },
  /* WHERE THE NEW BOARD GOES, for whoever is doing the creating. Both
   * pickers ask, so a board lands in the pane you asked from however you
   * got to the template. */
  route: (): ((boardId: string) => void) | null => pending,
  setMode(next: PickerMode) {
    if (mode === next) return;
    mode = next;
    emit();
  },
  close() {
    if (open) {
      open = false;
      mode = "simple";
      pending = null;
      emit();
    }
  },
  mode: (): PickerMode => mode,
  isOpen: (): boolean => open,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useTemplatePickerOpen(): boolean {
  return useSyncExternalStore(templatePicker.subscribe, templatePicker.isOpen, () => false);
}

const SIMPLE = () => "simple" as const;
export function useTemplatePickerMode(): PickerMode {
  return useSyncExternalStore(templatePicker.subscribe, templatePicker.mode, SIMPLE);
}

export function TemplatePicker({ onCreated }: { onCreated?: (boardId: string) => void }) {
  const [selected, setSelected] = useState(TEMPLATES[0].id);
  const [paletteId, setPaletteId] = useState(PALETTES[0].id);
  /* Held, not applied -- `applyLook("")` writes the DEFAULTS layer, which
   * every untweaked board reads, so choosing a look while creating ONE
   * board re-dressed all the others (owner-reported 2026-08-16). It
   * lands on the new board after creation, like the palette above it. */
  const [lookId, setLookId] = useState<string | null>(null);
  const settings = useSettings();

  /* This is a DRILL-DOWN of the landing screen now, so everything that
   * dismisses it -- Escape, the backdrop, the X, Cancel -- goes back
   * there rather than closing. That holds on first run too, where there
   * is no board to fall back to: the landing is always underneath. */
  const back = () => templatePicker.setMode("simple");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && back();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const template =
    TEMPLATES.find((t) => t.id === selected) ??
    STORY_TEMPLATES.find((t) => t.id === selected) ??
    TEMPLATES[0];

  const create = () => {
    // Phase 4: ADDS a board to the project (the pre-project picker
    // replaced the whole doc); existing boards are untouched.
    const id = ops.addBoardFromTemplate(template);
    // starting colorway: recolor the new board's tier defaults. Pastel IS
    // the seeded default, so only non-default picks need writes.
    const palette = PALETTES.find((p) => p.id === paletteId);
    if (id && palette && palette.id !== PALETTES[0].id) {
      for (const l of template.levels) {
        ops.setTierColor(id, l.id, paletteTierColor(palette, template.levels, l.id));
      }
    }
    const look = LOOKS.find((l) => l.id === lookId);
    if (id && look) applyLook(id, look);
    (pending ?? onCreated)?.(id);
    templatePicker.close();
  };

  return (
    <div className="tp-backdrop" onClick={back}>
      <div className="tp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tp-head">
          <div>
            <div className="tp-title">All templates</div>
            <div className="tp-sub">
              Every ladder, the worked examples and the story structures. You can rename
              tiers or add a parent level later.
            </div>
          </div>
          <button className="tp-close" aria-label="Back" data-tip="Back" onClick={back}>
            <X size={16} />
          </button>
        </div>

        <div className="tp-grid">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={"tp-card" + (t.id === selected ? " selected" : "")}
              onClick={() => setSelected(t.id)}
            >
              <div className="tp-card-name">{t.name}</div>
              <div className="tp-card-desc">{t.description}</div>
              <div className="tp-ladder">
                {t.levels.map((l, i) => (
                  <Fragment key={l.id}>
                    {i > 0 && <span className="tp-arrow">→</span>}
                    <span className="tp-rung">{l.name}</span>
                  </Fragment>
                ))}
              </div>
            </button>
          ))}
        </div>

        {/* The classic prose/screenplay rubrics as sparse scaffolds --
            named stages, empty scenes, no beats (state/storyTemplates.ts).
            A second group rather than more cards in the grid above: those
            answer "what SHAPE is my project", these answer "which STORY
            structure am I working in". Ladders are omitted per card --
            every one of these is Act -> Scene -> Beat give or take the
            top tier's name, so nine repeats would just be noise. */}
        <div className="tp-group mono">Story structures</div>
        <div className="tp-grid tp-grid-stories">
          {STORY_TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={"tp-card tp-card-story" + (t.id === selected ? " selected" : "")}
              onClick={() => setSelected(t.id)}
            >
              <div className="tp-card-name">{t.name}</div>
              <div className="tp-card-desc">{t.description}</div>
            </button>
          ))}
        </div>

        {/* starting colorway for the new board's tiers (shared board data) */}
        <div className="tp-extras">
          <span className="tp-extras-label mono">Card colors</span>
          <div className="palette-row">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                className={"palette-btn" + (p.id === paletteId ? " active" : "")}
                aria-label={`Start with the ${p.label} palette`} data-tip={`Start with the ${p.label} palette`}
                onClick={() => setPaletteId(p.id)}
              >
                <span className="palette-swatches">
                  {paletteSwatches(p).map((c, i) => (
                    <span key={i} className="palette-swatch" style={{ background: c }} />
                  ))}
                </span>
                <span className="palette-name">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* look presets (YOUR view settings, not board data) -- held and
            applied to the NEW board on create, never to your defaults */}
        <div className="tp-extras">
          <span className="tp-extras-label mono">Board Appearance</span>
          <div className="look-choices">
            {LOOKS.map((l) => (
              <button
                key={l.id}
                className={
                  "look-btn" +
                  ((lookId ? l.id === lookId : matchesLook(settings, l)) ? " active" : "")
                }
                onClick={() => setLookId(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="tp-actions">
          <button className="tp-btn" onClick={back}>
            Back
          </button>
          <button className="tp-btn primary" onClick={create}>
            Create board
          </button>
        </div>
      </div>
    </div>
  );
}
