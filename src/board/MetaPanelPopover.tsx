import { useEffect, useMemo, useRef, useState } from "react";
import { TagSwatch } from "./TagSwatch";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  HelpCircle,
  Pencil,
  Plus,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { ops, useBoard, useFields, useLegend, useNode, useNodes, useTags } from "../state/useBoard";
import { resolveNodeColor, resolveNodeEntry, textColor } from "../colors";
import { isNested } from "../state/nesting";
import { fontClass } from "../fonts";
import { MiniCard, tierGeometry } from "./overview/MiniCard";
import { CELL, spanOf } from "../state/gridBoard";
import { SLOT_IDS, SLOT_LABELS, type Board, type FieldDef, type Node, type SlotId } from "../state/types";
import { DraftInput } from "../ui/DraftInput";
import { FloatPanel } from "../ui/FloatPanel";
import { META_W, metaPanel, useMetaPanel } from "./cardPanels";
import { depthOf, tierHops, type TierHop } from "./cardHops";
import { plainText } from "./cardText";
import { selection, useSelectionIds } from "./selection";
import { sharedSlot, sharedValue, subjectLabel, tagShare, tagsOnAny } from "./groupEdit";
import { setSetting, useSettings } from "../state/settings";
import { confirmDialog } from "../ui/confirmDialog";

/* ------------------------------------------------------------------ *
 *  "More metadata..." -- the card's values, where they show, and its tags.
 *
 *  Three stacked parts, in the order you use them:
 *
 *  1. A PREVIEW of the actual card, with its six display slots drawn as
 *     empty outlines. This is both "here's what you're editing" and the
 *     drop target: drag a category by its grip onto a slot and the value
 *     appears there on the real board.
 *  2. The CATEGORIES -- label + this card's value. A legend-style
 *     edit/done toggle switches the list between *using* categories
 *     (fill values, drag them onto the card) and *managing* them (add,
 *     rename, delete project-wide). Same idiom as the legend bar, and it
 *     keeps a destructive control out of the way while you're just typing.
 *  3. The TAGS on this card.
 *
 *  Placement is PER CARD. "Apply layout to..." is how one card's layout
 *  stops being a one-card decision without becoming a global one: it
 *  pushes this card's slots onto every card at the same tier inside a
 *  scope you pick. Values are untouched -- those travel by copy/paste.
 * ------------------------------------------------------------------ */

/* Nearest-first ancestors of a node, for the apply-to scope list. */
function ancestorsOf(board: Board | null, id: string): { node: Node; depth: number }[] {
  if (!board) return [];
  const trail: { node: Node; depth: number }[] = [];
  const walk = (nodes: Node[], depth: number): boolean => {
    for (const n of nodes) {
      if (n.id === id) return true;
      if (n.children.length && walk(n.children, depth + 1)) {
        trail.push({ node: n, depth });
        return true;
      }
    }
    return false;
  };
  walk(board.roots, 0);
  return trail; // nearest ancestor first (pushed on the way back up)
}

/* The two things nobody guesses about this panel. Rendered as a REAL
 * tooltip rather than a `title`: the native one never appeared here
 * (owner-reported -- the help cursor showed and no text followed), and a
 * two-bullet explanation is not what `title` is good at anyway. Also the
 * aria-label, so assistive tech gets the same words. */
const META_HELP_LINES = [
  "Metadata CATEGORIES are shared across the whole project. VALUES are specific to this card.",
  "Drag a category to reorder the list, or drag it into the layout template above to make its value visible on the card.",
];
const META_HELP = META_HELP_LINES.join(" ");

/* ------------------------------------------------------------------ *
 *  ONE CHEVRON DISC: the previous or next card at one tier, opened in
 *  this same panel. It reuses `.seam-disc` for its shape and takes its
 *  fill from the legend exactly as the seam does (resolveNodeEntry on
 *  the TIER's own level id) -- the board's colors, not a second palette.
 *
 *  It re-opens the panel rather than doing anything cleverer, so the
 *  card whose panel this becomes is a card you could have right-clicked:
 *  same door, same state, and cardPanels' one-card rule closes anything
 *  standing on the card you just left.
 * ------------------------------------------------------------------ */
