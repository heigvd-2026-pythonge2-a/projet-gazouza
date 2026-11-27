// Global editor state (Zustand). The document only changes through the pure operations of
// `document.ts`; UI state (selection, active tool) lives next to it but outside the document.

import { create } from "zustand";

import type { SimulationResult } from "../api/client";
import {
  addComponent,
  addText,
  addWire,
  anchorAt,
  connectPinsOnWires,
  copyItems,
  deleteItems,
  deleteSegment,
  deleteSegments,
  docBounds,
  docIds,
  emptyDoc,
  freeMove,
  itemsInRect,
  itemsTouchingRect,
  mirrorComponents,
  moveComponent,
  closesWireLoop,
  moveWirePart,
  normalizeContacts,
  orientLabels,
  nudgeFree,
  pasteClip,
  removeHiddenWires,
  renameComponent,
  rotateComponents,
  rotateCw,
  samePoint,
  segmentsInRect,
  setParam,
  setTextContent,
  turnClip,
  type Clip,
  type EditorDoc,
  type GridPoint,
  type GridRect,
  type Rotation,
  type WirePart,
} from "./document";
import { moveCaption, releaseCoveredCaptions, resetCaptions, type CaptionKind } from "./captions";
import { emptyHistory, record, redo, seal, undo, type History } from "./history";
import { routeAround } from "./routing";
import { DEFAULT_ANALYSIS, type AnalysisSettings, type OperatingPointRow } from "./simulation";

/** Grid units a component placed on top of another one is shifted by, until it is free. */
export const PASTE_OFFSET: GridPoint = { x: 2, y: 2 };

export type Tool =
  | { kind: "select" }
  | { kind: "place"; type: string; rotation: Rotation; mirror: boolean }
  | { kind: "wire" }
  /**
   * Pasted or duplicated items follow the mouse until a click drops them (#166). R and M turn
   * `clip` before it is dropped (#260).
   */
  | { kind: "paste"; clip: Clip }
  /** Click on the schematic to write a free text there (#123). */
  | { kind: "text" };

/** Content of a free text just placed, selected in the properties panel to be typed over. */
export const NEW_TEXT = "Texte";

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

/** True if a clipboard holds something to paste (a junction alone is not worth it). */
const hasItems = (clip: Clip | null): clip is Clip =>
  clip !== null && clip.components.length + clip.wires.length + clip.texts.length > 0;

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
  /** What a hovered line of the results panel points at, highlighted on the schematic (#292). */
  reportHighlight: OperatingPointRow["highlight"];
  /**
   * The push button held down with the mouse (#43): closed while it is held, without changing the
   * document (nothing to save or undo). Simulations take it into account (`simulatedDoc`).
   */
  pressedButton: string | null;
  /** Current animation on the schematic (only shown while the simulation is up to date). */
  animation: CurrentAnimation;
  /** The document as last saved, opened or created: `doc` differs from it when unsaved. */
  savedDoc: EditorDoc;
  /**
   * Why the last gesture did nothing (a wire refused...), in French, for the status bar. Cleared
   * by the next change of the document, of the tool, or the next click with the wire tool.
   */
  notice: string | null;

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
  /** Opens a closed switch, closes an open one (#43): one undo step each time. */
  toggleSwitch: (id: string) => void;
  /** Holds a push button down (closed), or lets it go (null). */
  pressButton: (id: string | null) => void;
  /** Starts the wire tool. */
  startWiring: () => void;
  /** Starts the text tool (T). */
  startText: () => void;
  /**
   * Click with the text tool: adds a text there, selects it and goes back to the select tool (its
   * content is then typed in the properties panel).
   */
  placeText: (position: GridPoint) => void;
  /** Changes the content of a free text (one undo step per field edit, like the other fields). */
  setTextContent: (id: string, content: string) => void;
  /** Moves the name or the value of a component: `centre` is where the text is drawn. */
  moveCaption: (id: string, kind: CaptionKind, centre: GridPoint) => void;
  /** Puts the texts of the selected components back to their automatic place. */
  resetCaptions: () => void;
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
  /** Rotates the selection, or the component or the copy about to be placed. */
  rotate: () => void;
  /** Mirrors the selection, or the component or the copy about to be placed. */
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
   * Moves the selected wire part through `target`, a segment sliding by as much as `target` is
   * from `grab` (see `moveWirePart`), and keeps it selected where it lands (`landing`).
   */
  moveWirePart: (target: GridPoint, landing: WirePart | null, grab?: GridPoint) => void;
  toggleSelected: (id: string) => void;
  /**
   * Escape: removes the last bend of the wire being drawn (see `removeLastBend`), else leaves the
   * current tool, else clears the selection.
   */
  cancel: () => void;
  /** Ctrl+A: selects every component, wire, junction and text. */
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
  setReportHighlight: (highlight: OperatingPointRow["highlight"]) => void;
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

/** Model names of the two states of a switch or a push button (their `state` parameter). */
export const SWITCH_OPEN = "SW_OPEN";
export const SWITCH_CLOSED = "SW_CLOSED";

/** True for the components opened and closed with a click (#43). */
export const isSwitch = (type: string): boolean => type === "switch" || type === "push_button";

/** The other state of a switch (absent or unknown: open, so it closes). */
export const toggledState = (state: string | undefined): string =>
  state === SWITCH_CLOSED ? SWITCH_OPEN : SWITCH_CLOSED;

/**
 * The document as it is simulated: `doc`, with the push button held down closed (#43). The same
 * document when no button is held.
 */
