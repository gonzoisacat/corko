import { useCallback } from "react";
import { BoardShelf } from "./BoardsMenu";

/* ------------------------------------------------------------------ *
 *  THE OPEN BOARD DOOR (owner, 2026-09-10: "make Corko ask you what
 *  board you want to open if you're loading it for the first time in
 *  like at least 10 minutes, and take you back to what you last had
 *  open otherwise").
 *
 *  WHAT IT IS NOT: a new menu. It is board/BoardsMenu.tsx's shelf on a
 *  scrim -- the same folder tree, the same rows, the same tools, so
 *  duplicating a board before opening it, filing one, renaming one or
 *  starting a new one all work here because they work there. His ask
 *  was explicit about that ("you can do whatever in the open board menu
 *  that you can do in the current board menu"), and one component is the
 *  only way to keep it true a year from now.
 *
 *  WHY THE RESTORE STILL HAPPENS UNDERNEATH. App has already put your
 *  panes back by the time this draws (state/panes.ts), so the door is a
 *  question laid over a working app rather than a gate in front of a
 *  blank one. That is what makes dismissing it cheap -- Escape or a
 *  click on the scrim leaves you exactly where a reload would have --
 *  and it is why an empty project must never reach here: with no boards
 *  there is nothing behind the door and nothing in it, and that case is
 *  the landing picker's (App gates on it).
 *
 *  THE SPLASH COMES FIRST for free, no ordering code: it is an opaque
 *  overlay at z-index 400 over this scrim's 200 (main.tsx), so the door
 *  is simply what the splash fades to reveal.
 *
 *  Picking a board opens it in SINGLE view in the left pane (his call).
 *  Opening a board is a one-board gesture, and arriving in a split you
 *  did not ask for is the same surprise the first-run path already
 *  guards against.
 * ------------------------------------------------------------------ */
export function OpenBoardDoor({
  activeBoardId,
  onOpen,
  onDismiss,
}: {
  /* What the restore chose, so the board you last had is marked as the
   * one you are already on rather than the shelf looking untouched. */
  activeBoardId: string | null;
  onOpen: (id: string) => void;
  onDismiss: () => void;
}) {
  const select = useCallback(
    (id: string) => {
      onOpen(id);
      onDismiss();
    },
    [onOpen, onDismiss],
  );

  return (
    /* The scrim dismisses, which is this host's answer to "clicked
       elsewhere" -- the shelf itself only ever owns Escape. */
    <div className="tp-backdrop open-board-backdrop" onClick={onDismiss}>
      <div className="open-board-door" onClick={(e) => e.stopPropagation()}>
        <BoardShelf
          heading="Open Board"
          activeBoardId={activeBoardId}
          onSelect={select}
          onClose={onDismiss}
        />
      </div>
    </div>
  );
}
