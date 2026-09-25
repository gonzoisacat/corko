import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { emptyHistory, push as pushHistory, redo as redoHistory, undo as undoHistory } from "./designHistory";
import { ChevronDown } from "lucide-react";
import type { MouseEvent as RMouseEvent, PointerEvent as RPointerEvent } from "react";
import { ops, useProject } from "../state/useBoard";
import { markLocal, useMarkLocal } from "../state/markLocal";
import {
  MARK_SIZES,
  cellKey,
  designPins,
  pinColor,
  resizeDesign,
  sameDesign,
  setPinColor,
  sizeOf,
  toggleCell,
} from "../state/mark";
import { ColorPicker } from "./ColorPicker";
import type { MarkDesign } from "../state/types";
import { CorkoMark, GRID, LOOKS, PIN_PALETTE } from "./CorkoMark";

/* CLEAR ALL / FILL ALL (owner, 2026-09-04): one button, two moods --
 * anything pinned clears; an empty board fills every cell with a pin in
 * a random palette color. */
const emptied = (d: MarkDesign): MarkDesign => ({ ...d, cells: d.cells.map((row) => ".".repeat(row.length)), pins: {} });
const filled = (d: MarkDesign): MarkDesign => {
  const pins: Record<string, string> = {};
  d.cells.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) pins[cellKey(x, y)] = PIN_PALETTE[Math.floor(Math.random() * PIN_PALETTE.length)];
  });
  return { ...d, cells: d.cells.map((row) => "#".repeat(row.length)), pins };
};
import { confirmDialog } from "./confirmDialog";
import { pinboardDesigner, usePinboardDesignerOpen } from "./designerDoor";

/* ------------------------------------------------------------------ *
 *  THE PINBOARD DESIGNER -- the hidden one (owner, 2026-09-04). Ten
 *  quick clicks on the mark open it. The mark, blown up to a 6x6 grid
 *  of cells: click a cell to pin it (or unpin it), right-click a pin
 *  for its color, right-click bare board for the board's. Then either
 *  ADD the arrangement to the fun pool (one more landing the click can
 *  pick) or make it THE logo (the override: every click plays a
 *  routine and lands back here). Same chrome as the New Board picker,
 *  blurred backdrop and all. The design is the project's (state/mark.ts).
 * ------------------------------------------------------------------ */


const theC = (): MarkDesign => ({ size: GRID.length, cells: [...GRID], board: LOOKS[0].board, pin: LOOKS[0].pin });

interface ColorMenu {
  x: number;
  y: number;
  target: { kind: "pin"; x: number; y: number } | { kind: "board" };
}

export function PinboardDesigner() {
  const open = usePinboardDesignerOpen();
  if (!open) return null;
  return <Designer />;
}

