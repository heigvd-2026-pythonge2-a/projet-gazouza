// Global editor state (Zustand). The document only changes through the pure operations of
// `document.ts`; UI state (selection, active tool) lives next to it but outside the document.

import { create } from "zustand";

import {
  addComponent,
  addWire,
  anchorAt,
  deleteItems,
  emptyDoc,
  mirrorComponents,
  moveComponent,
  rotateComponents,
  rotateCw,
  samePoint,
  type EditorDoc,
  type GridPoint,
  type Rotation,
} from "./document";

export type Tool =
  | { kind: "select" }
  | { kind: "place"; type: string; rotation: Rotation; mirror: boolean }
  | { kind: "wire" };

/** Wire being drawn: not part of the document until it is finished. */
export interface WireDraft {
  /**
   * Points clicked so far (grid units): the start, then one per click. The corners added by
   * `routeTo` between two clicks are not stored, so removing a click also removes its corner.
   */
  points: GridPoint[];
  /** The wire was started by pressing on a pin with the select tool: go back to it after. */
  returnToSelect: boolean;
}

/**
 * Route from `a` to `b` as seen while drawing: straight if aligned, else horizontal then
 * vertical. Returns the points after `a` (the corner if any, then `b`).
 */
export function routeTo(a: GridPoint, b: GridPoint): GridPoint[] {
  if (a.x === b.x || a.y === b.y) return [b];
  return [{ x: b.x, y: a.y }, b];
}

/** Full path through the clicked points, with the corners `routeTo` adds between them. */
export function routeThrough(clicks: readonly GridPoint[]): GridPoint[] {
  const path: GridPoint[] = [];
  for (const p of clicks) {
    const last = path[path.length - 1];
    path.push(...(last ? routeTo(last, p) : [p]));
  }
  return path;
}

interface EditorState {
  doc: EditorDoc;
  selection: string[];
  tool: Tool;
  draft: WireDraft | null;

  setTool: (tool: Tool) => void;
  /** Starts placing a component of this type (keeps placing until Escape). */
  startPlacing: (type: string) => void;
  /** Places the component of the active "place" tool at this grid position. */
  placeAt: (position: GridPoint) => void;
  moveComponent: (id: string, position: GridPoint) => void;
  /** Starts the wire tool. */
  startWiring: () => void;
  /** Presses on a pin with the select tool: starts a wire there. */
  startWireFrom: (position: GridPoint) => void;
  /**
   * Click with the wire tool: starts a wire, adds a bend, or finishes the wire when clicking on
   * something it can attach to. Clicking twice on the same point finishes it with a free end.
   */
  wireClick: (position: GridPoint) => void;
  /** Removes the last clicked bend of the wire being drawn, or drops it if there is none. */
  removeLastBend: () => void;
  /** Drops the wire being drawn. */
  cancelDraft: () => void;
  /** Rotates the selection, or the component about to be placed. */
  rotate: () => void;
  /** Mirrors the selection, or the component about to be placed. */
  mirror: () => void;
  deleteSelection: () => void;
  select: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  /**
   * Escape: removes the last bend of the wire being drawn (see `removeLastBend`), else leaves the
   * current tool, else clears the selection.
   */
  cancel: () => void;
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  doc: emptyDoc(),
  selection: [],
  tool: { kind: "select" },
  draft: null,

  setTool: (tool) => set({ tool, draft: null }),

  startPlacing: (type) =>
    set({
      tool: { kind: "place", type, rotation: 0, mirror: false },
      selection: [],
      draft: null,
    }),

  placeAt: (position) =>
    set((s) => {
      if (s.tool.kind !== "place") return {};
      const { type, rotation, mirror } = s.tool;
      const { doc } = addComponent(s.doc, { type, position, rotation, mirror });
      return { doc };
    }),

  moveComponent: (id, position) => set((s) => ({ doc: moveComponent(s.doc, id, position) })),

  startWiring: () => set({ tool: { kind: "wire" }, selection: [], draft: null }),

  startWireFrom: (position) =>
    set({
      tool: { kind: "wire" },
      selection: [],
      draft: { points: [{ ...position }], returnToSelect: true },
    }),

  wireClick: (position) =>
    set((s) => {
      if (s.tool.kind !== "wire") return {};
      const draft = s.draft;
      if (!draft) return { draft: { points: [{ ...position }], returnToSelect: false } };

      const last = draft.points[draft.points.length - 1] ?? position;
      const doubleClick = samePoint(last, position);
      const points = doubleClick ? draft.points : [...draft.points, { ...position }];
      if (!doubleClick && !anchorAt(s.doc, position)) return { draft: { ...draft, points } };

      const added = addWire(s.doc, routeThrough(points));
      return {
        doc: added ? added.doc : s.doc,
        draft: null,
        ...(draft.returnToSelect ? { tool: { kind: "select" } as const } : {}),
      };
    }),

  removeLastBend: () =>
    set((s) => {
      if (!s.draft) return {};
      if (s.draft.points.length <= 1) {
        return s.draft.returnToSelect ? { draft: null, tool: { kind: "select" } } : { draft: null };
      }
      return { draft: { ...s.draft, points: s.draft.points.slice(0, -1) } };
    }),

  cancelDraft: () =>
    set((s) =>
      s.draft?.returnToSelect ? { draft: null, tool: { kind: "select" } } : { draft: null },
    ),

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

  cancel: () => {
    const s = get();
    if (s.draft) s.removeLastBend();
    else if (s.tool.kind !== "select") set({ tool: { kind: "select" } });
    else set({ selection: [] });
  },
}));
