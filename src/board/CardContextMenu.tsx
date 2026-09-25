import { Children, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Archive,
  ChevronsDown,
  ChevronsUp,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  CornerDownLeft,
  Files,
  Image as ImageIcon,
  Layers,
  Link2,
  Link2Off,
  ListPlus,
  Pencil,
  Scissors,
  SquareArrowOutUpRight,
  StickyNote,
  Tag as TagIcon,
  Trash2,
  Type,
} from "lucide-react";
import type { Node } from "../state/types";
import { ops, useBoard, useLegend } from "../state/useBoard";
import { cardMenu, useCardMenu } from "./cardMenu";
import { imagePanel, metaPanel, pasteValues, textPanel, openNoteFor } from "./cardPanels";
import { demoteMenu } from "./demoteMenu";
import { editCard } from "./autoEdit";
import { promoteMenu } from "./promoteMenu";
import { metaClipboard, useMetaClip } from "./metaClipboard";
import { selection } from "./selection";
import { clipboard, usePasteCount } from "./clipboard";
import { useClampToViewport } from "../ui/useClampToViewport";
import { nestPicker } from "./nestPicker";
import { useBoardVocab } from "./boardVocab";
import { useNewColors } from "./newColors";
import { openNested } from "./openNested";

/* How many nodes sit at (or below) node-relative depth `cut` -- the
 * content a demotion would push past the leaf tier. Feeds the Demotion
 * dialog's counts; whole subtrees count, since deleting removes them
 * wholesale (stowed-inside-stowed included). */
function displacedCount(n: Node, cut: number, r = 0): number {
  if (r >= cut) return 1 + n.children.reduce((sum, c) => sum + displacedCount(c, cut, r + 1), 0);
  return n.children.reduce((sum, c) => sum + displacedCount(c, cut, r + 1), 0);
}

/* Everything under a node, at every depth -- what converting it into a
 * nesting card would delete, so the confirm can name a number. Whole
 * subtrees count, because the deletion is wholesale. */
const countSubtree = (n: Node): number =>
  n.children.reduce((sum, c) => sum + 1 + countSubtree(c), 0);

/* A stowed subtree, flattened for the plainest-possible outline. */
function outline(nodes: Node[], depth = 0): { title: string; depth: number }[] {
  return nodes.flatMap((n) => [{ title: n.title, depth }, ...outline(n.children, depth + 1)]);
}
const countStowed = (n: Node): number => outline(n.children).length;

/* One block of related entries, with a rule drawn between blocks.
 *
 * It returns NULL when nothing inside it rendered, which is what keeps
 * the dividers honest: almost every entry here is conditional, so a menu
 * on a plain beat card and one on a nesting card show completely
 * different sets. Wrappers that stayed in the DOM would leave a rule
 * with nothing under it, or two rules together. `React.Children.toArray`
 * already drops the `false` a `{cond && ...}` leaves behind, so counting
 * what survives is the whole test. */
function Group({ children }: { children: ReactNode }) {
  const kids = Children.toArray(children).filter(Boolean);
  if (!kids.length) return null;
  return <div className="ctx-group">{kids}</div>;
}

/* Right-click menu for a card (spec Sec 7): recolor, open the card's info
 * panel, duplicate, delete. Rendered once (see BoardView); position +
 * target come from the cardMenu store.
 *
 * Notes used to be an inline textarea swapped in over this menu. They
 * moved to the info panel (InfoPanelPopover) -- one surface for
 * everything about a card, so notes, tags and the coming scalar fields
 * aren't three different doors. */
