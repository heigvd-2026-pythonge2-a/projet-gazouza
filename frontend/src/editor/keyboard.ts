// Keyboard shortcuts of the schematic editor, listened to on the whole window. Their texts, shown
// in the shortcuts panel, are in `shortcuts.ts`: keep both in sync.

import { useEffect } from "react";

import { useEditorStore, type GridPoint } from "../store";
import { newFile, openFile, saveFile, saveFileAs } from "./fileActions";
import { entryForKey } from "./paletteLayout";

/** Grid step of each arrow key, to move the selection. */
export const ARROWS: Readonly<Record<string, GridPoint>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * Applies the editor action of a key press, and stops the browser's own action for it
 * (`preventDefault`). Keys typed in a text field, and keys the editor does not use, are left alone.
 */
export function handleEditorKey(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null;
  if (target?.closest?.("input, textarea, select, [contenteditable]")) return;
  const s = useEditorStore.getState();
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    // In a text field the browser's own undo, copy... apply instead (returned above).
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) s.undo();
    else if (key === "y" || (key === "z" && e.shiftKey)) s.redo();
    else if (key === "a") s.selectAll();
    else if (key === "c") s.copy();
    else if (key === "v") s.paste();
    else if (key === "d")
      s.duplicate(); // also keeps the browser from adding a bookmark
    else if (key === "n") void newFile();
    else if (key === "o") openFile();
    else if (key === "s" && e.shiftKey) saveFileAs();
    else if (key === "s") saveFile();
    else return;
    e.preventDefault();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const arrow = ARROWS[e.key];
  if (arrow) {
    if (s.tool.kind !== "select" || s.selection.length === 0) return;
    // Holding the key down repeats it: one undo step for the whole move.
    s.moveSelection(arrow, { merge: true });
    e.preventDefault();
    return;
  }
  // 1 to 9: the palette tool with that number.
  const entry = entryForKey(e.key);
  if (entry) {
    if (entry.kind === "wire") s.startWiring();
    else s.startPlacing(entry.def.type);
    e.preventDefault();
    return;
  }
  switch (e.key) {
    case "r":
    case "R":
      // Shift+R: by 45 degrees, for the components with two pins (#161).
      s.rotate(e.shiftKey ? 45 : 90);
      break;
    case "m":
    case "M":
      s.mirror();
      break;
    case "o":
    case "O":
      s.resetCaptions();
      break;
    case "w":
    case "W":
      s.startWiring();
      break;
    case "t":
    case "T":
      s.startText();
      break;
    case "p":
    case "P":
      s.startProbe();
      break;
    case "Delete":
    case "Backspace":
      s.deleteSelection();
      break;
    case "Escape":
      s.cancel();
      break;
    default:
      return;
  }
  e.preventDefault();
}

/** Listens to the editor's keyboard shortcuts while the calling component is mounted. */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    window.addEventListener("keydown", handleEditorKey);
    return () => window.removeEventListener("keydown", handleEditorKey);
  }, []);
}
