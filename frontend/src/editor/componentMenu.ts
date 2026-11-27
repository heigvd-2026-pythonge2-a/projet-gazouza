// Actions of the menu opened by a right click on a component.

import { useEditorStore } from "../store";
import type { MenuItem } from "./ContextMenu";
import { focusInspector } from "./inspectorFocus";

/** Items of the component menu; they apply to the selection, of `selectionSize` items. */
export function componentMenu(selectionSize: number): MenuItem[] {
  const s = () => useEditorStore.getState();
  return [
    { label: "Tourner", shortcut: "R", keys: ["r"], onSelect: () => s().rotate() },
    {
      label: "Tourner de 45°",
      shortcut: "Maj+R",
      keys: ["R"],
      onSelect: () => s().rotate(45),
    },
    { label: "Miroir", shortcut: "M", keys: ["m", "M"], onSelect: () => s().mirror() },
    {
      label: "Replacer les textes automatiquement",
      shortcut: "O",
      keys: ["o", "O"],
      onSelect: () => s().resetCaptions(),
    },
    {
      label: "Dupliquer",
      shortcut: "Ctrl+D",
      keys: ["d", "D"],
      onSelect: () => s().duplicate(),
    },
    { label: "Copier", shortcut: "Ctrl+C", keys: ["c", "C"], onSelect: () => s().copy() },
    {
      label: "Supprimer",
      shortcut: "Suppr",
      keys: ["Delete", "Backspace"],
      onSelect: () => s().deleteSelection(),
    },
    {
      label: "Propriétés…",
      // The properties panel only shows the fields of a single component.
      disabled: selectionSize !== 1,
      // After the menu has closed and given the focus back to where it was.
      onSelect: () => setTimeout(() => focusInspector()),
    },
  ];
}
