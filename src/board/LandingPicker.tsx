import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronLeft, Plus, X } from "lucide-react";
import { ops } from "../state/useBoard";
import { MAX_TIERS, MIN_TIERS, customTemplate } from "../state/landingTemplates";
import { BOARD_STYLES, type BoardStyle } from "../state/boardStyles";
import { TypeIcon } from "./typeIcons";
import { applyLook, LOOKS, matchesLook, useSettings } from "../state/settings";
import { PALETTES, paletteSwatches, paletteTierColor } from "../colors";
import { templatePicker } from "./TemplatePicker";
import { importEdlFile } from "./edlImport";

/* ------------------------------------------------------------------ *
 *  The landing screen (owner's spec, 2026-08-02) -- what you actually
 *  meet when you make a board.
 *
 *  TWO STEPS (owner's design, 2026-08-16). Row 1 is the STYLE -- which
 *  renderer the board gets. Row 2 is its STRUCTURE, and it appears only
 *  once a style is picked, because what it offers depends on which:
 *  a Beat Map is choosing a LADDER, a Columns board is choosing a SEED,
 *  and Free Grid has one shape and so gets no second row.
 *
 *  Row 1 stays on screen throughout rather than being replaced, so the
 *  first choice can be changed without backing out of anything -- and
 *  the two rows read as one sentence: a [Beat Map] shaped like
 *  [Reel -> Day -> Scene -> Beat].
 *
 *  Card colors and Look moved DOWN here with row 2, and the palette
 *  preview is sized to the ladder you actually picked. It used to show
 *  all six tiers whatever the board had, which advertised colors the
 *  board would never use.
 *
 *  The full shelf (the worked examples, the seven story rubrics) is
 *  still parked behind `m` from step 1 -- it isn't worth losing, but it
 *  is a lot to read on the way in.
 *
 *  Deliberately the SAME chrome as that shelf: tp-backdrop / tp-modal /
 *  tp-card / tp-ladder, and the Card colors + Look rows verbatim. This
 *  is the same decision at a different width, so it should not look
 *  like a different screen.
 * ------------------------------------------------------------------ */

const CUSTOM = "custom";