export function CardContextMenu() {
  const menu = useCardMenu();
  // paste matches on ROLE height (distance above this board's leaf), so a
  // clip cut on one ladder pastes at the same rung of any other
  const menuBoard = useBoard(menu?.boardId ?? "");
  const menuHeight =
    menu && menuBoard ? menuBoard.levels.length - 1 - menu.depth : -1;
  const pasteCount = usePasteCount(menuHeight);
  // the menu carries its target's board -- it renders above the panes, so
  // there's no single pane context to read (split view)
  const boardId = menu?.boardId ?? "";
  const legend = useLegend(boardId);
  const metaClip = useMetaClip();
  const board = useBoard(boardId);
  /* THE SWATCHES ARE THIS BOARD'S LEGEND ROW (owner, 2026-09-04: "we
   * should only see the colors in the current board's legend"). The
   * projected legend carries the whole project palette (ADR 0006); the
   * menu shows the tier defaults, the nesting fill, the overrides this
   * board's cards wear or that were made this session -- and the card's
   * own color, so the active ring always has a swatch under it. Hooks,
   * so above the early return. */
  const vocab = useBoardVocab(board);
  const fresh = useNewColors(board?.id ?? "");
  const ref = useRef<HTMLDivElement>(null);
  /* Walking the swatches RECOLORS the card as you go (owner's call): the
   * point of stepping through colors is seeing them on the board, so the
   * keyboard shouldn't make you commit blind. The menu's node is a
   * snapshot taken when it opened, so the applied color is tracked here
   * too or the "active" ring would sit on the color you started from. */
  const [colorNow, setColorNow] = useState<string | null>(null);
  // reset per OPENING (the store mints a new state object each time), not
  // per node: reopening on the same card after an undo must re-read it
  useEffect(() => setColorNow(null), [menu]);

  /* The menu owns the keyboard while it's up (keyNav's overlay guard sees
   * `.ctx-menu` and stands down), so it has to be walkable: Up/Down step
   * the items, Left/Right step the color swatches -- one row, so a
   * horizontal key is the way in and out of it -- Enter/Space press the
   * focused item natively, Escape leaves. Opening focuses the first item,
   * which is also what makes Escape work after a right-click. */
  useEffect(() => {
    if (!menu) return;
    const q = <T extends HTMLElement>(sel: string): T[] =>
      Array.from(ref.current?.querySelectorAll<T>(sel) ?? []);
    const items = () => q<HTMLButtonElement>("button.ctx-item");
    const swatches = () => q<HTMLButtonElement>(".ctx-swatches .swatch");
    const step = (list: HTMLElement[], from: number, by: number) => {
      if (!list.length) return;
      const i = from < 0 ? (by > 0 ? 0 : list.length - 1) : (from + by + list.length) % list.length;
      list[i].focus();
    };

    items()[0]?.focus();

    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) cardMenu.close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cardMenu.close();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const sw = swatches();
      const inSwatches = Boolean(active && sw.includes(active as HTMLButtonElement));
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = items();
        // leaving the swatch row lands on the items, whichever way you go
        if (inSwatches) list[0]?.focus();
        else step(list, list.indexOf(active as HTMLButtonElement), e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (!sw.length) return;
        e.preventDefault();
        if (!inSwatches) {
          // entering the row only takes you to the current color -- it
          // must not change anything, or reaching for the swatches would
          // itself be an edit (and a card whose color isn't IN the row
          // has no active swatch to land on, so it would land on Default)
          (sw.find((s) => s.classList.contains("active")) ?? sw[0]).focus();
          return;
        }
        step(sw, sw.indexOf(active as HTMLButtonElement), e.key === "ArrowRight" ? 1 : -1);
        // ...but every step WITHIN the row paints the card. Stepping
        // through colors is for seeing them on the board; it can't wait
        // for Enter. Rapid steps merge into one undo (captureTimeout).
        const entry = (document.activeElement as HTMLElement | null)?.dataset.entry;
        if (entry !== undefined) {
          const ids =
            selection.has(menu.node.id) && selection.size() > 1
              ? selection.ids()
              : [menu.node.id];
          ops.setNodesColor(ids, entry);
          setColorNow(entry);
        }
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  /* Keep it on screen by MEASURING it: this menu's height swings by
   * hundreds of pixels (Stack, Paste, Promote, Demote, a Stowed
   * outline), so the old fixed guess ran it off the bottom of the
   * window. Corrected in a layout effect, i.e. before paint.
   *
   * ABOVE the early return, because it's a hook -- putting it beside the
   * old clamp (which lived below) would change the hook count between a
   * closed and an open menu. */
  const W = 210; // room for "Copy cards (12) (with children)" on one line
  const { left, top } = useClampToViewport(ref, menu?.x ?? 0, menu?.y ?? 0, { w: W, h: 156 });

  if (!menu) return null;
  const { node, x, y, stackedIds, parentId, index, depth, colorable } = menu;
  const activeColor = colorNow ?? node.color ?? "";
  const swatchShown = legend.filter(
    (e) => e.tier || e.role || vocab.colorIds.has(e.id) || fresh.has(e.id) || e.id === activeColor,
  );
  // tier defaults first, in the legend's order, then the rest -- the
  // board's own list appends a tier added later after the nesting fill
  const swatchLegend = [...swatchShown.filter((e) => e.tier), ...swatchShown.filter((e) => !e.tier)];
  const canStack = selection.has(node.id) && selection.size() > 1;
  /* Graduation (owner's design): a node CONVERTS to the neighbouring
   * tier, subtree riding along, everything it carries porting. Promote
   * needs a parent tier; demote needs a tier below AND a sibling to tuck
   * into. Sibling count comes from the snapshot -- the menu's index is
   * where the node sits, not how many neighbours it has. */
  const leaf = (board?.levels.length ?? 1) - 1;
  const promoteTo = depth > 0 ? board?.levels[depth - 1]?.name : undefined;
  const demoteTo = depth < leaf ? board?.levels[depth + 1]?.name : undefined;
  const parentNode = (() => {
    if (!board || parentId === null) return null;
    const findIn = (nodes: Node[]): Node | null => {
      for (const n of nodes) {
        if (n.id === parentId) return n;
        const hit = findIn(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return findIn(board.roots);
  })();
  const siblingCount = parentId === null ? (board?.roots.length ?? 0) : (parentNode?.children.length ?? 0);
  // cut the whole selection when the right-clicked node is part of it
  const cutIds = selection.has(node.id) && selection.size() > 1 ? selection.ids() : [node.id];
  // ...and untag it the same way: a selection untags together
  const tagIds = cutIds;


  return (
    <div ref={ref} className={"ctx-menu" + (menu.keyed ? " keyed" : "")} style={{ left, top, width: W }}>
      {/* Color first, because it is the one thing you do to a card without
   opening anything. */}
      <Group>
        {colorable && (
          <div className="ctx-swatches">
            {/* A swatch paints the whole SELECTION when the card you
                right-clicked is part of it -- the rule Cut and Remove-tags
                already follow, and what "recolor these six scenes" needs
                to mean. On an unselected card it's just that one. */}
            <button
              className={"swatch swatch-default" + (!activeColor ? " active" : "")}
              aria-label={"Default (no color)" + (cutIds.length > 1 ? ` (${cutIds.length} cards)` : "")} data-tip={"Default (no color)" + (cutIds.length > 1 ? ` (${cutIds.length} cards)` : "")}
              data-entry=""
              onClick={() => {
                ops.setNodesColor(cutIds, "");
                cardMenu.close();
              }}
            />
            {swatchLegend.map((e) => (
              <button
                key={e.id}
                className={"swatch" + (activeColor === e.id ? " active" : "")}
                aria-label={e.label + (cutIds.length > 1 ? ` (${cutIds.length} cards)` : "")} data-tip={e.label + (cutIds.length > 1 ? ` (${cutIds.length} cards)` : "")}
                data-entry={e.id}
                style={{ background: e.bg, borderColor: e.border }}
                onClick={() => {
                  ops.setNodesColor(cutIds, e.id);
                  cardMenu.close();
                }}
              />
            ))}
          </div>
        )}
      </Group>
      {/* HOW THE CARD LOOKS, AND WHAT IT IS (owner, 2026-09-01): the
   picture, the words on it, and what it stands in for. Notes moved OUT
   of this group and in with the metadata, where it belongs -- a note is
   something written ABOUT the card, like its values, rather than part of
   how the card appears. */}
      <Group>
        {/* THE THIRD DOOR, between its two neighbours (owner, 2026-08-26).
            One entry whether or not the card has an image -- the panel
            shows a big Add button when empty, which is one rule rather
            than a menu that changes what it says. */}
        <button
          className="ctx-item"
          onClick={() => {
            imagePanel.open(node.id, boardId, depth, x, y);
            cardMenu.close();
          }}
        >
          <ImageIcon size={14} /> Image...
        </button>
        {/* TEXT OVERRIDES, beside the picture rather than inside it
            (owner, 2026-09-01). It began as a justification control in
            the Image panel and outgrew that immediately: color, size,
            typeface, shadow and position are properties of the WORDS,
            true whether or not the card carries a photo. Putting them
            under "Image" would have been a second hidden rule -- you
            would have to have an image to reach them. */}
        <button
          className="ctx-item"
          onClick={() => {
            // on the SELECTION when this card is part of one (the color
            // swatches' rule) -- board/groupEdit.ts
            textPanel.open(node.id, boardId, depth, x, y, { ids: cutIds });
            cardMenu.close();
          }}
        >
          <Type size={14} /> Text overrides...{cutIds.length > 1 ? ` (${cutIds.length} cards)` : ""}
        </button>
        {/* NESTED BOARDS (docs/explorations/board-shapes.md, DECISIONS 3).
            The entries differ by state rather than piling up: a plain card
            offers the conversion, a nesting card offers the three things
            you can do to a link. Renaming is here because a nesting card
            shows the TARGET'S live title, so the only honest way to change
            what it says is to rename the board. */}
        {node.boardRef ? (
          <>
            <button
              className="ctx-item"
              onClick={() => {
                cardMenu.close();
                openNested.ask(node.boardRef!, x, y);
              }}
            >
              <SquareArrowOutUpRight size={14} /> Open...
            </button>
            <button
              className="ctx-item"
              onClick={() => {
                cardMenu.close();
                nestPicker.open({ mode: "rename", nodeId: node.id, boardId, childCount: 0, targetId: node.boardRef!, x, y });
              }}
            >
              <Pencil size={14} /> Rename board...
            </button>
            <button
              className="ctx-item"
              onClick={() => {
                cardMenu.close();
                // a relink has no children to lose -- a nested node has none
                nestPicker.open({ mode: "pick", nodeId: node.id, boardId, childCount: 0, targetId: "", x, y });
              }}
            >
              <Link2 size={14} /> Relink...
            </button>
            <button
              className="ctx-item"
              onClick={() => {
                cardMenu.close();
                /* Un-nesting is not destructive -- the target board is
                   untouched (a reference, never containment) and the card
                   gets its own title back -- so it asks nothing. */
                ops.unnestNode(node.id);
              }}
            >
              <Link2Off size={14} /> Un-nest
            </button>
          </>
        ) : (
          <button
            className="ctx-item"
            onClick={() => {
              cardMenu.close();
              nestPicker.open({
                mode: "pick",
                nodeId: node.id,
                boardId,
                childCount: countSubtree(node),
                targetId: "",
                x,
                y,
              });
            }}
          >
            <Link2 size={14} /> Nested board...
          </button>
        )}
      </Group>
      {/* EVERYTHING METADATA, together (owner's ask). The panel, and the
   two halves of the bulk workflow that were previously stranded
   further down the menu. */}
      <Group>
        {/* The note leads this group (owner, 2026-09-01). It is the
            other thing written ABOUT a card, and it reads as one list
            with the values rather than as chrome beside the picture. */}
        <button
          className="ctx-item"
          onClick={() => {
            // the column when Notes is open on this board, else the popover
            openNoteFor(node.id, boardId, depth, x, y);
            cardMenu.close();
          }}
        >
          <StickyNote size={14} /> {node.notes ? "Note" : "Notes..."}
        </button>
        <button
          className="ctx-item"
          onClick={() => {
            metaPanel.open(node.id, boardId, depth, x, y, { ids: cutIds });
            cardMenu.close();
          }}
        >
          <ListPlus size={14} /> More metadata...{cutIds.length > 1 ? ` (${cutIds.length} cards)` : ""}
        </button>
        {/* the bulk metadata workflow: copy one card's values, select the
            cards to fill, paste the ones you pick. Named for what they move,
            since the card clipboard (Cut/Paste) is a different thing. */}
        <button
          className="ctx-item"
          onClick={() => {
            metaClipboard.copy(node);
            cardMenu.close();
          }}
        >
          <ClipboardCopy size={14} /> Copy metadata values
        </button>
        {metaClip && (
          <button
            className="ctx-item"
            onClick={() => {
              pasteValues.open(cutIds, x, y);
              cardMenu.close();
            }}
          >
            <ClipboardPaste size={14} /> Paste metadata values...
            {cutIds.length > 1 ? ` (${cutIds.length} cards)` : ""}
          </button>
        )}
      </Group>
      {/* Tags, which are their own vocabulary (ADR 0002). */}
      <Group>
        {(node.tags?.length ?? 0) > 0 && (
          <button
            className="ctx-item"
            onClick={() => {
              // detaches from this card; the tags themselves stay in the
              // project (the info panel takes them off one at a time)
              ops.clearNodeTags(tagIds);
              cardMenu.close();
            }}
          >
            <TagIcon size={14} /> Remove {node.tags!.length === 1 ? "tag" : "all tags"}
            {tagIds.length > 1 ? ` (${tagIds.length} cards)` : ""}
          </button>
        )}
      </Group>
      {/* The card's place in the structure: what it is stacked with, where
   it breaks a row, and which rung it sits on. */}
      <Group>
        {canStack && (
          <button
            className="ctx-item"
            onClick={() => {
              ops.stack(selection.ids());
              selection.clear();
              cardMenu.close();
            }}
          >
            <Layers size={14} /> Stack ({selection.size()})
          </button>
        )}
        {stackedIds.length > 0 && (
          <button
            className="ctx-item"
            onClick={() => {
              ops.setHidden(stackedIds, false);
              cardMenu.close();
            }}
          >
            <Layers size={14} /> Unstack ({stackedIds.length})
          </button>
        )}
        {/* A ROW BREAK IS A BEAT STRIP'S IDEA -- where a wrapped row of
            cards is cut -- and only the Beat Map has strips. On a Columns
            board or a Free Grid the entry would toggle a flag nothing
            reads. (On a one-rung grid ladder the leaf test is trivially
            true, which is how it turned up there.) */}
        {board && !board.type && depth === board.levels.length - 1 && (
          <button
            className="ctx-item"
            onClick={() => {
              ops.toggleBreak(node.id);
              cardMenu.close();
            }}
          >
            <CornerDownLeft size={14} /> {node.breakAfter ? "Remove row break" : "Row break after"}
          </button>
        )}
        {promoteTo && (
          <button
            className="ctx-item"
            onClick={() => {
              cardMenu.close();
              /* Placement preserves reading order. First/last children need
               * no ceremony (land before/after the parent); a card
               * SURROUNDED by siblings gets the choice -- split the parent
               * around it, or jump out whole (PromotePopover). */
              if (index === 0 || siblingCount <= 1) {
                ops.promoteNode(node.id, index === 0 && siblingCount > 1 ? "before" : "after");
              } else if (index === siblingCount - 1) {
                ops.promoteNode(node.id, "after");
              } else {
                promoteMenu.open({
                  nodeId: node.id,
                  x,
                  y,
                  title: node.title,
                  tierName: promoteTo,
                  parentTitle: parentNode?.title ?? "",
                  parentTierName: promoteTo,
                  before: index,
                  after: siblingCount - 1 - index,
                  childName: board?.levels[depth]?.name ?? "card",
                });
              }
            }}
          >
            <ChevronsUp size={14} /> Promote to {promoteTo}
            {index > 0 && siblingCount > 1 && index < siblingCount - 1 ? "..." : ""}
          </button>
        )}
        {/* STOWED content lives in the menu now (owner's call -- the
            on-card chip is gone): the count, and a hover submenu showing
            the dormant tree as the plainest possible outline. */}
        {depth === leaf && node.children.length > 0 && (
          <div className="ctx-item ctx-sub">
            <Archive size={14} /> Stowed ({countStowed(node)})
            <span className="ctx-sub-arrow">›</span>
            <div className="ctx-submenu">
              {outline(node.children).map((line, i) => (
                <div key={i} className="ctx-outline-line" style={{ paddingLeft: 8 + line.depth * 12 }}>
                  - {line.title || "(untitled)"}
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Graduation is RARE (owner's call), so the menu carries exactly
            ONE demote entry and every choice -- where it lands, what
            happens to displaced leaves -- lives in the dialog. The "..."
            appears only when the dialog will; a demote with nothing to
            decide (only child, nothing displaced) just goes. */}
        {demoteTo &&
          (() => {
            const sibs = parentId === null ? (board?.roots ?? []) : (parentNode?.children ?? []);
            const neighbor = index > 0 ? sibs[index - 1] : sibs[index + 1];
            const count = displacedCount(node, leaf - depth);
            const needsDialog = Boolean(neighbor) || count > 0;
            return (
              <button
                className="ctx-item"
                onClick={() => {
                  cardMenu.close();
                  if (!needsDialog) {
                    const r = ops.demoteNode(node.id, "stow", "wrap");
                    if (r.wrapper) editCard(r.wrapper);
                    return;
                  }
                  demoteMenu.open({
                    nodeId: node.id,
                    x,
                    y,
                    title: node.title,
                    tierName: demoteTo,
                    childName: board?.levels[depth]?.name ?? "card",
                    leafName: board?.levels[leaf]?.name ?? "card",
                    count,
                    neighborTitle: neighbor ? neighbor.title : null,
                    neighborDir: index > 0 ? "previous" : "next",
                  });
                }}
              >
                <ChevronsDown size={14} /> Demote to {demoteTo}
                {needsDialog ? "..." : ""}
              </button>
            );
          })()}
      </Group>
      {/* The clipboard. */}
      <Group>
        <button
          className="ctx-item"
          onClick={() => {
            ops.duplicateNode(node.id);
            cardMenu.close();
          }}
        >
          <Copy size={14} /> Duplicate
        </button>
        {/* COPY sits beside Cut and takes the same set. It says "Copy
            card(s)" rather than "Copy" because this menu already carries
            "Copy metadata values" -- one word would be two meanings -- and
            it gets its OWN icon for the same reason: `Copy` is Duplicate
            here and `ClipboardCopy` is the metadata one, both taken. */}
        {/* SPLIT IN TWO when the card has children (owner, 2026-09-08):
            with them, or the card alone. A leaf keeps the one item. */}
        {node.children.length > 0 ? (
          <>
            <button
              className="ctx-item"
              onClick={() => {
                clipboard.copy(cutIds, true);
                cardMenu.close();
              }}
            >
              <Files size={14} /> Copy card{cutIds.length > 1 ? `s (${cutIds.length})` : ""} (with children)
            </button>
            <button
              className="ctx-item"
              onClick={() => {
                clipboard.copy(cutIds, false);
                cardMenu.close();
              }}
            >
              <Files size={14} /> Copy card{cutIds.length > 1 ? `s (${cutIds.length})` : ""} (no children)
            </button>
          </>
        ) : (
          <button
            className="ctx-item"
            onClick={() => {
              clipboard.copy(cutIds);
              cardMenu.close();
            }}
          >
            <Files size={14} /> Copy card{cutIds.length > 1 ? `s (${cutIds.length})` : ""}
          </button>
        )}
        <button
          className="ctx-item"
          onClick={() => {
            clipboard.cut(cutIds);
            selection.clear();
            cardMenu.close();
          }}
        >
          <Scissors size={14} /> Cut{cutIds.length > 1 ? ` (${cutIds.length})` : ""}
        </button>
        {pasteCount > 0 && (
          <button
            className="ctx-item"
            onClick={() => {
              clipboard.paste(parentId, index + 1, menuHeight, boardId);
              cardMenu.close();
            }}
          >
            <ClipboardPaste size={14} /> Paste ({pasteCount})
          </button>
        )}
      </Group>
      {/* Destructive, alone at the foot where it cannot be misfired. */}
      <Group>
        <button
          className="ctx-item danger"
          onClick={() => {
            /* the SELECTION, as the Delete key already does (keyNav) --
               the menu deleted one card while the key took the set,
               which the group-actions pass (2026-09-12) evened up */
            ops.delNodes(cutIds);
            if (cutIds.length > 1) selection.clear();
            cardMenu.close();
          }}
        >
          <Trash2 size={14} /> Delete{cutIds.length > 1 ? ` (${cutIds.length})` : ""}
        </button>
      </Group>
    </div>
  );
}