function HopDisc({
  board,
  hop,
  dir,
  open,
  onGoTo,
}: {
  board: Board | null;
  hop: TierHop;
  dir: "prev" | "next";
  open: { boardId: string; x: number; y: number };
  onGoTo?: (id: string, boardId: string) => boolean;
}) {
  const legend = useLegend(board?.id ?? "");
  const target = dir === "prev" ? hop.prev : hop.next;
  const level = board?.levels[hop.tier];
  const fill = resolveNodeEntry(legend, undefined, level?.id ?? "");
  const bg = fill?.bg ?? "#fff";
  const tier = level?.name.toLowerCase() ?? "card";
  const Chevron = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      className="seam-disc hop-disc"
      disabled={!target}
      style={
        target
          ? { background: bg, borderColor: fill?.border, color: textColor(bg) }
          : /* DIMMED BY COLOR, not opacity -- see the header row's note.
               The fill still shows, faintly, so the row still reads as
               the ladder it is. */
            { background: bg, borderColor: fill?.border, color: textColor(bg), filter: "grayscale(0.7) brightness(1.12)" }
      }
      data-tip={
        target
          ? `${dir === "prev" ? "Previous" : "Next"} ${tier}`
          : `No ${dir === "prev" ? "previous" : "next"} ${tier}`
      }
      aria-label={`${dir === "prev" ? "Previous" : "Next"} ${tier}`}
      onClick={() => {
        if (!target) return;
        // a walk, not an opening: it must not shut a note standing on
        // another card (cardPanels.ts OpenOpts `follow`)
        metaPanel.open(target, open.boardId, hop.tier, open.x, open.y, { follow: true });
        /* AND THE BOARD FOLLOWS (owner, 2026-09-10). Selecting is the
         * point, not a nicety: with the Player open beside this, its
         * "Capture frame to selected card" is aimed by the selection,
         * so walking the board here is what keeps the frame and the
         * metadata landing on the same card. The scroll comes with it --
         * a selection you cannot see is not navigation. */
        onGoTo?.(target, open.boardId);
      }}
    >
      <Chevron size={12} />
    </button>
  );
}

/* The blank card an EMPTY panel renders over. Frozen, so nothing can
 * write into it by mistake; every field the body reads is present and
 * empty. */
const NO_IDS: string[] = [];
const EMPTY_NODE: Node = Object.freeze({ id: "", title: "", collapsed: false, children: [] }) as Node;