function Designer() {
  const project = useProject();
  const shared = project.mark;
  const local = useMarkLocal();
  const override = local.override ?? shared?.override;
  const [design, setDesign] = useState<MarkDesign>(() => override ?? theC());
  /* THE DESIGNER'S OWN UNDO (ui/designHistory.ts): every change to the
   * design goes through `edit`, which records the state before it. A
   * ref carries the current design so two edits in one handler see
   * each other, and so nothing is recorded inside a state updater --
   * StrictMode runs those twice. The history lives and dies with this
   * component: closing the designer discards it, and the board's own
   * stack underneath never sees a sketch. */
  const designRef = useRef(design);
  designRef.current = design;
  const history = useRef(emptyHistory<MarkDesign>());
  const edit = (next: MarkDesign | ((d: MarkDesign) => MarkDesign), key: string | null = null) => {
    const before = designRef.current;
    const after = typeof next === "function" ? next(before) : next;
    if (after === before) return;
    history.current = pushHistory(history.current, before, key, Date.now());
    designRef.current = after;
    setDesign(after);
  };
  const step = (dir: "undo" | "redo") => {
    const r = dir === "undo" ? undoHistory(history.current, designRef.current) : redoHistory(history.current, designRef.current);
    if (!r) return;
    history.current = r.history;
    designRef.current = r.value;
    setDesign(r.value);
    setSelected(new Set());
    // no "Undone." / "Redone." note: the board moving is the whole message
    // (owner, 2026-09-06: "just kill the label")
  };
  const [menu, setMenu] = useState<ColorMenu | null>(null);
  /* SAVED ARRANGEMENTS is a dropdown under the board's two buttons
   * (owner, 2026-09-04): its list floats fixed, anchored to the button's
   * bottom edge and as wide as it, so the modal's own scroll clip cannot
   * cut it off. A row loads on click; Remove stays on the row. */
  const [savedOpen, setSavedOpen] = useState<{ x: number; y: number; w: number } | null>(null);
  const savedBtn = useRef<HTMLButtonElement>(null);
  /* A TRACE OF SPOTS (owner, 2026-09-04): drag a path across the board
   * and every cell it crosses is picked, pinned or not. Click one of the
   * picked spots and all of them take the OPPOSITE of that spot's state
   * (a pin: all come out; bare board: all go in). Right-click one and
   * the color goes to all, pinning the bare ones. A plain click
   * elsewhere drops the trace and toggles as before.
   *
   * SHIFT / CMD (owner, 2026-09-06: "the standard for multi selecting in
   * osx"): a modified click adds a cell to the selection or takes it
   * out, without touching the pin; a modified drag ADDS its trace to
   * what was already selected instead of replacing it. Ctrl stands in
   * for Cmd off a Mac. */
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const drag = useRef<{
    start: { x: number; y: number };
    visited: Set<string>;
    moved: boolean;
    additive: boolean;
  } | null>(null);
  /* SHARE WITH COLLABORATORS? (owner, 2026-09-04): on, the arrangement
   * goes into the project's doc where anyone with Fun on can land on
   * it; off, it stays in this browser (state/markLocal.ts). */
  const sharedPool = shared?.pool ?? [];
  const localPool = local.pool ?? [];
  const isOverride = sameDesign(override, design);
  /* whether this browser's pool already holds the arrangement */
  const inLocalPool = localPool.some((d) => sameDesign(d, design));
  /* CLOSING ON UNKEPT WORK ASKS (owner, 2026-09-06: "If you hit DONE
   * without having committed the last thing, i want a confirm
   * dialogue"), and the question is his: save it to the fun pool on
   * the way out, or close without saving. Kept = it is the logo, or it
   * is in the fun pool. Untouched since opening never asks. Every way
   * out -- Done, the X, the backdrop, Escape -- goes through this,
   * since the loss is the same whichever you pressed. Three answers:
   * Go back (also Escape and the backdrop), Close without saving, Save
   * to the pool. */
  const opened = useRef(design);
  const openedAt = useRef(Date.now());
  const unkept = !sameDesign(design, opened.current) && !isOverride && !inLocalPool;
  const requestClose = async () => {
    if (unkept) {
      const answer = await confirmDialog.choose({
        title: "Save current design to the \"fun\" pool?",
        confirmLabel: "Save to the pool",
        altLabel: "Close without saving",
        cancelLabel: "Go back",
        danger: false,
      });
      if (answer === "cancel") return;
      if (answer === "confirm") markLocal.addToPool(design);
    }
    pinboardDesigner.close();
  };
  const saved: { design: MarkDesign; where: "shared" | "local"; role: "logo" | "pool" }[] = [
    ...(shared?.override ? [{ design: shared.override, where: "shared" as const, role: "logo" as const }] : []),
    ...(local.override ? [{ design: local.override, where: "local" as const, role: "logo" as const }] : []),
    ...sharedPool.map((d) => ({ design: d, where: "shared" as const, role: "pool" as const })),
    ...localPool.map((d) => ({ design: d, where: "local" as const, role: "pool" as const })),
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /* Cmd+Z / Shift+Cmd+Z are the DESIGNER's while it is open: stopped
         here in the capture phase, before App's own undo listener on the
         window can reach the board's stack. */
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopImmediatePropagation();
        step(e.shiftKey ? "redo" : "undo");
        return;
      }
      if (e.key !== "Escape") return;
      // the confirm above us owns Escape while it is up
      if (document.querySelector(".confirm-backdrop")) return;
      e.preventDefault();
      e.stopPropagation();
      if (menu) setMenu(null);
      else if (savedOpen) setSavedOpen(null);
      else if (selected.size) setSelected(new Set());
      else void requestClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, savedOpen, selected, unkept]);

  const n = sizeOf(design);
  const cellAt = (e: RMouseEvent<SVGSVGElement> | RPointerEvent<SVGSVGElement>): { x: number; y: number } | null => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * n);
    const y = Math.floor(((e.clientY - r.top) / r.height) * n);
    if (x < 0 || y < 0 || x >= n || y >= n) return null;
    return { x, y };
  };

  /* VIEWPORT coordinates: the menu is fixed and sits above the modal,
   * which clips its own overflow and was cropping it (owner, 2026-09-04). */
  const place = (e: RMouseEvent<SVGSVGElement>) => ({ x: e.clientX, y: e.clientY });

  const pins = designPins(design);
  const has = (x: number, y: number) => design.cells[y][x] === "#";
  /* A color from the menu: the board's, or one pin's -- or every
   * selected pin's when the right-clicked pin is one of them. */
  const apply = (c: string) => {
    const t = menu?.target;
    if (!t) return;
    if (t.kind === "board") {
      edit((d) => ({ ...d, board: c }), "color:board");
      return;
    }
    const keys = selected.has(cellKey(t.x, t.y)) ? [...selected] : [cellKey(t.x, t.y)];
    edit(
      (d) =>
        keys.reduce((acc, key) => {
          const [x, y] = key.split(",").map(Number);
          const pinned = acc.cells[y]?.[x] === "#" ? acc : toggleCell(acc, x, y);
          return setPinColor(pinned, x, y, c);
        }, d),
      "color:" + keys.join("|"),
    );
  };

  return (
    <div
      /* the backdrop does not dismiss for the first two seconds (owner,
         2026-09-06): five quick clicks open this, and the sixth or
         seventh of a flurry used to land on the backdrop and close it */
      className="tp-backdrop"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (Date.now() - openedAt.current < 2000) return;
        void requestClose();
      }}
    >
      <div
        className="tp-modal pd-modal"
        onMouseDown={() => {
          setMenu(null);
          setSavedOpen(null);
        }}
      >
        <div className="tp-head">
          <div>
            <div className="tp-title">Pinboard designer</div>
            {/* his words (2026-09-06), exactly; Shift/Cmd-click works but
                goes unannounced, by his call */}
            <div className="tp-sub">
              You found the pinboard designer! Click a cell to add/remove a pin. Right click to change the
              color of a pin or the board. Click and drag to select multiple cells. Save your designs to add
              them to the logo widget.
            </div>
          </div>
          <button className="tp-close" aria-label="Close" onClick={() => void requestClose()}>
            &times;
          </button>
        </div>

        <div className="pd-body">
          <div className="pd-board">
          <svg
            className="pd-grid"
            viewBox={`0 0 ${n} ${n}`}
            style={{ background: design.board }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const c = cellAt(e);
              if (!c) return;
              const visited = new Set<string>([cellKey(c.x, c.y)]);
              drag.current = { start: c, visited, moved: false, additive: e.shiftKey || e.metaKey || e.ctrlKey };
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* a synthetic pointer has no capture; the trace still works */
              }
            }}
            onPointerMove={(e) => {
              const g = drag.current;
              if (!g) return;
              const c = cellAt(e);
              if (!c) return;
              if (c.x !== g.start.x || c.y !== g.start.y) g.moved = true;
              const k = cellKey(c.x, c.y);
              if (g.visited.has(k)) return;
              g.visited.add(k);
              /* the trace shows as it is drawn (owner, 2026-09-04): once
                 the pointer has left its first cell, the rings follow it
                 rather than appearing on release */
              if (g.moved) setSelected(g.additive ? new Set([...selected, ...g.visited]) : new Set(g.visited));
            }}
            onPointerUp={() => {
              const g = drag.current;
              drag.current = null;
              if (!g) return;
              if (g.moved) {
                setSelected(g.additive ? new Set([...selected, ...g.visited]) : new Set(g.visited));
                return;
              }
              const k = cellKey(g.start.x, g.start.y);
              if (g.additive) {
                // a modified click picks or unpicks this one cell, pin untouched
                setSelected((s) => {
                  const next = new Set(s);
                  if (next.has(k)) next.delete(k);
                  else next.add(k);
                  return next;
                });
                return;
              }
              if (selected.has(k)) {
                // every traced spot takes the opposite of the clicked one
                const on = !has(g.start.x, g.start.y);
                edit((d) =>
                  [...selected].reduce((acc, key) => {
                    const [x, y] = key.split(",").map(Number);
                    const isPin = acc.cells[y]?.[x] === "#";
                    return isPin === on ? acc : toggleCell(acc, x, y);
                  }, d),
                );
                setSelected(new Set());
                return;
              }
              setSelected(new Set());
              edit((d) => toggleCell(d, g.start.x, g.start.y));
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const c = cellAt(e);
              if (!c) return;
              const k = cellKey(c.x, c.y);
              setMenu({
                ...place(e),
                target: has(c.x, c.y) || selected.has(k) ? { kind: "pin", x: c.x, y: c.y } : { kind: "board" },
              });
            }}
          >
            {/* the cells, faint, so an empty board still reads as a grid */}
            {Array.from({ length: n * n }, (_, i) => {
              const x = i % n;
              const y = Math.floor(i / n);
              return (
                <rect
                  key={i}
                  x={x + 0.06}
                  y={y + 0.06}
                  width={0.88}
                  height={0.88}
                  rx={0.1}
                  fill="rgba(255,255,255,0.06)"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth={0.02}
                />
              );
            })}
            {[...selected].map((key) => {
              const [x, y] = key.split(",").map(Number);
              if (has(x, y)) return null;
              return (
                <circle key={"t" + key} cx={x + 0.5} cy={y + 0.5} r={0.46} fill="none" stroke="#2f6fdb" strokeWidth={0.07} strokeDasharray="0.12 0.08" />
              );
            })}
            {pins.map((p) => {
              const fill = pinColor(design, p.x, p.y);
              const picked = selected.has(cellKey(p.x, p.y));
              return (
                <g key={cellKey(p.x, p.y)} className="brand-pin">
                  {picked && (
                    <circle cx={p.x + 0.5} cy={p.y + 0.5} r={0.46} fill="none" stroke="#2f6fdb" strokeWidth={0.07} />
                  )}
                  <circle cx={p.x + 0.5} cy={p.y + 0.5} r={0.37} fill={fill} />
                  <circle cx={p.x + 0.39} cy={p.y + 0.38} r={0.11} fill="#fff" opacity={0.5} />
                </g>
              );
            })}
          </svg>
          <div className="pd-board-actions">
            <button
              className="tp-btn"
              onClick={() => {
                setSelected(new Set());
                edit(theC());
              }}
            >
              Reset to the C
            </button>
            <button
              className="tp-btn"
              onClick={() => {
                setSelected(new Set());
                edit((d) => (designPins(d).length ? emptied(d) : filled(d)));
              }}
            >
              Clear all/Fill all
            </button>
          </div>
          <button
            ref={savedBtn}
            className={"tp-btn pd-saved-btn" + (savedOpen ? " active" : "")}
            disabled={saved.length === 0}
            onClick={() => {
              if (savedOpen) return setSavedOpen(null);
              const r = savedBtn.current?.getBoundingClientRect();
              if (!r) return;
              setSavedOpen({ x: r.left, y: r.bottom + 5, w: r.width });
            }}
          >
            <span>Saved arrangements{saved.length ? ` (${saved.length})` : ""}</span>
            <ChevronDown size={13} className="fold-caret" />
          </button>
          </div>

          <div className="pd-side">
            {/* THE GRID'S SIZE (owner, 2026-09-04): 5x5 to 8x8, the
                arrangement kept top-left and the mark following -- and
                1x1 (2026-09-06), one pin as the whole mark. */}
            <div className="options-row pd-size-row">
              <span>Grid</span>
              <span className="pd-sizes">
                {MARK_SIZES.map((k) => (
                  <button
                    key={k}
                    className={"pd-size" + (k === n ? " active" : "")}
                    aria-pressed={k === n}
                    onClick={() => {
                      setSelected(new Set());
                      edit((d) => resizeDesign(d, k));
                    }}
                  >
                    {k}x{k}
                  </button>
                ))}
              </span>
            </div>
            <div className="options-group mono">Preview</div>
            {/* one preview, the corner's own size, centered (owner, 2026-09-04) */}
            <div className="pd-preview">
              <CorkoMark size={51} egg={false} preview={design} />
            </div>
            {/* WHERE EACH LANDS: both in THIS BROWSER (owner, 2026-09-06:
                "go back to just having it local with the same old two
                buttons", withdrawing a personal/communal pair the same
                hour). The logo override and the fun pool are
                state/markLocal.ts's; the project's shared pool is still
                read (an old entry lands like any other) but nothing here
                writes to it any more. */}
            <button
              className="tp-btn primary"
              onClick={() => {
                if (isOverride) {
                  /* A CANCELLED OVERRIDE BECOMES A POOL ENTRY, not
                     nothing (owner, 2026-09-06: "convert it to a fun
                     pool option rather than deleting it"): the work
                     stays landable. */
                  if (local.override) markLocal.setOverride(null);
                  if (shared?.override && sameDesign(shared.override, design)) ops.setMarkOverride(null);
                  if (!inLocalPool) markLocal.addToPool(design);
                } else {
                  markLocal.setOverride(design);
                }
              }}
            >
              {isOverride ? "Cancel override" : "Set persistent logo override"}
            </button>
            {/* Always live, one label (owner, 2026-09-06: "don't
                de-activate ... just don't duplicate entries"). The pool
                store already dedupes on add, so pressing it on an
                arrangement already there costs nothing and says nothing
                about it. "fun" in quotes: it names the Load animation
                option. */}
            <button
              className="tp-btn"
              onClick={() => {
                markLocal.addToPool(design);
              }}
            >
              Add to your local &quot;fun&quot; pool
            </button>

            <div className="pd-actions">
              <button className="tp-btn primary" onClick={() => void requestClose()}>
                Done
              </button>
            </div>
          </div>
        </div>

        {savedOpen && (
          <Floating x={savedOpen.x} y={savedOpen.y} width={savedOpen.w} className="pd-colors pd-saved-pop">
            <div className="pd-saved">
              {saved.map((row, i) => (
                <div
                  key={i}
                  className="pd-saved-row"
                  role="button"
                  onClick={() => {
                    setSelected(new Set());
                    edit(row.design);
                    setSavedOpen(null);
                  }}
                >
                  <CorkoMark size={26} egg={false} preview={row.design} />
                  <span className="pd-saved-label mono">
                    {row.role === "logo" ? "logo" : "pool"} · {row.where}
                  </span>
                  <button
                    className="pd-link danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (row.role === "logo") {
                        if (row.where === "shared") ops.setMarkOverride(null);
                        else markLocal.setOverride(null);
                      } else if (row.where === "shared") ops.removeMarkFromPool(row.design);
                      else markLocal.removeFromPool(row.design);
                      if (saved.length === 1) setSavedOpen(null);
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </Floating>
        )}
        {menu && (
          <Floating x={menu.x} y={menu.y}>
            <div className="options-group mono">{menu.target.kind === "pin" ? "Pin color" : "Board color"}</div>
            {/* swatches for a PIN only. The board had a row of the looks'
                boards, which were tuned for the cork-dye blend and read
                as mud once a designed board painted flat (owner,
                2026-09-06: "kill all the swatches in board color") --
                the picker alone, there. */}
            {menu.target.kind === "pin" && (
              <div className="pd-swatches">
                {/* ONLY the colors already on this board's pins (owner,
                    2026-09-06: "add swatches for any other existing pins
                    currently on the board ... and remove the other
                    swatches"): matching a neighbor is one click, and
                    anything new comes from the picker */}
                {Array.from(new Set(designPins(design).map((p) => pinColor(design, p.x, p.y)))).map((c) => (
                  <button
                    key={c}
                    className="pd-swatch"
                    style={{ background: c }}
                    aria-label={c}
                    onClick={() => {
                      apply(c);
                      setMenu(null);
                    }}
                  />
                ))}
              </div>
            )}
            <ColorPicker
              value={menu.target.kind === "pin" ? pinColor(design, menu.target.x, menu.target.y) : design.board}
              onChange={apply}
            />
            {menu.target.kind === "pin" && (
              <button
                className="pd-link"
                onClick={() => {
                  const t = menu.target as { x: number; y: number };
                  const keys = selected.has(cellKey(t.x, t.y)) ? [...selected] : [cellKey(t.x, t.y)];
                  edit((d) =>
                    keys.reduce((acc, key) => {
                      const [x, y] = key.split(",").map(Number);
                      return acc.cells[y]?.[x] === "#" ? toggleCell(acc, x, y) : acc;
                    }, d),
                  );
                  setSelected(new Set());
                  setMenu(null);
                }}
              >
                {selected.has(cellKey((menu.target as { x: number }).x, (menu.target as { y: number }).y)) && selected.size > 1
                  ? `Pull these ${selected.size} spots`
                  : "Pull this pin"}
              </button>
            )}
          </Floating>
        )}
      </div>
    </div>
  );
}

/* The color menu's box: fixed at the pointer, nudged back inside the
 * window when it would run off the right or bottom edge. */
function Floating({
  x,
  y,
  width,
  className = "pd-colors",
  children,
}: {
  x: number;
  y: number;
  width?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const ny = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
    setAt({ x: nx, y: ny });
  }, [x, y]);
  return (
    <div
      ref={ref}
      className={className}
      style={{ left: at.x, top: at.y, width }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