export function LandingPicker({
  firstRun,
  onCreated,
}: {
  firstRun: boolean;
  onCreated?: (boardId: string) => void;
}) {
  const [styleId, setStyleId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [paletteId, setPaletteId] = useState(PALETTES[0].id);
  /* THE LOOK IS HELD, NOT APPLIED (owner-reported 2026-08-16: choosing
   * one here "changes the existing boards").
   *
   * `applyLook("")` writes the DEFAULTS layer, which is what every board
   * without its own tweaks reads -- so picking a look while creating one
   * board silently re-dressed all the others. It used to be applied live
   * so the board behind the modal previewed it, which was previewing on
   * the wrong board anyway: the one you are looking at, not the one you
   * are making.
   *
   * So it is a per-board tweak on the NEW board, applied after creation
   * -- exactly what the Card colors row above it already does. */
  const [lookId, setLookId] = useState<string | null>(null);
  /* The custom ladder, top-down, once the builder has been through. Null
   * until then -- which is what the Custom card shows helper text for. */
  const [custom, setCustom] = useState<string[] | null>(null);
  const [building, setBuilding] = useState(false);
  const settings = useSettings();
  const edlRef = useRef<HTMLInputElement>(null);

  /* `m` opens the full shelf. Guarded against typing because this screen
   * HAS text fields (the custom builder), and a tier called "Mark" must
   * not swap the screen out from under the person naming it. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "m" && e.key !== "M") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      templatePicker.setMode("full");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // manual mode is dismissable; first run has no board to fall back to
  useEffect(() => {
    if (firstRun || building) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && templatePicker.close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [firstRun, building]);

  /* The full shelf renders separately, so hand it our landing spot --
   * but only if nobody has already named one (see offerRoute). A
   * "New board..." from a pane's Boards menu HAS, and it names that
   * pane. */
  useEffect(() => templatePicker.offerRoute(onCreated), [onCreated]);

  const style: BoardStyle | null = BOARD_STYLES.find((b) => b.id === styleId) ?? null;
  /* WHAT STEP 2 DRAWS, which LAGS the choice on the way out. The block is
   * always mounted -- that is what lets it transition in both directions
   * -- so on Back it has to keep rendering the style it is collapsing
   * away from, or the content would vanish a frame before the box does. */
  const [shownId, setShownId] = useState<string | null>(null);
  useEffect(() => {
    if (styleId) setShownId(styleId);
  }, [styleId]);
  const shown: BoardStyle | null = BOARD_STYLES.find((b) => b.id === shownId) ?? null;
  const template =
    selected === CUSTOM && custom
      ? customTemplate(custom)
      : (style?.structures.find((t) => t.id === selected) ?? null);
  // the ladder the palette preview should show -- only as many rungs as
  // the board will actually have
  const rungs = template?.levels.length ?? 0;

  const create = () => {
    if (!template) return;
    const id = ops.addBoardFromTemplate(template);
    // starting colorway: Pastel IS the seeded default, so only a
    // different pick needs writes
    const palette = PALETTES.find((p) => p.id === paletteId);
    if (id && palette && palette.id !== PALETTES[0].id) {
      for (const l of template.levels) {
        ops.setTierColor(id, l.id, paletteTierColor(palette, template.levels, l.id));
      }
    }
    // ...and this panel's own look, as a tweak on the new board alone
    const look = LOOKS.find((l) => l.id === lookId);
    if (id && look) applyLook(id, look);
    /* The ROUTE first, our own prop second -- the same order the full
     * shelf uses, so a board lands in the pane you asked from whichever
     * of the two you created it in. */
    (templatePicker.route() ?? onCreated)?.(id);
    templatePicker.close();
  };

  const ladder = (names: string[]) => (
    <div className="tp-ladder">
      {names.map((name, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="tp-arrow">→</span>}
          <span className="tp-rung">{name}</span>
        </Fragment>
      ))}
    </div>
  );

  return (
    <div className="tp-backdrop" onClick={firstRun ? undefined : () => templatePicker.close()}>
      <div className="tp-modal tp-modal-landing" onClick={(e) => e.stopPropagation()}>
        <div className="tp-head">
          <div>
            <div className="tp-title">Create New Corkboard</div>
            <div className="tp-sub tp-sub-step">
              {/* Back to step 1. Only at step 2, where there IS a step to
                  go back to -- and it reverses the same transition rather
                  than cutting. */}
              {style && (
                <button
                  className="tp-back tip-right"
                  aria-label="Back to step 1"
                  data-tip="Back to step 1"
                  onClick={() => setStyleId(null)}
                >
                  <ChevronLeft size={15} />
                </button>
              )}
              <span>
                {style ? `Step 2: ${style.step2}` : "Step 1: Choose one of the templates below."}
              </span>
            </div>
          </div>
          {!firstRun && (
            <button className="tp-close tip-left" aria-label="Cancel" data-tip="Cancel" onClick={() => templatePicker.close()}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* ROW 1 -- the STYLE. Stays visible after picking, so the choice
            can be changed without backing out. Each carries its symbol,
            which is meant to travel to the Boards menu and to a
            nested-board card later (board/typeIcons.tsx). */}
        <div className={"tp-grid tp-grid-styles" + (style ? " tp-styles-compact" : "")}>
          {BOARD_STYLES.map((b) => (
            <button
              key={b.id}
              className={
                "tp-card tp-card-style" +
                (b.id === styleId ? " selected" : "") +
                (b.ready ? "" : " tp-card-soon")
              }
              disabled={!b.ready}
              data-tip={b.ready ? undefined : "Not built yet"}
              onClick={() => {
                setStyleId(b.id);
                /* a style change invalidates the structure under it --
                   the ids are per style and a stale one would leave Create
                   enabled with nothing chosen */
                setSelected(null);
              }}
            >
              <span className="tp-card-icon">
                <TypeIcon id={b.id} size={30} />
              </span>
              <span className="tp-card-body">
                <span className="tp-card-name">{b.name}</span>
                {/* Kept MOUNTED and collapsed by CSS rather than removed:
                    an unmount is instant, and the point here is that the
                    card TRANSFORMS from pitch to selector. */}
                <span className="tp-card-descwrap">
                  <span className="tp-card-desc">{b.blurb}</span>
                </span>
              </span>
            </button>
          ))}
        </div>

        {/* ROW 2 -- the STRUCTURE, which means a different thing per
            style: a LADDER for a Beat Map, a SEED for Columns. A style
            with one shape offers nothing and this row stays away. */}
        {/* ALWAYS MOUNTED, opened by a class. A transition needs a
            previously-painted state at BOTH ends -- mounting it on demand
            could animate in but never out, which is what a Back button
            makes visible. */}
        <div className={"tp-step2-wrap" + (style ? " open" : "")}>
          <div className="tp-step2">
            <div className="tp-grid">
              {(shown?.structures ?? []).map((t) => (
                <button
                  key={t.id}
                  className={"tp-card" + (t.id === selected ? " selected" : "")}
                  onClick={() => setSelected(t.id)}
                >
                  <div className="tp-card-name">{t.name}</div>
                  <div className="tp-card-desc">{t.description}</div>
                  {ladder(t.levels.map((l) => l.name))}
                </button>
              ))}
              {/* Custom: the helper text STAYS once a ladder exists
                  (owner's call) -- it's the only card whose line is an
                  instruction rather than a description, and it has to keep
                  saying what clicking it does. */}
              {shown?.custom && (
                <button
                  className={"tp-card tp-card-custom" + (selected === CUSTOM ? " selected" : "")}
                  onClick={() => setBuilding(true)}
                >
                  <div className="tp-card-name">Custom...</div>
                  <div className="tp-card-desc">Define your own structure.</div>
                  {custom && ladder(custom)}
                </button>
              )}
              {/* IMPORT EDL, last (owner, 2026-09-02): an edit list is a
                  way of starting a board, so it stands with the other
                  ways rather than in the Boards menu. Like Custom, its
                  line is what clicking it does; the ladder shows what
                  comes out. The file dialog opens at once, and the
                  import's own dialog (rate, stills) takes over from
                  there -- no Create button step, since the file IS the
                  choice. */}
              {shown?.edl && (
                <button className="tp-card tp-card-custom" onClick={() => edlRef.current?.click()}>
                  <div className="tp-card-name">Import EDL...</div>
                  <div className="tp-card-desc">A shot board from a CMX3600 edit list.</div>
                  {ladder(["Scene", "Shot"])}
                  <input
                    ref={edlRef}
                    type="file"
                    accept=".edl,text/plain"
                    hidden
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      void importEdlFile(file, (id) => {
                        // the route, for the reason `create` states
                        (templatePicker.route() ?? onCreated)?.(id);
                        templatePicker.close();
                      });
                    }}
                  />
                </button>
              )}
            </div>

            {/* Card colors ride with row 2 (owner, 2026-08-16), and the
            preview shows only as many tiers as the chosen ladder HAS --
            it used to show all six whatever the board was, advertising
            colors the board would never use. */}
        {template && (
          <div className="tp-extras">
            <span className="tp-extras-label mono">Card colors</span>
            <div className="palette-row">
              {PALETTES.map((p) => (
                <button
                  key={p.id}
                  className={"palette-btn" + (p.id === paletteId ? " active" : "")}
                  aria-label={`Start with the ${p.label} palette`}
                  data-tip={`Start with the ${p.label} palette`}
                  onClick={() => setPaletteId(p.id)}
                >
                  <span className="palette-swatches">
                    {paletteSwatches(p)
                      .slice(0, rungs)
                      .map((c, i) => (
                        <span key={i} className="palette-swatch" style={{ background: c }} />
                      ))}
                  </span>
                  <span className="palette-name">{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

            {/* look presets (YOUR view settings, not board data) --
                applied immediately so the board behind previews it */}
            {template && (
              <div className="tp-extras">
                <span className="tp-extras-label mono">Board Appearance</span>
                <div className="look-choices">
                  {LOOKS.map((l) => (
                    <button
                      key={l.id}
                      /* before a pick, show whichever preset your saved
                         defaults already match -- so it opens on the look
                         you are used to rather than on nothing */
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
            )}
          </div>
        </div>

        {/* NO hint for `m`, and no tooltip either (owner's call): the
            full shelf is deliberately unadvertised for now -- the story
            rubrics and worked examples aren't baked enough to put in
            front of anyone. The key still works; it just isn't offered. */}
        <div className="tp-actions">
          {!firstRun && (
            <button className="tp-btn" onClick={() => templatePicker.close()}>
              Cancel
            </button>
          )}
          <button
            className="tp-btn primary tip-left"
            disabled={!template}
            data-tip={template ? undefined : "Pick a board style, then a structure"}
            onClick={create}
          >
            Create board
          </button>
        </div>
      </div>

      {building && (
        <TierBuilder
          initial={custom}
          onCancel={() => setBuilding(false)}
          onDone={(names) => {
            setCustom(names);
            setSelected(CUSTOM);
            setBuilding(false);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  "Custom..." -- name the rungs, bottom up.
 *
 *  It OPENS at the two-tier minimum rather than gating on it (owner's
 *  call): a form whose confirm starts grayed out starts by telling you
 *  no, and the floor is real -- see MIN_TIERS. "Add parent tier..." puts
 *  a fresh prompt ABOVE the stack each time, committing what you typed
 *  to a row of its own that stays editable, the metadata panel's
 *  add-a-row idiom.
 *
 *  Rows are labelled T1 upward from the base, matching how the owner
 *  numbers tiers and what the Board structure menu shows -- and the two
 *  that always exist say what they're FOR, with an example from either
 *  end of the range (a cut, and a footage catalog). The rest just say
 *  "Tier name": by then the pattern has been made.
 * ------------------------------------------------------------------ */

/* by TIER NUMBER, not by row position: T2 is the parent however tall the
 * ladder gets. The examples run out at T3 -- by the third rung the
 * pattern has been made, and the rest only need naming. */
function tierPlaceholder(tier: number): string {
  if (tier === 1) return "Base tier (e.g. Beat/Camera Filename)";
  if (tier === 2) return "Parent (e.g. Scene/Camera Card name)";
  if (tier === 3) return "Additional parent (e.g. Act, Shoot Day)";
  return "Additional parent...";
}
function TierBuilder({
  initial,
  onCancel,
  onDone,
}: {
  initial: string[] | null;
  onCancel: () => void;
  onDone: (names: string[]) => void;
}) {
  const [names, setNames] = useState<string[]>(initial ?? Array(MIN_TIERS).fill(""));
  const topRef = useRef<HTMLInputElement>(null);
  const focusTop = useRef(false);

  useEffect(() => {
    if (focusTop.current) {
      topRef.current?.focus();
      focusTop.current = false;
    }
  }, [names]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const set = (i: number, v: string) => setNames((n) => n.map((x, j) => (j === i ? v : x)));
  const addParent = () => {
    if (names.length >= MAX_TIERS) return;
    focusTop.current = true;
    setNames((n) => ["", ...n]);
  };
  const remove = (i: number) => setNames((n) => n.filter((_, j) => j !== i));

  const ready = names.every((n) => n.trim().length > 0) && names.length >= MIN_TIERS;

  return (
    <div className="tb-wrap" onClick={(e) => e.stopPropagation()}>
      <div className="tb-modal">
        <div className="tp-title">Define your own structure</div>
        <div className="tp-sub">
          Name your own tiers (minimum ={MIN_TIERS}, maximum ={MAX_TIERS})
        </div>
        <div className="tb-rows">
          {names.map((name, i) => {
            const tier = names.length - i; // T1 is the base, at the bottom
            return (
              <div className="tb-row" key={tier}>
                <span className="tb-tier mono">T{tier}</span>
                <input
                  ref={i === 0 ? topRef : undefined}
                  className="tb-input"
                  value={name}
                  placeholder={tierPlaceholder(tier)}
                  onChange={(e) => set(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && ready) onDone(names.map((n) => n.trim()));
                  }}
                  autoFocus={tier === 1 && !initial}
                />
                <button
                  className="tb-x"
                  aria-label="Remove this tier" data-tip="Remove this tier"
                  disabled={names.length <= MIN_TIERS}
                  onClick={() => remove(i)}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="tb-actions">
          <button
            className="tp-btn"
            onClick={addParent}
            disabled={names.length >= MAX_TIERS}
            data-tip={names.length >= MAX_TIERS ? `${MAX_TIERS} tiers is the most` : undefined}
          >
            <Plus size={13} /> Add parent tier...
          </button>
          <span className="tb-spacer" />
          <button className="tp-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="tp-btn primary"
            disabled={!ready}
            data-tip={ready ? undefined : "Every tier needs a name"}
            onClick={() => onDone(names.map((n) => n.trim()))}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
