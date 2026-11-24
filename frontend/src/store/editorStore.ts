// Global editor state (Zustand). The document only changes through the pure operations of
// `document.ts`; UI state (selection, active tool) lives next to it but outside the document.

import { create } from "zustand";

import type { SimulationResult } from "../api/client";
import {
  addComponent,
  addWire,
  anchorAt,
  copyItems,
  deleteBend,
  deleteItems,
  deleteSegment,
  emptyDoc,
  mirrorComponents,
  moveComponent,
  moveItems,
  moveWirePart,
  pasteClip,
  renameComponent,
  rotateComponents,
  rotateCw,
  samePoint,
  setParam,
  type Clip,
  type EditorDoc,
  type GridPoint,
  type Rotation,
  type WirePart,
} from "./document";
import { emptyHistory, record, redo, seal, undo, type History } from "./history";
import { routeAround } from "./routing";
import { DEFAULT_ANALYSIS, type AnalysisSettings } from "./simulation";

/** Grid units between a copied (or pasted) group and the next paste. */
export const PASTE_OFFSET: GridPoint = { x: 2, y: 2 };

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
 * Route from `a` to `b` as seen while drawing: around the components (see `routeAround`),
 * straight or as an L when nothing is in the way. Returns the points after `a` (the corners,
 * then `b`).
 */
export function routeTo(doc: EditorDoc, a: GridPoint, b: GridPoint): GridPoint[] {
  return routeAround(doc, a, b);
}

/** Full path through the clicked points, with the corners `routeTo` adds between them. */
export function routeThrough(doc: EditorDoc, clicks: readonly GridPoint[]): GridPoint[] {
  const path: GridPoint[] = [];
  let last: GridPoint | undefined;
  for (const p of clicks) {
    path.push(...(last ? routeTo(doc, last, p) : [p]));
    last = p;
  }
  return path;
}

interface EditorState {
  doc: EditorDoc;
  selection: string[];
  /** Bend or segment of a wire selected on its own (then `selection` is empty). */
  wirePart: WirePart | null;
  tool: Tool;
  draft: WireDraft | null;
  /** Items copied with Ctrl+C (an internal clipboard, not the system one). */
  clipboard: Clip | null;
  /** Undo/redo history of `doc` (the selection and the active tool are not part of it). */
  history: History<EditorDoc>;
  /**
   * Last simulation, with the document it was run on: stale once `doc` is another one. `nets`
   * (SPICE node -> wire ids, from the netlist) places the node voltages on the schematic.
   */
  simulation: {
    result: SimulationResult;
    doc: EditorDoc;
    nets: Record<string, string[]>;
  } | null;
  /** The analysis set in the toolbar, used by the Simulate button and the netlist export. */
  analysis: AnalysisSettings;
  /** A simulation is running (the Simulate button then stops it). */
  simulating: boolean;
  /** Why the last simulation could not run (backend unreachable, invalid settings...), in French. */
  simulationError: string | null;
  /** Show the operating point values (.op) on the schematic. */
  showValues: boolean;
  /** Current animation on the schematic (only shown while the simulation is up to date). */
  animation: CurrentAnimation;
  /** The document as last saved, opened or created: `doc` differs from it when unsaved. */
  savedDoc: EditorDoc;

  setTool: (tool: Tool) => void;
  /** Starts placing a component of this type (keeps placing until Escape). */
  startPlacing: (type: string) => void;
  /** Places the component of the active "place" tool at this grid position. */
  placeAt: (position: GridPoint) => void;
  /** Adds a component dropped from the palette, selects it and goes back to the select tool. */
  dropComponent: (type: string, position: GridPoint) => void;
  moveComponent: (id: string, position: GridPoint) => void;
  /**
   * Moves the selected items by `delta` (grid units). `merge` makes consecutive moves one undo
   * step (arrow keys held down).
   */
  moveSelection: (delta: GridPoint, merge?: boolean) => void;
  renameComponent: (id: string, name: string) => void;
  setParam: (id: string, param: string, value: string) => void;
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
  /** Selects one bend or segment of a wire (clears the other selection). */
  selectWirePart: (part: WirePart | null) => void;
  /**
   * Moves the selected wire part through `target` (see `moveWirePart`) and keeps it selected
   * where it lands (`landing`, a point on the part after the move).
   */
  moveWirePart: (target: GridPoint, landing: WirePart | null) => void;
  toggleSelected: (id: string) => void;
  /**
   * Escape: removes the last bend of the wire being drawn (see `removeLastBend`), else leaves the
   * current tool, else clears the selection.
   */
  cancel: () => void;
  /** Ctrl+A: selects every component, wire and junction. */
  selectAll: () => void;
  /** Ctrl+C: copies the selection (and the wires between selected items) to the clipboard. */
  copy: () => void;
  /**
   * Ctrl+V: pastes the clipboard a few grid units further, and selects the pasted items. Pasting
   * again goes further again.
   */
  paste: () => void;
  /** Ctrl+D: copies and pastes the selection in one go (the clipboard is left as it is). */
  duplicate: () => void;
  /** Ctrl+Z: goes back to the document before the last change. */
  undo: () => void;
  /** Ctrl+Y / Ctrl+Shift+Z: re-applies the last undone change. */
  redo: () => void;
  /**
   * Ends the current merge of field edits, so the next edit is its own undo step (called when a
   * field gets the focus: Escape can then undo exactly what was typed in it).
   */
  sealHistory: () => void;
  /** Keeps the result of a simulation of the current document (null: forget it). */
  setSimulation: (result: SimulationResult | null, nets?: Record<string, string[]>) => void;
  setAnalysis: (patch: Partial<AnalysisSettings>) => void;
  /** Records that a simulation started (`true`), or ended with this error (or none). */
  setSimulating: (running: boolean, error?: string | null) => void;
  setShowValues: (show: boolean) => void;
  setAnimation: (patch: Partial<CurrentAnimation>) => void;
  /** Replaces the document by an empty one (Ctrl+N). The undo history starts over. */
  newDocument: () => void;
  /** Replaces the document by one read from a file (Ctrl+O). The undo history starts over. */
  openDocument: (doc: EditorDoc) => void;
  /** Records that `doc` was saved (Ctrl+S); edits made while it was being written stay unsaved. */
  markSaved: (doc: EditorDoc) => void;
}

