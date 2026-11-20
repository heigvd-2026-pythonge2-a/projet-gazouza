// Test helpers around the editor store.

import { useEditorStore, type GridPoint, type PlacedComponent } from "../store";

/** Puts the store back in its initial state (empty schematic, no history, select tool). */
export function resetEditorStore() {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
}

/** Adds a component as if dropped from the palette (it is then the selection) and returns it. */
export function dropComponent(type: string, position: GridPoint = { x: 0, y: 0 }): PlacedComponent {
  useEditorStore.getState().dropComponent(type, position);
  return useEditorStore.getState().doc.components.at(-1)!;
}

export const editorState = () => useEditorStore.getState();
