// Global editor state (Zustand). The document only changes through the pure operations of
// `document.ts`; UI state (selection, active tool) lives next to it but outside the document.

import { create } from "zustand";

import type { SimulationResult } from "../api/client";
import {
  addComponent,
  addWire,
  anchorAt,
  connectPinsOnWires,
  copyItems,
  deleteItems,
  deleteSegment,
  deleteSegments,
  docBounds,
  emptyDoc,
  freeMove,
  itemsInRect,
  itemsTouchingRect,
  mirrorComponents,
  moveComponent,
  moveWirePart,
  normalizeContacts,
  nudgeFree,
  pasteClip,
  renameComponent,
  rotateComponents,
  rotateCw,
  samePoint,
  segmentsInRect,
  setParam,
  type Clip,
  type EditorDoc,
  type GridPoint,
  type GridRect,
  type Rotation,
  type WirePart,
} from "./document";
import { emptyHistory, record, redo, seal, undo, type History } from "./history";
import { routeAround } from "./routing";
import { DEFAULT_ANALYSIS, type AnalysisSettings } from "./simulation";

/** Grid units a component placed on top of another one is shifted by, until it is free. */
export const PASTE_OFFSET: GridPoint = { x: 2, y: 2 };

export type Tool =
  | { kind: "select" }
  | { kind: "place"; type: string; rotation: Rotation; mirror: boolean }
  | { kind: "wire" }
  /** Pasted or duplicated items follow the mouse until a click drops them (#166). */
  | { kind: "paste"; clip: Clip };

/**
 * Grid point of a clip that follows the mouse while pasting: the middle of its items, rounded,
 * so the copy is centred on the pointer.
 */
export function clipAnchor(clip: Clip): GridPoint {
  const bounds = docBounds(clip);
  if (!bounds) return { x: 0, y: 0 };
  return {
    x: Math.round((bounds.min.x + bounds.max.x) / 2),
    y: Math.round((bounds.min.y + bounds.max.y) / 2),
  };
}

const hasItems = (clip: Clip | null): clip is Clip =>
  clip !== null && clip.components.length + clip.wires.length > 0;

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
 * straight or as an L when nothing is in the way. Pins do not get in the way: a wire drawn across
 * one stays straight and is connected there (#244). Returns the points after `a` (the corners,
 * then `b`).
 */
export function routeTo(doc: EditorDoc, a: GridPoint, b: GridPoint): GridPoint[] {
  return routeAround(doc, a, b, { throughPins: true });
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
  /** Wire sections selected with the selection rectangle (#121), next to `selection`. */
  segments: WirePart[];
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
  /**
   * Places the component of the active "place" tool at this grid position, or a bit further
   * if another component is already there (see `nudgeFree`).
   */
  placeAt: (position: GridPoint) => void;
  /** Adds a component dropped from the palette, selects it and goes back to the select tool. */
  dropComponent: (type: string, position: GridPoint) => void;
  moveComponent: (id: string, position: GridPoint) => void;
  /**
   * Moves the selected items by `delta` (grid units), or to the nearest place where no component
   * lies on another one (see `freeMove`). `merge` makes consecutive moves one undo step (arrow
   * keys held down); `detach` leaves the wires where they are (Ctrl + drag). Except while merging,
   * a pin that lands on a wire is connected to it (see `connectPinsOnWires`).
   */
  moveSelection: (delta: GridPoint, options?: { merge?: boolean; detach?: boolean }) => void;
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
  /**
   * Releases the selection rectangle `r`. "inside" selects what lies entirely in it, and the
   * sections of wires (segments) whose two ends do; "touching" (Shift) adds what touches it and
   * removes what touches it and was already selected (#93).
   */
  selectInRect: (r: GridRect, mode: "inside" | "touching") => void;
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
  /** Ctrl+V: the clipboard follows the mouse (tool "paste") until `pasteAt`. */
  paste: () => void;
  /**
   * Ctrl+D: a copy of the selection follows the mouse (tool "paste") until `pasteAt`. The
   * clipboard is left as it is.
   */
  duplicate: () => void;
  /**
   * Click with the "paste" tool: drops the copy centred on `position` (or on the nearest place
   * where it covers no component), selects it and goes back to the select tool. Escape or a
   * right click (`cancel`) drops nothing.
   */
  pasteAt: (position: GridPoint) => void;
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
    segments: [],
    tool: { kind: "select" } as const,
    draft: null,
    // A result of another document would show as stale: forget it.
    simulation: null,
  };
}