/** Settings of the current animation. */
export interface CurrentAnimation {
  on: boolean;
  /** Dots move like electrons (against the conventional current). */
  electrons: boolean;
  /** Transient analysis: time runs (else it is paused). */
  playing: boolean;
  /** Transient analysis: playback speed, 1 = the whole simulation in `PLAYBACK_SECONDS`. */
  speed: number;
}

/** Real duration of the playback of a transient simulation at speed 1, in seconds. */
export const PLAYBACK_SECONDS = 5;

/** The last simulation if it was run on the document shown now, else null. */
export const freshSimulation = (s: Pick<EditorState, "doc" | "simulation">) =>
  s.simulation && s.simulation.doc === s.doc ? s.simulation.result : null;

/** State of a document just created or opened: nothing selected, nothing to undo. */
function freshDocument(doc: EditorDoc) {
  return {
    doc,
    savedDoc: doc,
    history: emptyHistory<EditorDoc>(),
    selection: [],
    wirePart: null,
    tool: { kind: "select" } as const,
    draft: null,
    // A result of another document would show as stale: forget it.
    simulation: null,
  };
}

/** True if the document has changes that were not saved. */
export const isUnsaved = (s: Pick<EditorState, "doc" | "savedDoc">): boolean =>
  s.doc !== s.savedDoc;

/**
 * State update for a document change, recorded in the history. `key` merges consecutive edits of
 * the same field into one undo step. No change, no step.
 */
function change(s: EditorState, doc: EditorDoc, key: string | null = null) {
  if (doc === s.doc) return {};
  return { doc, history: record(s.history, s.doc, key) };
}

