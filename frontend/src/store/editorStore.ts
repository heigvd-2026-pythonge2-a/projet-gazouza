// Global editor state (Zustand). The document only changes through the pure operations of
// `document.ts`; UI state (selection, active tool) lives next to it but outside the document.

import { create } from "zustand";

import {
  addComponent,
  deleteItems,
  emptyDoc,
  mirrorComponents,
  moveComponent,
  rotateComponents,
  rotateCw,
  type EditorDoc,
  type GridPoint,
  type Rotation,
} from "./document";

export type Tool =
  { kind: "select" } | { kind: "place"; type: string; rotation: Rotation; mirror: boolean };

interface EditorState {
  doc: EditorDoc;
  selection: string[];
  tool: Tool;

  setTool: (tool: Tool) => void;
  /** Starts placing a component of this type (keeps placing until Escape). */
  startPlacing: (type: string) => void;
  /** Places the component of the active "place" tool at this grid position. */
  placeAt: (position: GridPoint) => void;
  moveComponent: (id: string, position: GridPoint) => void;
  /** Rotates the selection, or the component about to be placed. */
  rotate: () => void;
  /** Mirrors the selection, or the component about to be placed. */
  mirror: () => void;
  deleteSelection: () => void;
  select: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  /** Escape: leaves the place tool, or clears the selection. */
  cancel: () => void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  doc: emptyDoc(),
  selection: [],
  tool: { kind: "select" },

  setTool: (tool) => set({ tool }),

  startPlacing: (type) =>
    set({ tool: { kind: "place", type, rotation: 0, mirror: false }, selection: [] }),

  placeAt: (position) =>
    set((s) => {
      if (s.tool.kind !== "place") return {};
      const { type, rotation, mirror } = s.tool;
      const { doc } = addComponent(s.doc, { type, position, rotation, mirror });
      return { doc };
    }),

  moveComponent: (id, position) => set((s) => ({ doc: moveComponent(s.doc, id, position) })),

  rotate: () =>
    set((s) =>
      s.tool.kind === "place"
        ? { tool: { ...s.tool, rotation: rotateCw(s.tool.rotation) } }
        : { doc: rotateComponents(s.doc, new Set(s.selection)) },
    ),

  mirror: () =>
    set((s) =>
      s.tool.kind === "place"
        ? { tool: { ...s.tool, mirror: !s.tool.mirror } }
        : { doc: mirrorComponents(s.doc, new Set(s.selection)) },
    ),

  deleteSelection: () =>
    set((s) => ({ doc: deleteItems(s.doc, new Set(s.selection)), selection: [] })),

  select: (ids) => set({ selection: ids }),

  toggleSelected: (id) =>
    set((s) => ({
      selection: s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : [...s.selection, id],
    })),

  cancel: () =>
    set((s) => (s.tool.kind === "place" ? { tool: { kind: "select" } } : { selection: [] })),
}));