export function MetaPanelPopover({
  onGoTo,
}: {
  /* Select and scroll to a card on the board. App's, because only App
   * knows which panel is showing which board. */
  onGoTo?: (id: string, boardId: string) => boolean;
}) {
  const open = useMetaPanel();
  /* PINNED: parked on top, and following whatever card is selected
   * (owner, 2026-09-10: "maybe it gets a toggle for 'persist on top?'
   * and it always changes to the current card selected if you move
   * around until you close it"). Global, not per board -- it is a way of
   * working, not a property of a board. */
  const { metaPinned } = useSettings();
  /* The BOARD's images switch, which is half of what decides whether a
   * card's words are plain (board/cardText.ts plainText). Per board, so
   * it is read against the panel's own board. */
  const { cardImages } = useSettings(open?.boardId ?? "");
  const selected = useSelectionIds();
  // hooks run unconditionally, above the early return below
  const realNode = useNode(open?.boardId ?? null, open?.nodeId || null);
  /* OPENED EMPTY (keyNav's `m` with nothing selected, 2026-09-10): the
   * store holds an empty id, and the panel renders over a blank card so
   * the body -- three hundred lines that read `node.` -- needs no second
   * shape. It draws greyed and inert exactly as a deselected card does,
   * with the project's categories listed and nothing in them, which is
   * an honest picture of "no card yet". `useNode` is asked with null, so
   * it does not go looking for a card called "". */
  const summonedEmpty = !!open && open.nodeId === "";
  const node: Node | null = realNode ?? (summonedEmpty ? EMPTY_NODE : null);
  /* THE SUBJECT (board/groupEdit.ts, 2026-09-12): every card this panel
   * is about. One card is a subject of one, and reads exactly as it
   * always did; a selection reads MIXED wherever the cards disagree and
   * writes to all of them. `node` stays the ANCHOR -- the card the panel
   * was opened from -- for the preview, the layout source and the
   * hops. */
  const ids = open?.ids ?? NO_IDS;
  const subject = useNodes(open?.boardId ?? null, ids);
  const nodes: Node[] = subject.length ? subject : node ? [node] : [];
  const many = ids.length > 1;
  const board = useBoard(open?.boardId ?? null);
  const legend = useLegend(open?.boardId ?? "");
  const tags = useTags();
  const fields = useFields();
  const [editing, setEditing] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  /* The category in the air. Kept in a REF as well as state: state drives
   * the "a drop can land here" styling, but the drop HANDLER must not read
   * it -- within one gesture React may not have re-rendered, and the
   * handler would close over a stale null. The ref (and the dataTransfer
   * payload, as a belt-and-braces fallback) is what the drop acts on. */
  const [dragField, setDragField] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);
  const [overSlot, setOverSlot] = useState<SlotId | null>(null);
  /* Which row gap the reorder marker sits in, as "<id>:before|after" --
   * one piece of state rather than one per row, so only the row that
   * changes re-renders. */
  const [rowMark, setRowMark] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [scope, setScope] = useState<string>("");
  /* The categories ticked for the value-apply below. Kept per panel rather
   * than per card: you tick, you apply, you move on -- persisting it would
   * only mean the next card you open is armed without your saying so. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [valueScope, setValueScope] = useState<string>("");
  const [appliedValues, setAppliedValues] = useState<string | null>(null);

  const ancestors = useMemo(() => ancestorsOf(board, node?.id ?? ""), [board, node?.id]);
  /* Recomputed when the board changes, which is right: a card added
   * above you moves what "next" means, and the panel is long-lived. */
  // ...and none on a SET: the chevrons carry the selection to one
  // card, and "next scene" from three of them is not a question
  const hops = useMemo(() => (many ? [] : tierHops(board, node?.id ?? "")), [board, node?.id, many]);

  // the card can be deleted from under an open panel (or by a collaborator)
  // -- a REAL card that vanished, never the empty one, which has no card
  // to lose
  useEffect(() => {
    if (open && open.nodeId && !realNode) metaPanel.close();
  }, [open, realNode]);
  /* PINNED, THE PANEL FOLLOWS THE BOARD. Whatever you select becomes the
   * card it is about, so it reads as an inspector rather than something
   * you opened once -- and with the Player beside it, the panel, the
   * selection and "capture frame to selected card" are all aimed at one
   * card however you got there.
   *
   * EXACTLY ONE, and never a no-op re-open. A multi-select has no single
   * card to be about, so the panel holds the last one rather than
   * blanking -- and an empty selection does too, so clearing does not
   * take the panel's subject away. Re-opening on the card it already
   * shows would fight the DRAG: metaPanel.open carries x/y, so it would
   * snap a panel you had moved back to where it was born. */
  /* ...ONE OR MANY, since 2026-09-12: the selection as a SET is the
   * subject, compared as a set so a re-click that changes nothing is
   * not a re-open. The anchor is the selection's own (the last card
   * clicked), else the first. */
  const followKey = selected.length ? [...selected].sort().join("\n") : null;
  const openKey = open ? [...open.ids].sort().join("\n") : null;
  const followId = selected.length ? (selection.anchor() && selected.includes(selection.anchor()!) ? selection.anchor()! : selected[0]) : null;
  /* NO CARD LOADED (owner, 2026-09-10: "if you click away from a card on
   * the board, have it say 'no card loaded' in the card preview and then
   * everything in the box is grayed out (it all stays there)").
   *
   * Only while PINNED, because that is the only way the panel outlives a
   * click on the board -- loose, clicking away closes it, and this state
   * can never be reached.
   *
   * The panel keeps SHOWING the last card underneath, which is his "it
   * all stays there": the store is not cleared, so nothing reflows and
   * the box does not collapse to a strip while you pick the next card.
   * It is simply inert, and the preview says why. */
  const blank = summonedEmpty || (metaPinned && followKey === null);
  /* ...and an EMPTY panel follows the selection whether pinned or not: it
   * exists to be pointed at a card, so the first card you select is the
   * card it becomes. (Loose, a mouse click on the board still closes it
   * first -- that is the loose panel's rule -- but the keyboard fills it,
   * and pinning first makes the mouse work too.) */
  useEffect(() => {
    if (!open || !followId || followKey === openKey) return;
    if (!metaPinned && !summonedEmpty) return;
    const depth = depthOf(board, followId);
    if (depth === null) return; // a card on some other board: not ours to follow
    /* `follow`: a follow never closes another card's door (cardPanels.ts
     * OpenOpts) -- a note being typed on card A survives selecting B */
    metaPanel.open(followId, open.boardId, depth, open.x, open.y, { ids: selected, follow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the note above
  }, [metaPinned, followId, followKey, openKey, open?.boardId, open?.x, open?.y, board]);
  /* Both apply-scopes DEFAULT TO THE NARROWEST container -- the nearest
   * ancestor, not the board (owner's call: the least drastic thing by
   * default; "every beat in this scene" is a shrug, "every beat in this
   * board" is a commitment). Keyed on the card being opened, NOT on
   * `ancestors`: that array is rebuilt on every board edit, and re-running
   * then would snap a scope the user had deliberately widened back to the
   * narrow default mid-use. */
  const nodeKey = open?.nodeId;
  useEffect(() => {
    if (!nodeKey) return;
    const nearest = ancestors[0]?.node.id ?? "";
    setScope(nearest);
    setValueScope(nearest);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per card, see above
  }, [nodeKey]);
  // a scope that no longer exists (the card moved) falls back to the
  // narrowest still-valid one, same reasoning as the default
  useEffect(() => {
    const fallback = ancestors[0]?.node.id ?? "";
    if (scope && !ancestors.some((a) => a.node.id === scope)) setScope(fallback);
    if (valueScope && !ancestors.some((a) => a.node.id === valueScope)) setValueScope(fallback);
  }, [ancestors, scope, valueScope]);

  if (!open || !node) return null;

  const level = board?.levels[open.depth];
  // every tag on ANY card of the subject, in the project's order
  const applies = tagsOnAny(nodes, tags.map((t) => t.id)).map((id) => tags.find((t) => t.id === id)!);
  const left = open.x;
  const top = open.y; // FloatPanel clamps to the window by measuring itself

  // the preview is the real card: this tier's aspect, this card's fill --
  // and, since 2026-08-01, the real TITLE at its real relative size. The
  // card is laid out at detail size and CSS-scaled into the panel
  // (MiniCard, the same trick as the Overview's hover preview), so the
  // title is exactly as large against its card here as it is on the board,
  // and wraps between the same words.
  const c = resolveNodeColor(legend, node.color, level?.id ?? "", isNested(node));
  const txt = level?.textColor ?? textColor(c.bg);
  /* THE CARD'S OWN SHAPE, not its tier's (owner, 2026-09-01). A Free
   * Grid sizes each card individually -- `Node.span`, in cells -- so
   * asking the LADDER how big this card is gives the wrong aspect, and
   * a preview whose whole job is "this is where it lands" then crops
   * the picture differently from the card it is a picture of. Every
   * other type does size by tier, so they are unaffected. */
  const span = board?.type === "grid" ? spanOf(node) : null;
  // `false`: this preview is about where SLOTS land, and they land on the
  // text card, so it draws that and never the picture's appended room
  const tierGeo = board ? tierGeometry(board.levels, open.depth, "on", false) : null;
  const geo =
    tierGeo && span
      ? { ...tierGeo, detailH: span.h * CELL, aspect: span.w / span.h }
      : tierGeo;
  const PW = META_W - 24;
  // fill the panel's width; tall narrow cards cap at 160px high instead
  const detailW = geo ? Math.round(geo.detailH * geo.aspect) : PW;
  const k = geo ? Math.min(PW / detailW, 160 / geo.detailH) : 1;
  const prevW = Math.round(detailW * k);
  const prevH = geo ? Math.round(geo.detailH * k) : 120;

  const drop = (slot: SlotId, e: React.DragEvent) => {
    const id = dragRef.current || e.dataTransfer.getData("text/plain");
    if (id && fields.some((f) => f.id === id)) ops.setNodeSlot(ids, slot, id);
    dragRef.current = null;
    setDragField(null);
    setOverSlot(null);
  };

  const removeCategory = async (id: string, name: string) => {
    const ok = await confirmDialog.ask({
      title: `Delete "${name || "this category"}"?`,
      body: "It goes from the whole project, with every value filed under it.",
    });
    if (ok) ops.removeField(id);
  };

  const applyValues = () => {
    const ids = [...picked];
    const n = ops.applyValues(node.id, valueScope || null, ids);
    const a = valueScope ? ancestors.find((x) => x.node.id === valueScope) : undefined;
    const where = !valueScope
      ? "this board"
      : a?.node.title || `this ${board?.levels[a?.depth ?? 0]?.name.toLowerCase() ?? "group"}`;
    const what = ids.length === 1 ? fields.find((f) => f.id === ids[0])?.name || "1 value" : `${ids.length} values`;
    setAppliedValues(
      `${what} copied to ${n} ${level?.name.toLowerCase() ?? "card"}${n === 1 ? "" : "s"} in ${where}.`,
    );
    window.setTimeout(() => setAppliedValues(null), 4000);
  };

  const applyLayout = () => {
    const n = ops.applyLayout(node.id, scope || null);
    // the menu says only "scene"; the confirmation says WHICH scene, which
    // is the one place the title earns its space
    const a = scope ? ancestors.find((x) => x.node.id === scope) : undefined;
    const where = !scope
      ? "this board"
      : a?.node.title || `this ${board?.levels[a?.depth ?? 0]?.name.toLowerCase() ?? "group"}`;
    setApplied(`Layout copied to ${n} ${level?.name.toLowerCase() ?? "card"}${n === 1 ? "" : "s"} in ${where}.`);
    window.setTimeout(() => setApplied(null), 4000);
  };

  /* ------------------------------------------------------------- *
   *  ONE ROW SKELETON FOR BOTH MODES (owner, 2026-08-28: "the positions
   *  of the metadata categories don't change when you flip it into edit
   *  mode").
   *
   *  It used to be two different rows -- done mode was
   *  [tick][grip][name][value] and edit mode was [name][label][x] -- so
   *  flipping the toggle moved every name sideways and swapped the
   *  values out entirely. You lost your place in the list at exactly the
   *  moment you were trying to rename the thing you were looking at.
   *
   *  So there is now ONE row, and the mode-specific controls are
   *  HIDDEN rather than absent -- `visibility`, which keeps their space.
   *  That is the legend gear's idiom (~15px reserved per chip
   *  permanently, cheaper than the row shifting under the cursor you are
   *  pointing with), and here it makes the two modes geometrically
   *  identical by construction rather than by matching numbers by hand.
   *
   *  THE VALUE STAYS VISIBLE IN EDIT MODE, grayed and inert (his ask):
   *  renaming a category while you can still see what it holds is the
   *  whole point of being in there. It is a plain disabled <input>
   *  rather than the DraftInput -- same element, same class, so the box
   *  is identical by construction, and `disabled` gives uninteractable
   *  and un-focusable for free without a new prop on a shared
   *  component. */
  const row = (f: FieldDef) => {
    const shown = sharedValue(nodes, f.id);
    // a value on ANY card of the set, mixed or shared, is something to clear
    const clearable = !editing && !blank && nodes.some((n) => (n.values?.[f.id] ?? "").trim() !== "");
    /* Reordering is a done-mode gesture; in edit mode the row carries no
     * drop behavior at all, so the handlers are omitted rather than
     * guarded inside. */
    const dnd = editing
      ? {}
      : {
          onDragOver: (e: React.DragEvent) => {
            const id = dragRef.current;
            if (!id || id === f.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const r = e.currentTarget.getBoundingClientRect();
            const half = e.clientY < r.top + r.height / 2 ? "before" : "after";
            setRowMark((m) => (m === f.id + ":" + half ? m : f.id + ":" + half));
          },
          onDragLeave: (e: React.DragEvent) => {
            const next = e.relatedTarget as globalThis.Node | null;
            if (next && e.currentTarget.contains(next)) return;
            setRowMark(null);
          },
          onDrop: (e: React.DragEvent) => {
            const id = dragRef.current;
            setRowMark(null);
            if (!id || id === f.id) return;
            e.preventDefault();
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            /* "after this row" is "before the next one", and before
               nothing is the end of the list -- the same way
               useChipReorder expresses it. */
            const after = e.clientY >= r.top + r.height / 2;
            const next = fields[fields.findIndex((x) => x.id === f.id) + 1];
            ops.reorderField(id, after ? (next?.id ?? null) : f.id);
            dragRef.current = null;
            setDragField(null);
          },
        };
    return (
      <div
        key={f.id}
        className={
          "meta-row" +
          (editing ? " meta-row-edit" : "") +
          (rowMark === f.id + ":before" ? " meta-row-before" : "") +
          (rowMark === f.id + ":after" ? " meta-row-after" : "")
        }
        {...dnd}
      >
        {/* ticked = this category travels when you hit Apply below.
            A blank value is still a legitimate thing to send: it
            CLEARS the category on every target, which is the only
            way to wipe a column in bulk. */}
        <input
          type="checkbox"
          className="meta-pick"
          checked={picked.has(f.id)}
          disabled={editing}
          tabIndex={editing ? -1 : undefined}
          aria-hidden={editing || undefined}
          aria-label={`Apply ${f.name || "this category"} to other cards`}
          data-tip={
            editing
              ? undefined
              : (node.values?.[f.id] ?? "").trim()
                ? `Apply this card's ${f.name || "value"} to other cards`
                : `Blank -- ticking this CLEARS ${f.name || "this category"} on the other cards`
          }
          onChange={() =>
            setPicked((prev) => {
              const next = new Set(prev);
              if (next.has(f.id)) next.delete(f.id);
              else next.add(f.id);
              return next;
            })
          }
        />
        <span
          className="meta-grip"
          draggable={!editing}
          aria-hidden={editing || undefined}
          title="Drag into a layout slot to make the value visible on the board"
          onDragStart={(e) => {
            dragRef.current = f.id;
            setDragField(f.id);
            /* copyMove, not copy: a grip means two things now --
               placing into a slot (copy) and reordering the list
               (move) -- and a dropEffect the source does not
               permit is reset to "none", so `drop` never fires.
               That exact mismatch silently broke legend chip
               reordering (board/legendDrag.ts). */
            e.dataTransfer.effectAllowed = "copyMove";
            e.dataTransfer.setData("text/plain", f.id);
          }}
          onDragEnd={() => {
            dragRef.current = null;
            setDragField(null);
            setOverSlot(null);
            setRowMark(null);
          }}
        >
          <GripVertical size={12} />
        </span>

        {editing ? (
          <DraftInput
            className="meta-name"
            value={f.name}
            ariaLabel="Category name"
            placeholder="Category"
            autoFocus={f.id === justAdded}
            onCommit={(v) => ops.setField(f.id, { name: v.trim() })}
          />
        ) : (
          <span className="meta-name-static" title={f.name}>
            {f.name || <em className="info-empty">unnamed</em>}
          </span>
        )}

        <span className="meta-value-wrap">
          {editing ? (
            <input
              className={"meta-value" + (shown.mixed ? " mixed" : "")}
              value={shown.mixed ? "" : shown.value}
              placeholder={shown.mixed ? "Mixed" : "value"}
              disabled
              readOnly
              tabIndex={-1}
              aria-hidden
            />
          ) : (
            /* MIXED reads empty with the word as its placeholder (his
               pick, 2026-09-12); what you type goes to every card, in
               one transaction. Emptying a mixed box says nothing -- the
               draft matches the empty value it was handed, so nothing
               commits -- which is the honest reading of "I typed
               nothing"; the x beside it is how a category is cleared
               on every card (his ask, 2026-09-13: "i do want a way to
               bulk clear"). */
            <DraftInput
              className={"meta-value" + (shown.mixed ? " mixed" : "") + (clearable ? " clearable" : "")}
              value={shown.mixed ? "" : shown.value}
              ariaLabel={`${f.name || "Category"} value for ${many ? "these cards" : "this card"}`}
              placeholder={shown.mixed ? "Mixed" : "value"}
              onCommit={(v) => ops.setNodeValue(ids, f.id, v.trim())}
            />
          )}
          {/* THE CLEAR (his pick of two, 2026-09-13): inside the box at
              its right end, the pane bar's search-field idiom, shown
              whenever any card in the set holds a value here. One
              transaction, one undo. Not the row's other x, which lives
              outside the box, only in edit mode, and deletes the
              CATEGORY. tip-left: it sits at the panel's right edge. */}
          {clearable && (
            <button
              className="meta-value-clear tip-left"
              aria-label={`Clear ${f.name || "this value"}${many ? " on every card" : ""}`}
              data-tip={many ? "Clear on every card" : "Clear"}
              onClick={() => ops.setNodeValue(ids, f.id, "")}
            >
              <X size={11} />
            </button>
          )}
        </span>

        <button
          className={"meta-label-toggle" + (f.showLabel ? " on" : "")}
          disabled={!editing}
          tabIndex={editing ? undefined : -1}
          aria-hidden={!editing || undefined}
          data-tip={
            !editing
              ? undefined
              : f.showLabel
                ? "Showing the label with the value on the card"
                : "Showing the value alone on the card"
          }
          onClick={() => ops.setField(f.id, { showLabel: !f.showLabel })}
        >
          label
        </button>
        <button
          className="info-tag-remove"
          disabled={!editing}
          tabIndex={editing ? undefined : -1}
          aria-hidden={!editing || undefined}
          data-tip={editing ? "Delete category" : undefined}
          aria-label={`Delete the category ${f.name || "unnamed"}`}
          onClick={() => removeCategory(f.id, f.name)}
        >
          <X size={12} />
        </button>
      </div>
    );
  };

  return (
    <FloatPanel
      title={summonedEmpty ? "Metadata" : `${level?.name || "Card"} metadata`}
      className="meta-panel"
      x={left}
      y={top}
      width={META_W}
      onMove={metaPanel.moveTo}
      onClose={metaPanel.close}
      /* Parked while pinned: a click on the board or in the other panel
       * no longer takes it down, which is the whole point of pinning it
       * (ui/FloatPanel.tsx's `sticky`, the shortcut legend's mode). Its
       * X and Done still close it, and so does unpinning and clicking
       * away. */
      sticky={metaPinned}
      /* the pin is FloatPanel's own (2026-09-11); the tip sentence is his
       * (2026-09-10), one for both states */
      pin={{
        on: metaPinned,
        toggle: () => setSetting("", "metaPinned", !metaPinned),
        tip: "Pin window",
      }}
      done
    >
      {/* THE CARD'S NAME, CENTERED, WITH A WAY OUT EITHER SIDE (owner,
          2026-09-10). The discs are the seam's discs wearing chevrons
          instead of pluses -- same circle, same tier fill from the
          legend, same idea that a tier has a color you already know --
          because "which tier does this act on" is a question the board
          has taught the answer to once already, and teaching it twice in
          two shapes would be the drift this codebase keeps paying for.

          LEFT STEPS BACK, RIGHT STEPS FORWARD, and each side lists the
          reachable tiers in the SAME order (parent, own, child), so a
          given tier is always the same position within its group rather
          than mirroring and making you find it twice.

          A disc with nowhere to go stays, disabled -- the row is a shape
          you learn, and one vanishing at the first card of a board would
          shift the others under the pointer. Disabled is dimmed BY COLOR,
          never opacity: opacity on an element flattens the `::after` its
          tip is drawn with. */}
      {/* THE BODY, which is everything the empty state makes inert. The
          header row (drag, pin, close) is FloatPanel's own and sits
          outside this, and so does Done -- the three things he asked to
          keep working. */}
      <div className={"meta-body" + (blank ? " blank" : "")} aria-hidden={blank || undefined}>
        <div className="info-card-head">
          <span className="hop-group">
            {hops.map((h) => (
              <HopDisc key={`p${h.tier}`} board={board} hop={h} dir="prev" open={open} onGoTo={onGoTo} />
            ))}
          </span>
          {/* THE NAME GOES WITH THE CARD (owner-reported 2026-09-10:
              deselecting left "the old cards' info loaded in"). Keeping
              the last card's CONTENTS is the point of the empty state --
              the box does not collapse while you pick the next one -- but
              its NAME is the one thing that says WHICH card this is, and
              a stale name over a preview reading "No card loaded" is two
              answers to one question. */}
          <div className="info-card-title" title={blank ? undefined : subjectLabel(ids.length, level?.name ?? "Card", node.title)}>
            {blank ? (
              <em className="info-empty">No card</em>
            ) : many ? (
              subjectLabel(ids.length, level?.name ?? "Card", node.title)
            ) : (
              node.title || <em className="info-empty">Untitled</em>
            )}
          </div>
          <span className="hop-group">
            {hops.map((h) => (
              <HopDisc key={`n${h.tier}`} board={board} hop={h} dir="next" open={open} onGoTo={onGoTo} />
            ))}
          </span>
        </div>

        {/* 1. the card, and where its values go. Underneath the zones sits
            the REAL card -- true title size, true slot values (CardSlots) --
            so what the preview shows is what the board shows. The zones stop
            echoing a slot's VALUE for the same reason: the card underneath
            already renders it, in place, at its real size; a zone only names
            a placed-but-blank category, which draws nothing on a card. */}
        <div
          className={"slot-preview" + (dragField ? " dropping" : "")}
          style={{ width: prevW, height: prevH, background: c.bg, borderColor: c.border, color: txt }}
        >
          {blank && <div className="slot-preview-none mono">No card loaded</div>}
          {geo && !blank && (
            <div className="slot-preview-card" aria-hidden>
              <MiniCard
                text={node.title}
                fontClassName={fontClass(node.font ?? level?.defaultFont)}
                geo={geo}
                targetH={geo.detailH * k}
                bg="transparent"
                border="transparent"
                color={txt}
                slotNode={node}
                /* The picture too. This preview's whole job is "here is
                   your real card", and it was the one such surface that
                   drew the card without it -- so a card wearing a photo
                   previewed as a bare color, and you aimed your slots at
                   a background that is not the one they land on. Above
                   any size gate by construction: the preview is a card at
                   readable size, which is the same reason the Overview's
                   hover card passes it unconditionally. */
                imageNode={node}
                /* THE WORDS MATCH THE CARD (owner-reported 2026-09-10: the
                   preview "is correctly rendering the text color as black
                   when i've got side-by-side turned on, but it's also
                   adding a drop shadow ... which doesn't happen in
                   side-by-side mode").

                   The rule is `plainText` and it is now stated once
                   (board/cardText.ts): a picture standing BESIDE the card
                   leaves the words on paper, exactly as the board's images
                   switch being off does, and neither wants the shadow that
                   was written for type over a photograph. This preview had
                   grown a shorter copy of the question and answered it
                   wrong. */
                plain={plainText(node, cardImages)}
                fields={fields}
              />
            </div>
          )}
          {SLOT_IDS.map((slot) => {
            /* the SET's answer for the slot: a category they all put
               there, MIXED when they differ (a click clears it on all) */
            const at = sharedSlot(nodes, slot);
            const fieldId = at.mixed ? undefined : at.value;
            const field = fields.find((f) => f.id === fieldId);
            const value = fieldId ? node.values?.[fieldId] : undefined;
            return (
              <span
                key={slot}
                className={
                  "slot-zone slot-zone-" +
                  slot +
                  (overSlot === slot ? " over" : "") +
                  (field ? " filled" : "") +
                  (at.mixed ? " mixed" : "")
                }
                title={field ? `${field.name} -- click to clear` : at.mixed ? "Mixed -- click to clear on every card" : SLOT_LABELS[slot]}
                onDragOver={(e) => {
                  if (!dragRef.current) return;
                  e.preventDefault();
                  setOverSlot(slot);
                }}
                onDragLeave={() => setOverSlot((s) => (s === slot ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(slot, e);
                }}
                onClick={() => (field || at.mixed) && ops.setNodeSlot(ids, slot, null)}
              >
                {at.mixed ? "Mixed" : field && !(value ?? "").trim() ? field.name : ""}
              </span>
            );
          })}
        </div>

        {/* One card's layout, pushed to its neighbours. Reads as a SENTENCE
            with two controls in it -- "Apply | layout to every beat in this |
            scene" -- rather than a button whose label runs into a dropdown.
            Only the last word varies, so only the last word is a menu, and
            only the verb is a button.
            The tier is fixed, not chosen: applyLayout copies onto cards at
            THIS card's tier, so naming it is the sentence's job, not a
            control's. The menu holds only containers of this card -- its
            ancestors nearest-first, then the whole board -- because those
            are the only scopes that can contain cards of this tier. One
            word each: the ancestor's TIER, not its title. */}
        <div className="slot-apply slot-apply-layout">
          <button
            className="slot-apply-btn"
            onClick={applyLayout}
          >
            Apply
          </button>
          {/* The tier is the one word in the sentence that changes with the
              card you opened this from, so it carries the emphasis -- it is
              what tells you WHAT is about to be rewritten. Uppercased in CSS
              rather than in the string, so the tier's actual name (which the
              user may have renamed) stays intact for screen readers. */}
          {/* THREE PARTS, so the ellipsis lands MID-sentence (owner's ask).
              The tier name is the only variable-length word, and "in this"
              has to stay put against the menu it introduces -- truncating
              the span as a whole ate the tail first, which read as a broken
              sentence rather than a shortened name. */}
          <span className="slot-apply-text">
            {/* LAYOUT and VALUES carry the same weight as the tier: the two
                sentences differ in exactly one word, and it was the quietest
                thing in either of them. Bold and capitalised, they are what
                you read first, which is what stops a hand landing on the
                wrong Apply. */}
            <span className="slot-apply-lead">
              {/* "above" is the layout sentence's qualifier, the twin of
                  "selected" in the values one: it points at the card
                  preview directly overhead, which IS the layout being
                  copied. Both sentences now read
                  "Apply <qualifier> <NOUN> to every <TIER> in this". */}
              above <b className="slot-apply-what">layout</b> to every
            </span>
            <b className="slot-apply-tier">{level?.name ?? "card"}</b>
            <span className="slot-apply-tail">in this</span>
          </span>
          <select
            className="slot-apply-scope"
            aria-label="Which cards to apply the layout to"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            {/* widest first, narrowest last: `ancestors` comes nearest-first,
                so it reverses here. Reading down the menu narrows the blast
                radius, which is the order you want to think in. */}
            <option value="">board</option>
            {[...ancestors].reverse().map((a) => (
              <option key={a.node.id} value={a.node.id}>
                {board?.levels[a.depth]?.name.toLowerCase() ?? "group"}
              </option>
            ))}
          </select>
        </div>
        {applied && <div className="info-empty-row">{applied}</div>}

        {/* 2. the categories */}
        <div className="options-group mono">
          Metadata
          {/* The two facts people need here do not fit on the header line,
              and they are the things nobody guesses: that a CATEGORY is
              project-wide while a VALUE is this card's, and that the grip
              does two jobs. So the header keeps one word and the rest is a
              chip you can ask. Native title, like every other explanation
              in this app -- no new tooltip machinery for one string. */}
          <span className="meta-info" tabIndex={0} role="note" aria-label={META_HELP}>
            <HelpCircle size={14} />
            <span className="meta-tip" role="tooltip">
              {META_HELP_LINES.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </span>
          </span>
          <button
            className={"panel-edit-toggle" + (editing ? " active" : "")}
            aria-label={editing ? "Done editing categories" : "Add, rename or delete categories"} data-tip={editing ? "Done editing categories" : "Add, rename or delete categories"}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? <Check size={12} /> : <Pencil size={11} />}
            {editing ? "done" : "edit"}
          </button>
        </div>
        {fields.length === 0 && (
          <div className="info-empty-row">
            No categories yet. Hit <b>edit</b> to add one -- it then appears on every card, ready to
            fill in.
          </div>
        )}
        {/* ONE flat list. An earlier version split these into "on this board"
            and "elsewhere in this project", which the owner had removed: the
            group header directly above already says these are shared across
            the project, so splitting them by board contradicts it and makes
            the reader wonder what the difference means. The legend still
            filters its TAGS by board -- that surface is for scanning, where
            a mark no card carries is noise. This one is for editing, where
            everything should just be here. */}
        {/* SHOWN IN BOTH MODES (owner, 2026-08-28). It used to be done-mode
            only, which moved every row up 15px the instant you hit edit --
            the same "you lose your place" complaint the one-row skeleton
            fixes, arriving from above the list instead of inside it. And it
            is now simply TRUE in both: edit mode still shows the values, so
            both columns still want naming. */}
        {fields.length > 0 && (
          /* Column headers, so the two halves of a row are named. The
             spacer stands in for the checkbox and the grip, so "Categories"
             lands over the names and "Values" over the boxes rather than
             floating at the panel edge. */
          <div className="meta-head mono">
            <span className="meta-head-spacer" />
            <span className="meta-head-cat">Categories</span>
            <span className="meta-head-val">Values</span>
          </div>
        )}
        {fields.length > 0 && (
          <div className={"meta-rows" + (editing ? " meta-rows-edit" : "")}>{fields.map(row)}</div>
        )}
        {editing && (
          <button
            className="options-structure-btn"
            onClick={() => setJustAdded(ops.addField())}
          >
            <Plus size={13} /> Add metadata category
          </button>
        )}

        {/* The twin of the layout apply above, in the same sentence shape so
            the pair reads as one idea: one pushes WHERE values sit, this
            pushes the values themselves. It exists because a selection can't
            always reach the cards you mean -- Cmd-click spans scenes fine,
            but not the couple of hundred beats in a reel. */}
        {!editing && fields.length > 0 && (
          <>
            <div className="slot-apply slot-apply-values">
              <button
                className="slot-apply-btn"
                disabled={picked.size === 0}
                onClick={applyValues}
                data-tip={
                  picked.size === 0
                    ? "Tick a category above first"
                    : "Copy the ticked values onto other cards at this tier"
                }
              >
                Apply
              </button>
              <span className="slot-apply-text">
                {/* "selected VALUES" -- the noun named like the layout
                    sentence names its own, and "selected" kept because it
                    is what tells you the checkboxes decide what travels. */}
                <span className="slot-apply-lead">
                  selected <b className="slot-apply-what">values</b> to every
                </span>
                <b className="slot-apply-tier">{level?.name ?? "card"}</b>
                <span className="slot-apply-tail">in this</span>
              </span>
              <select
                className="slot-apply-scope"
                aria-label="Which cards to apply the values to"
                value={valueScope}
                onChange={(e) => setValueScope(e.target.value)}
              >
                <option value="">board</option>
                {[...ancestors].reverse().map((a) => (
                  <option key={a.node.id} value={a.node.id}>
                    {board?.levels[a.depth]?.name.toLowerCase() ?? "group"}
                  </option>
                ))}
              </select>
            </div>
            {appliedValues && <div className="info-empty-row">{appliedValues}</div>}
          </>
        )}

        {/* 3. this card's tags */}
        <div className="options-group mono">
          <TagIcon size={11} /> Tags
          {applies.length > 0 && <span className="options-group-sub">{applies.length}</span>}
        </div>
        {applies.length === 0 ? (
          <div className="info-empty-row">No tags. Drag one from the legend onto a card to apply it.</div>
        ) : (
          <ul className="info-tags">
            {applies.map((t) => {
              const share = tagShare(nodes, t.id);
              const partial = many && share.on < share.of;
              return (
              <li key={t.id} className={"info-tag" + (partial ? " partial" : "")}>
                <TagSwatch tag={t} />
                <span className="info-tag-name">{t.name || <em className="info-empty">unnamed</em>}</span>
                {/* on SOME of the set: say how many, so removing it
                    reads as what it is -- taking it off all of them */}
                {partial && <span className="info-tag-share mono">{share.on} of {share.of}</span>}
                <button
                  className="info-tag-remove"
                  data-tip={many ? "Remove tag from every card" : "Remove tag"}
                  aria-label={`Remove ${t.name || "unnamed"} from ${many ? "these cards" : "this card"}`}
                  onClick={() => ops.setNodeTag(ids, t.id, false)}
                >
                  <X size={12} />
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </div>
    </FloatPanel>
  );
}