export function simulatedDoc(doc: EditorDoc, pressedButton: string | null): EditorDoc {
  if (pressedButton === null) return doc;
  return {
    ...doc,
    components: doc.components.map((c) =>
      c.id === pressedButton && c.type === "push_button"
        ? { ...c, params: { ...c.params, state: SWITCH_CLOSED } }
        : c,
    ),
  };
}

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
    pressedButton: null,
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
  const doc = tidy(edited);
  if (doc === s.doc) return {};
  // The wire sections are kept by index: once the wires change, they may point elsewhere.
  return { doc, history: record(s.history, s.doc, key), segments: [], notice: null };
}

/**
 * After turning or mirroring components: their texts moved by hand turn with them, unless they
 * would then cover something (they go back to their automatic place).
 */
function turned(doc: EditorDoc, selection: string[]): EditorDoc {
  return releaseCoveredCaptions(doc, new Set(selection));
}

/**
 * The document after any edit: what touches on the schematic is connected for the simulation
 * (#256), the duplicate wires an edit may leave under others are removed (#259), and the flags of
 * the node labels point away from their wire (#295).
 */
const tidy = (doc: EditorDoc): EditorDoc => orientLabels(removeHiddenWires(normalizeContacts(doc)));

/** Why a wire is not added (see `closesWireLoop`), shown in the status bar (#257). */
export const WIRE_LOOP_NOTICE = "Fil non ajouté : ces deux points sont déjà reliés par des fils.";

/** Keeps only the selected ids that still exist (after an undo or a redo). */
function existing(doc: EditorDoc, selection: string[]): string[] {
  const ids = new Set(docIds(doc));
  return selection.filter((id) => ids.has(id));
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  ...freshDocument(emptyDoc()),
  clipboard: null,
  animation: { on: false, electrons: false, playing: true, speed: 1 },
  analysis: DEFAULT_ANALYSIS,
  simulating: false,
  simulationError: null,
  notice: null,
  showValues: true,
  reportHighlight: null,
  pressedButton: null,

  setTool: (tool) => set({ tool, draft: null, wirePart: null, segments: [], notice: null }),

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

  toggleSwitch: (id) =>
    set((s) => {
      const c = s.doc.components.find((x) => x.id === id);
      if (!c || !isSwitch(c.type)) return {};
      return change(s, setParam(s.doc, id, "state", toggledState(c.params.state)));
    }),

  pressButton: (id) => set({ pressedButton: id }),

  startWiring: () =>
    set({ tool: { kind: "wire" }, selection: [], wirePart: null, segments: [], draft: null }),

  startText: () => set({ tool: { kind: "text" }, selection: [], wirePart: null, draft: null }),

  placeText: (position) =>
    set((s) => {
      if (s.tool.kind !== "text") return {};
      const added = addText(s.doc, position, NEW_TEXT);
      return {
        ...change(s, added.doc),
        selection: [added.id],
        wirePart: null,
        tool: { kind: "select" },
      };
    }),

  setTextContent: (id, content) =>
    set((s) => change(s, setTextContent(s.doc, id, content), `text:${id}`)),

  moveCaption: (id, kind, centre) => set((s) => change(s, moveCaption(s.doc, id, kind, centre))),

  resetCaptions: () => set((s) => change(s, resetCaptions(s.doc, new Set(s.selection)))),

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
      if (!draft) {
        return { draft: { points: [{ ...position }], returnToSelect: false }, notice: null };
      }

      const last = draft.points[draft.points.length - 1] ?? position;
      const doubleClick = samePoint(last, position);
      const points = doubleClick ? draft.points : [...draft.points, { ...position }];
      if (!doubleClick && !anchorAt(s.doc, position)) return { draft: { ...draft, points } };

      const added = addWire(s.doc, routeThrough(s.doc, points));
      const doc = added && connectPinsOnWires(added.doc, { wires: new Set([added.id]) });
      // A wire only closing a loop of wires connects nothing new: refuse it, and say why (#257).
      const loop =
        added !== null && doc !== null && closesWireLoop(normalizeContacts(doc), added.id);
      return {
        ...(doc && !loop ? change(s, doc) : {}),
        draft: null,
        notice: loop ? WIRE_LOOP_NOTICE : null,
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
        : s.tool.kind === "paste"
          ? { tool: { ...s.tool, clip: turnClip(s.tool.clip, clipAnchor(s.tool.clip), "rotate") } }
          : s.selection.length > 0
            ? change(s, turned(rotateComponents(s.doc, new Set(s.selection)), s.selection))
            : {},
    ),

  mirror: () =>
    set((s) =>
      s.tool.kind === "place"
        ? { tool: { ...s.tool, mirror: !s.tool.mirror } }
        : s.tool.kind === "paste"
          ? { tool: { ...s.tool, clip: turnClip(s.tool.clip, clipAnchor(s.tool.clip), "mirror") } }
          : s.selection.length > 0
            ? change(s, turned(mirrorComponents(s.doc, new Set(s.selection)), s.selection))
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

  setReportHighlight: (highlight) => set({ reportHighlight: highlight }),

  newDocument: () => set((s) => ({ ...freshDocument(emptyDoc()), analysis: forgetSources(s) })),

  // An older file may have pins touching without a wire: connect them, without marking it changed.
  openDocument: (doc) => set((s) => ({ ...freshDocument(tidy(doc)), analysis: forgetSources(s) })),

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

  moveWirePart: (target, landing, grab) =>
    set((s) => {
      if (!s.wirePart) return {};
      const moved = moveWirePart(s.doc, s.wirePart, target, grab);
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
      selection: docIds(s.doc),
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