/**
 * The analysis kept for another document: its settings, but not the sources chosen for `.ac` and
 * `.dc`, whose ids may name another source there (the first one is taken instead).
 */
const forgetSources = (s: Pick<EditorState, "analysis">): AnalysisSettings => ({
  ...s.analysis,
  acSource: "",
  dcSource: "",
});

/** True if the document has changes that were not saved. */
export const isUnsaved = (s: Pick<EditorState, "doc" | "savedDoc">): boolean =>
  s.doc !== s.savedDoc;

/**
 * State update for a document change, recorded in the history. `key` merges consecutive edits of
 * the same field into one undo step. No change, no step.
 */
function change(s: EditorState, edited: EditorDoc, key: string | null = null) {
  // Whatever the edit, what touches on the schematic is connected for the simulation (#256).
  const doc = normalizeContacts(edited);
  if (doc === s.doc) return {};
  // The wire sections are kept by index: once the wires change, they may point elsewhere.
  return { doc, history: record(s.history, s.doc, key), segments: [] };
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

  setTool: (tool) => set({ tool, draft: null, wirePart: null, segments: [] }),

  startPlacing: (type) =>
    set({
      tool: { kind: "place", type, rotation: 0, mirror: false },
      selection: [],
      wirePart: null,
      segments: [],
      draft: null,
    }),

  placeAt: (position) =>
    set((s) => {
      if (s.tool.kind !== "place") return {};
      const { type, rotation, mirror } = s.tool;
      const added = addComponent(s.doc, { type, position, rotation, mirror });
      const ids = new Set([added.id]);
      return change(s, connectPinsOnWires(nudgeFree(added.doc, ids, PASTE_OFFSET), { comps: ids }));
    }),

  dropComponent: (type, position) =>
    set((s) => {
      const added = addComponent(s.doc, { type, position, rotation: 0, mirror: false });
      const ids = new Set([added.id]);
      return {
        ...change(s, connectPinsOnWires(nudgeFree(added.doc, ids, PASTE_OFFSET), { comps: ids })),
        selection: [added.id],
        wirePart: null,
        segments: [],
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

  moveSelection: (delta, { merge = false, detach = false } = {}) =>
    set((s) => {
      const ids = new Set(s.selection);
      let doc = freeMove(s.doc, ids, delta, { detach });
      // Arrow keys step through the wires: connecting each one passed over would be a trap.
      if (doc !== s.doc && !merge) {
        doc = connectPinsOnWires(connectPinsOnWires(doc, { comps: ids }), { wires: ids });
      }
      return change(s, doc, merge ? `move:${s.selection.join(",")}` : null);
    }),

  // Typing in a field changes the document on every key: one undo step per field edited.
  renameComponent: (id, name) =>
    set((s) => change(s, renameComponent(s.doc, id, name), `name:${id}`)),

  setParam: (id, param, value) =>
    set((s) => change(s, setParam(s.doc, id, param, value), `param:${id}:${param}`)),

  startWiring: () =>
    set({ tool: { kind: "wire" }, selection: [], wirePart: null, segments: [], draft: null }),

  startWireFrom: (position) =>
    set({
      tool: { kind: "wire" },
      selection: [],
      wirePart: null,
      segments: [],
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
      const doc = added && connectPinsOnWires(added.doc, { wires: new Set([added.id]) });
      return {
        ...(doc ? change(s, doc) : {}),
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
      // A segment cuts its wire in two. A bend is there to be moved: deleting it deletes its
      // whole wire, rather than redrawing part of it (#158).
      if (part) {
        const doc =
          part.kind === "bend"
            ? deleteItems(s.doc, new Set([part.wire]))
            : deleteSegment(s.doc, part);
        return doc === s.doc ? {} : { ...change(s, doc), wirePart: null, segments: [] };
      }
      if (s.selection.length === 0 && s.segments.length === 0) return {};
      // Sections first: deleting items may merge wires around a junction (see `cleanJunctions`).
      const ids = new Set(s.selection);
      const cut = deleteSegments(
        s.doc,
        s.segments.filter((seg) => !ids.has(seg.wire)),
      );
      return { ...change(s, deleteItems(cut, ids)), selection: [], segments: [] };
    }),

  // Changing the selection ends a field edit: editing the same field again later is a new step.
  select: (ids) =>
    set((s) => ({ selection: ids, wirePart: null, segments: [], history: seal(s.history) })),

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

  newDocument: () => set((s) => ({ ...freshDocument(emptyDoc()), analysis: forgetSources(s) })),

  // An older file may have pins touching without a wire: connect them, without marking it changed.
  openDocument: (doc) =>
    set((s) => ({ ...freshDocument(normalizeContacts(doc)), analysis: forgetSources(s) })),

  markSaved: (doc) => set({ savedDoc: doc }),

  selectInRect: (r, mode) =>
    set((s) => {
      if (mode === "inside") {
        return {
          selection: itemsInRect(s.doc, r),
          segments: segmentsInRect(s.doc, r),
          wirePart: null,
          history: seal(s.history),
        };
      }
      const touched = itemsTouchingRect(s.doc, r);
      const kept = s.selection.filter((id) => !touched.includes(id));
      const added = touched.filter((id) => !s.selection.includes(id));
      return { selection: [...kept, ...added], wirePart: null, history: seal(s.history) };
    }),

  selectWirePart: (part) =>
    set((s) => ({ selection: [], segments: [], wirePart: part, history: seal(s.history) })),

  moveWirePart: (target, landing) =>
    set((s) => {
      if (!s.wirePart) return {};
      const moved = moveWirePart(s.doc, s.wirePart, target);
      const doc =
        moved === s.doc ? moved : connectPinsOnWires(moved, { wires: new Set([s.wirePart.wire]) });
      // A cut changes the parts of the wire: the landing part may not exist any more.
      return {
        ...change(s, doc),
        wirePart: doc.wires.length === moved.wires.length ? landing : null,
      };
    }),

  toggleSelected: (id) =>
    set((s) => ({
      history: seal(s.history),
      wirePart: null,
      segments: [],
      selection: s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : [...s.selection, id],
    })),

  cancel: () => {
    const s = get();
    if (s.draft) s.removeLastBend();
    else if (s.tool.kind !== "select") set({ tool: { kind: "select" } });
    else set({ selection: [], wirePart: null, segments: [] });
  },

  selectAll: () =>
    set((s) => ({
      selection: [
        ...s.doc.components.map((c) => c.id),
        ...s.doc.wires.map((w) => w.id),
        ...s.doc.junctions.map((j) => j.id),
      ],
      wirePart: null,
      segments: [],
      tool: { kind: "select" },
      draft: null,
      history: seal(s.history),
    })),

  copy: () =>
    set((s) =>
      s.selection.length > 0 ? { clipboard: copyItems(s.doc, new Set(s.selection)) } : {},
    ),

  paste: () =>
    set((s) =>
      hasItems(s.clipboard)
        ? {
            tool: { kind: "paste", clip: s.clipboard },
            selection: [],
            wirePart: null,
            segments: [],
            draft: null,
          }
        : {},
    ),

  duplicate: () =>
    set((s) => {
      if (s.selection.length === 0) return {};
      const clip = copyItems(s.doc, new Set(s.selection));
      return hasItems(clip)
        ? {
            tool: { kind: "paste", clip },
            selection: [],
            wirePart: null,
            segments: [],
            draft: null,
          }
        : {};
    }),

  pasteAt: (position) =>
    set((s) => {
      if (s.tool.kind !== "paste") return {};
      const anchor = clipAnchor(s.tool.clip);
      const offset = { x: position.x - anchor.x, y: position.y - anchor.y };
      const pasted = pasteClip(s.doc, s.tool.clip, offset);
      // Every overlap is new: the pasted items were not there before. Nothing outside is wired
      // to them yet, and pins they touch where they were dropped must not get wired either.
      const ids = new Set(pasted.ids);
      const placed = freeMove(
        pasted.doc,
        ids,
        { x: 0, y: 0 },
        { allowed: new Set(), detach: true },
      );
      const doc = connectPinsOnWires(connectPinsOnWires(placed, { comps: ids }), { wires: ids });
      return {
        ...change(s, doc),
        selection: pasted.ids,
        wirePart: null,
        segments: [],
        tool: { kind: "select" },
        draft: null,
      };
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
        segments: [],
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
        segments: [],
        draft: null,
      };
    }),
}));
