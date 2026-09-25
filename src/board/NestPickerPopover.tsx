import { useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { useClampToViewport } from "../ui/useClampToViewport";
import { DraftInput } from "../ui/DraftInput";
import { confirmDialog } from "../ui/confirmDialog";
import { ops, useProject } from "../state/useBoard";
import { styleOf, styleName } from "../state/boardStyles";
import { boardLabel, sortBoards } from "./boardSort";
import { useSettings } from "../state/settings";
import { templatePicker } from "./TemplatePicker";
import { TypeIcon } from "./typeIcons";
import { nestPicker, useNestPicker } from "./nestPicker";

/* Which board this card stands in for -- and, in rename mode, what that
 * board is called.
 *
 * Every board is offered but ONE. A board that points back at this one
 * is a BACK-LINK -- a reason to nest rather than a hazard -- so cycles
 * are listed like anything else; the host board is grayed, because a
 * card meaning "go somewhere else" cannot point at where you already
 * are (state/nesting.ts has the argument). Shown with its reason rather
 * than left out: a list that quietly omits a board is a silent no. */
export function NestPickerPopover() {
  const ask = useNestPicker();
  const project = useProject();
  const settings = useSettings("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ask) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) nestPicker.close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      /* A focused text field's own Escape reverts it; a SECOND closes
       * the popover -- FloatPanel's two-stage rule, so renaming and then
       * changing your mind does not also throw the menu away. */
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      nestPicker.close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [ask]);

  const w = 250;
  const { left, top } = useClampToViewport(ref, ask?.x ?? 0, ask?.y ?? 0, { w, h: 200 });

  if (!ask) return null;

  if (ask.mode === "rename") {
    const board = project.boards.find((b) => b.id === ask.targetId);
    return (
      <div ref={ref} className="ctx-menu nest-picker" style={{ left, top, width: w }}>
        <div className="ctx-title">
          Rename board
          <span className="ctx-note-line">
            The card shows this name wherever the board is nested
          </span>
        </div>
        <DraftInput
          className="nest-rename"
          value={board?.title ?? ""}
          placeholder="Untitled board"
          ariaLabel="Board title"
          autoFocus
          selectAll
          onCommit={(v) => ops.setBoardTitle(ask.targetId, v)}
        />
      </div>
    );
  }

  /* Converting a node that HAS children deletes them (owner's rule --
   * "if you knew what you were doing, you'd just create a new node for
   * the purpose and it'll be empty already"). The dialog names the count
   * and says it is reversible, which ops.nestNode's single transaction is
   * what makes true. */
  const link = async (targetId: string) => {
    nestPicker.close();
    if (ask.childCount > 0) {
      const ok = await confirmDialog.ask({
        title: `Replace the ${ask.childCount === 1 ? "card" : `${ask.childCount} cards`} under this one with a nested board?`,
        body:
          `Everything under this card is deleted when it starts standing in for ` +
          `another board. One undo (Cmd-Z) puts it all back.`,
        confirmLabel: "Nest board",
      });
      if (!ok) return;
    }
    if (ask.onPick) ask.onPick(targetId);
    else ops.nestNode(ask.nodeId, targetId);
  };

  const boards = sortBoards(project.boards, settings.boardSort, settings.boardSortDir);

  return (
    <div ref={ref} className="ctx-menu nest-picker" style={{ left, top, width: w }}>
      <div className="ctx-title">
        Stand in for a board
        {ask.childCount > 0 && (
          <span className="ctx-note-line">
            Deletes the {ask.childCount === 1 ? "card" : `${ask.childCount} cards`} under this one
          </span>
        )}
      </div>
      <div className="nest-picker-list">
        {boards.map((b) => {
          const self = b.id === ask.boardId;
          return (
            <button
              key={b.id}
              className="ctx-item"
              disabled={self}
              onClick={() => link(b.id)}
            >
              <TypeIcon id={styleOf(b.type)} size={14} />
              <span className="ctx-stack">
                {boardLabel(b)}
                <span className="ctx-note-line">{self ? "This board" : styleName(b.type)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button
        className="ctx-item"
        onClick={() => {
          /* The template picker already knows how to make a board and
             hand back its id; nesting is just what we do with it. */
          const { nodeId, childCount, onPick } = ask;
          nestPicker.close();
          templatePicker.open(async (boardId) => {
            if (childCount > 0) {
              const ok = await confirmDialog.ask({
                title: `Replace the ${childCount === 1 ? "card" : `${childCount} cards`} under this one with the new board?`,
                body: "Everything under this card is deleted. One undo (Cmd-Z) puts it back.",
                confirmLabel: "Nest board",
              });
              if (!ok) return;
            }
            if (onPick) onPick(boardId);
            else ops.nestNode(nodeId, boardId);
          });
        }}
      >
        <Plus size={14} /> New board...
      </button>
    </div>
  );
}