/** Keeps only the selected ids that still exist (after an undo or a redo). */
function existing(doc: EditorDoc, selection: string[]): string[] {
  const ids = new Set([
    ...doc.components.map((c) => c.id),
    ...doc.wires.map((w) => w.id),
    ...doc.junctions.map((j) => j.id),
  ]);
  return selection.filter((id) => ids.has(id));
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  ...freshDocument(emptyDoc()),
  clipboard: null,
  animation: { on: false, electrons: false, playing: true, speed: 1 },
  analysis: DEFAULT_ANALYSIS,
  simulating: false,
  simulationError: null,
  showValues: true,

  setTool: (tool) => set({ tool, draft: null, wirePart: null }),

  startPlacing: (type) =>
    set({
      tool: { kind: "place", type, rotation: 0, mirror: false },
      selection: [],
      wirePart: null,
      draft: null,
    }),

  placeAt: (position) =>
    set((s) => {
      if (s.tool.kind !== "place") return {};
      const { type, rotation, mirror } = s.tool;
      const { doc } = addComponent(s.doc, { type, position, rotation, mirror });
      return change(s, doc);
    }),

  dropComponent: (type, position) =>
    set((s) => {
      const added = addComponent(s.doc, { type, position, rotation: 0, mirror: false });
      return {
        ...change(s, added.doc),
        selection: [added.id],
        wirePart: null,
        tool: { kind: "select" },
        draft: null,
      };
    }),

  moveComponent: (id, position) =>
    set((s) => {
      const c = s.doc.components.find((x) => x.id === id);
      if (!c || samePoint(c.position, position)) return {};
      return change(s, moveComponent(s.doc, id, position));
    }),

  moveSelection: (delta, merge = false) =>
    set((s) => {
      const doc = moveItems(s.doc, new Set(s.selection), delta);
      return change(s, doc, merge ? `move:${s.selection.join(",")}` : null);
    }),

  // Typing in a field changes the document on every key: one undo step per field edited.
  renameComponent: (id, name) =>
    set((s) => change(s, renameComponent(s.doc, id, name), `name:${id}`)),

  setParam: (id, param, value) =>
    set((s) => change(s, setParam(s.doc, id, param, value), `param:${id}:${param}`)),

  startWiring: () => set({ tool: { kind: "wire" }, selection: [], wirePart: null, draft: null }),

  startWireFrom: (position) =>
    set({
      tool: { kind: "wire" },
      selection: [],
      wirePart: null,
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

      const added = addWire(s.doc, routeThrough(s.doc, points));
      return {
        ...(added ? change(s, added.doc) : {}),
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
        : s.selection.length > 0
          ? change(s, rotateComponents(s.doc, new Set(s.selection)))
          : {},
    ),

  mirror: () =>
    set((s) =>
      s.tool.kind === "place"
        ? { tool: { ...s.tool, mirror: !s.tool.mirror } }
        : s.selection.length > 0
          ? change(s, mirrorComponents(s.doc, new Set(s.selection)))
          : {},
    ),

  deleteSelection: () =>
    set((s) => {
      const part = s.wirePart;
      // A bend goes only if the wire stays orthogonal; a segment cuts its wire in two.
      if (part) {
        const doc = part.kind === "bend" ? deleteBend(s.doc, part) : deleteSegment(s.doc, part);
        return doc === s.doc ? {} : { ...change(s, doc), wirePart: null };
      }
      return s.selection.length > 0
        ? { ...change(s, deleteItems(s.doc, new Set(s.selection))), selection: [] }
        : {};
    }),

  // Changing the selection ends a field edit: editing the same field again later is a new step.
  select: (ids) => set((s) => ({ selection: ids, wirePart: null, history: seal(s.history) })),

  sealHistory: () => set((s) => ({ history: seal(s.history) })),

  setSimulation: (result, nets = {}) =>
    set((s) => ({
      simulation: result ? { result, doc: s.doc, nets } : null,
      animation: { ...s.animation, on: false },
    })),

  setAnimation: (patch) => set((s) => ({ animation: { ...s.animation, ...patch } })),

  setAnalysis: (patch) => set((s) => ({ analysis: { ...s.analysis, ...patch } })),

  setSimulating: (running, error = null) =>
    set({ simulating: running, simulationError: running ? null : error }),

  setShowValues: (show) => set({ showValues: show }),

  newDocument: () => set(freshDocument(emptyDoc())),

  openDocument: (doc) => set(freshDocument(doc)),

  markSaved: (doc) => set({ savedDoc: doc }),

  selectWirePart: (part) =>
    set((s) => ({ selection: [], wirePart: part, history: seal(s.history) })),

  moveWirePart: (target, landing) =>
    set((s) => {
      if (!s.wirePart) return {};
      return { ...change(s, moveWirePart(s.doc, s.wirePart, target)), wirePart: landing };
    }),

  toggleSelected: (id) =>
    set((s) => ({
      history: seal(s.history),
      wirePart: null,
      selection: s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : [...s.selection, id],
    })),

  cancel: () => {
    const s = get();
    if (s.draft) s.removeLastBend();
    else if (s.tool.kind !== "select") set({ tool: { kind: "select" } });
    else set({ selection: [], wirePart: null });
  },

  selectAll: () =>
    set((s) => ({
      selection: [
        ...s.doc.components.map((c) => c.id),
        ...s.doc.wires.map((w) => w.id),
        ...s.doc.junctions.map((j) => j.id),
      ],
      wirePart: null,
      tool: { kind: "select" },
      draft: null,
      history: seal(s.history),
    })),

  copy: () =>
    set((s) =>
      s.selection.length > 0 ? { clipboard: copyItems(s.doc, new Set(s.selection)) } : {},
    ),

  paste: () =>
    set((s) => {
      if (!s.clipboard || s.clipboard.components.length + s.clipboard.wires.length === 0) return {};
      const pasted = pasteClip(s.doc, s.clipboard, PASTE_OFFSET);
      return {
        ...change(s, pasted.doc),
        selection: pasted.ids,
        wirePart: null,
        tool: { kind: "select" },
        draft: null,
        // The next paste lands next to this one, not on top of it.
        clipboard: copyItems(pasted.doc, new Set(pasted.ids)),
      };
    }),

  duplicate: () =>
    set((s) => {
      if (s.selection.length === 0) return {};
      const clip = copyItems(s.doc, new Set(s.selection));
      if (clip.components.length + clip.wires.length === 0) return {};
      const pasted = pasteClip(s.doc, clip, PASTE_OFFSET);
      return { ...change(s, pasted.doc), selection: pasted.ids, wirePart: null };
    }),

  undo: () =>
    set((s) => {
      const step = undo(s.history, s.doc);
      if (!step) return {};
      return {
        doc: step.state,
        history: step.history,
        selection: existing(step.state, s.selection),
        wirePart: null,
        draft: null,
      };
    }),

  redo: () =>
    set((s) => {
      const step = redo(s.history, s.doc);
      if (!step) return {};
      return {
        doc: step.state,
        history: step.history,
        selection: existing(step.state, s.selection),
        wirePart: null,
        draft: null,
      };
    }),
}));
