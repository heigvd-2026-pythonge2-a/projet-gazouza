import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Arrow, Circle, Group, Layer, Rect, Stage, Text } from "react-konva";

import {
  animatable,
  clipAnchor,
  connectPinsOnWires,
  diagnosticMarks,
  docBounds,
  freshSimulation,
  getDef,
  isSwitch,
  layoutCaptions,
  mainParam,
  moveItems,
  moveWirePart,
  autoLabelDirections,
  nodeIndex,
  currentArrows,
  operatingPointLabels,
  voltageArrows,
  resolveCaptionDrop,
  pinPosition,
  rectFrom,
  samePoint,
  simulatedDoc,
  unconnectedPins,
  PALETTES,
  useEditorStore,
  useThemeStore,
  wirePartAt,
  wirePartPoints,
  type GridPoint,
  type CircuitNode,
  type EditorText,
  type GridRect,
  type NodeItem,
  type OperatingPointLabel,
  type PlacedComponent,
  type WirePart,
  NEW_TEXT,
} from "../store";
import { AnimationControls } from "./AnimationControls";
import { CloseDialog } from "./CloseDialog";
import { ComponentSymbol } from "./ComponentSymbol";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { DiagnosticHalos } from "./DiagnosticHalos";
import { EmptyCanvasHint } from "./EmptyCanvasHint";
import { ErrorBubbles } from "./ErrorBubbles";
import { Grid, type Viewport } from "./Grid";
import { fitViewport, showViewport } from "./fitView";
import { FreeText } from "./FreeText";
import { newFile, openFile, saveFile, saveFileAs } from "./fileActions";
import { useFileDrop } from "./fileDrop";
import { CurrentLayer } from "./CurrentLayer";
import { LedGlow } from "./LedGlow";
import { focusInspector } from "./inspectorFocus";
import { ComponentHighlight, NodeHighlight } from "./NodeHighlight";
import { DRAG_TYPE } from "./Palette";
import { resimulateOperatingPoint } from "./simulationActions";
import { entryForKey } from "./paletteLayout";
import { CanvasColorsContext, COLORS, GRID, MAX_SCALE, MIN_SCALE, UI } from "./theme";
import { useUnsavedChangesGuard } from "./unsavedGuard";
import { RecoveryPrompt } from "./RecoveryPrompt";
import { ValuePopover } from "./ValuePopover";
import { layerToSvg } from "./svgExport";
import { registerViewCommands, type ImageOptions } from "./viewCommands";
import { WireDraft, Wires } from "./Wires";

const ZOOM_STEP = 1.1;
/** Zoom factor of the toolbar zoom buttons (bigger than one wheel step). */
const BUTTON_ZOOM_STEP = 1.25;
/** Radius of the ring drawn around a pin connected to nothing, in grid units. */
const UNCONNECTED_RADIUS = 0.4;
const NO_PINS: ReadonlySet<string> = new Set();
/** A right press that moves more than this (screen pixels) pans the view instead of clicking. */
const DRAG_THRESHOLD = 4;
/** A left press in the void that moves more than this (screen pixels) draws a selection box. */
const BAND_THRESHOLD = 3;
/** Exported image: pixels per drawing pixel at zoom 1, and white margin around the circuit. */
const EXPORT_PIXEL_RATIO = 2;
const EXPORT_MARGIN = 20;

/** Grid step of each arrow key, to move the selection. */
const ARROWS: Record<string, GridPoint> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** Middle or right button held on the canvas. */
interface Press {
  button: 1 | 2;
  /** Where the press started (client coordinates) and the viewport offset at that moment. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The view is being moved (always for the middle button, after the threshold for the right). */
  panning: boolean;
  /** Component or text under the right press, if any. */
  componentId: string | null;
}

/** Actions of the menu opened by a right click on a component; they apply to the selection. */
/** Width of the box of a value written on the schematic, and its font size, in pixels. */
const VALUE_WIDTH = 90;
const VALUE_FONT_SIZE = 11;

/** A value of the operating point written on the schematic, on its side of its anchor (#102). */
function ValueText({ label: l, color }: { label: OperatingPointLabel; color: string }) {
  const x = l.position.x * GRID;
  const y = l.position.y * GRID;
  const width = VALUE_WIDTH;
  if (l.angle !== undefined) {
    // Slanted along a diagonal arrow, centred on its anchor.
    return (
      <Text
        text={l.text}
        x={x}
        y={y}
        width={width}
        offsetX={width / 2}
        offsetY={VALUE_FONT_SIZE / 2}
        rotation={l.angle}
        align="center"
        fontSize={VALUE_FONT_SIZE}
        fontStyle="bold"
        fill={color}
        listening={false}
      />
    );
  }
  const at = {
    above: { x: x - width / 2, y: y - 16, align: "center" },
    below: { x: x - width / 2, y: y + 4, align: "center" },
    right: { x: x + 6, y: y - 6, align: "left" },
    left: { x: x - width - 2, y: y - 6, align: "right" },
  }[l.side];
  return (
    <Text
      text={l.text}
      {...at}
      width={width}
      fontSize={VALUE_FONT_SIZE}
      fontStyle="bold"
      fill={color}
      listening={false}
    />
  );
}

function componentMenu(selectionSize: number): MenuItem[] {
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

/** Tracks the size of an element, so the Konva stage can fill its container. */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** Schematic canvas: zoomable, pannable; accepts components dragged from the palette. */
export function SchematicCanvas() {
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const stageRef = useRef<Konva.Stage>(null);
  /** Layer of the schematic itself (wires, components), the one exported as an image. */
  const contentRef = useRef<Konva.Layer>(null);
  /**
   * While set, the schematic is drawn for the image export (no grid, no selection, no marks),
   * and this receives the image once that drawing is done.
   */
  const [exporting, setExporting] = useState<{
    options: ImageOptions;
    done: (image: Blob | null) => void;
  } | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const theme = useThemeStore((s) => s.theme);
  // An exported image goes in a report, on white: it is always drawn in the light colours.
  const canvasColors = PALETTES[exporting ? "light" : theme];
  const valueColor = (kind: "voltage" | "current") =>
    kind === "voltage" ? canvasColors.voltageLabel : canvasColors.currentLabel;
  const [pointer, setPointer] = useState<GridPoint | null>(null);
  const [panning, setPanning] = useState(false);
  /** Selection rectangle being drawn (grid units), and its mode (Shift: what touches it). */
  const [band, setBand] = useState<{ rect: GridRect; touching: boolean } | null>(null);
  /** Context menu, at this position in the canvas. */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  /** Component under the right press being handled (set by the component, read by the stage). */
  const rightPressed = useRef<string | null>(null);
  /**
   * Switch or push button pressed with the left button (#43), and whether it has been dragged
   * since: a press released where it started toggles the switch, a drag only moves it.
   */
  const switchPress = useRef<{ id: string; moved: boolean } | null>(null);
  /**
   * Items being dragged and how far (grid units): shown moved before the store changes. With
   * Ctrl (`detach`), the wires stay where they are.
   */
  const [drag, setDrag] = useState<{
    ids: ReadonlySet<string>;
    delta: GridPoint;
    detach: boolean;
  } | null>(null);
  /**
   * Where the selected wire part is being dragged (grid point) and where it was grabbed, before
   * the store changes.
   */
  const [partTarget, setPartTarget] = useState<{ grab: GridPoint; target: GridPoint } | null>(null);
  /** Component whose main value is being edited in the menu over it (double-click). */
  const [editing, setEditing] = useState<string | null>(null);
  /** Removes the window listeners of the press in progress, if any. */
  const endPress = useRef<(() => void) | null>(null);

  const storeDoc = useEditorStore((s) => s.doc);
  const selection = useEditorStore((s) => s.selection);
  const reportHighlight = useEditorStore((s) => s.reportHighlight);
  const wirePart = useEditorStore((s) => s.wirePart);
  const segments = useEditorStore((s) => s.segments);
  const tool = useEditorStore((s) => s.tool);
  const placeAt = useEditorStore((s) => s.placeAt);
  const placeText = useEditorStore((s) => s.placeText);
  const pasteAt = useEditorStore((s) => s.pasteAt);
  const select = useEditorStore((s) => s.select);
  const toggleSelected = useEditorStore((s) => s.toggleSelected);
  const toggleSwitch = useEditorStore((s) => s.toggleSwitch);
  const pressButton = useEditorStore((s) => s.pressButton);
  const pressedButton = useEditorStore((s) => s.pressedButton);
  const moveSelection = useEditorStore((s) => s.moveSelection);
  const moveCaption = useEditorStore((s) => s.moveCaption);
  const draft = useEditorStore((s) => s.draft);
  const wireClick = useEditorStore((s) => s.wireClick);
  const startWireFrom = useEditorStore((s) => s.startWireFrom);
  const dropComponent = useEditorStore((s) => s.dropComponent);
  const simulation = useEditorStore(freshSimulation);
  const animation = useEditorStore((s) => s.animation);
  const showValues = useEditorStore((s) => s.showValues);
  const nets = useEditorStore((s) => s.simulation?.nets);
  // Values of an operating point next to the nodes and components (#102).
  const valueLabels = useMemo(
    () =>
      showValues && simulation && nets ? operatingPointLabels(storeDoc, simulation, nets) : [],
    [showValues, simulation, nets, storeDoc],
  );
  /** Component under the pointer: its voltage is shown in detail after a .op (#290). */
  const [hoveredComponent, setHoveredComponent] = useState<string | null>(null);
  // Arrows of the currents and voltages of an operating point (#290): the voltage across a
  // component only for the hovered and selected ones (and the one of a hovered table line).
  const valueArrows = useMemo(() => {
    if (!showValues || !simulation || !nets) return [];
    const detail = new Set(selection);
    if (hoveredComponent) detail.add(hoveredComponent);
    if (reportHighlight && "component" in reportHighlight) detail.add(reportHighlight.component);
    return [
      ...currentArrows(storeDoc, simulation),
      ...voltageArrows(storeDoc, simulation, nets, detail),
    ];
  }, [showValues, simulation, nets, storeDoc, selection, hoveredComponent, reportHighlight]);
  // What the errors and warnings of the simulation point at (#253).
  const marks = useMemo(
    () => (simulation ? diagnosticMarks(storeDoc, simulation, nets ?? {}) : []),
    [simulation, nets, storeDoc],
  );

  useKeyboardShortcuts();
  useUnsavedChangesGuard();
  /** A file from the Explorer is dragged over the schematic (#277). */
  const fileOver = useFileDrop(containerRef);

  /** Fits the view to the whole circuit (F key, "Ajuster" button). */
  const fitView = useCallback(() => {
    setViewport(fitViewport(docBounds(useEditorStore.getState().doc), size.width, size.height));
  }, [size]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== "f" && e.key !== "F")) return;
      e.preventDefault();
      fitView();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fitView]);

  // While dragging, show the dragged items (and the wires they pull) at their new place.
  const doc = drag
    ? moveItems(storeDoc, drag.ids, drag.delta, { detach: drag.detach })
    : partTarget && wirePart
      ? moveWirePart(storeDoc, wirePart, partTarget.target, partTarget.grab)
      : storeDoc;
  // While dragging, the free pins are those left once dropped: a pin landing on a wire is cut in
  // as the drop would do, and what touches is connected (see `unconnectedPins`).
  const freePins = useMemo(() => {
    if (exporting) return [];
    if (drag) {
      const dropped = connectPinsOnWires(connectPinsOnWires(doc, { comps: drag.ids }), {
        wires: new Set(drag.ids),
      });
      return unconnectedPins(dropped);
    }
    if (partTarget && wirePart) {
      return unconnectedPins(connectPinsOnWires(doc, { wires: new Set([wirePart.wire]) }));
    }
    return unconnectedPins(doc);
  }, [doc, exporting, drag, partTarget, wirePart]);
  // Names and values of the components: those placed automatically avoid what is around them.
  const captions = useMemo(() => layoutCaptions(doc), [doc]);
  /** Unconnected pin names of each component: the only pins that keep their square. */
  const freePinsByComp = useMemo(() => {
    const byComp = new Map<string, Set<string>>();
    for (const p of freePins) {
      const pins = byComp.get(p.comp) ?? new Set<string>();
      pins.add(p.pin);
      byComp.set(p.comp, pins);
    }
    return byComp;
  }, [freePins]);
  /** What is drawn as selected (nothing in an exported image). */
  const shownSelection = exporting ? [] : selection;

  /** Wire or pin under the pointer, whose whole node is highlighted (#278). */
  const [hovered, setHovered] = useState<NodeItem | null>(null);
  /**
   * Nodes to highlight: those of the selected wires (strong), then the one under the pointer.
   * Only on the schematic as it is in the store (not while dragging) and with the select tool.
   */
  const highlightedNodes = useMemo((): { node: CircuitNode; strong: boolean }[] => {
    if (exporting || doc !== storeDoc || tool.kind !== "select") return [];
    const index = nodeIndex(storeDoc);
    const out: { node: CircuitNode; strong: boolean }[] = [];
    const add = (node: CircuitNode | null, strong: boolean) => {
      if (node && !out.some((n) => n.node === node)) out.push({ node, strong });
    };
    const wireIds = new Set(selection.filter((id) => storeDoc.wires.some((w) => w.id === id)));
    if (wirePart) wireIds.add(wirePart.wire);
    for (const wire of wireIds) add(index({ wire }), true);
    if (hovered) add(index(hovered), false);
    // A hovered label lights its node, with the other labels of the same name (#295).
    const hoveredLabel = storeDoc.components.find(
      (c) => c.id === hoveredComponent && c.type === "label",
    );
    if (hoveredLabel) add(index({ comp: hoveredLabel.id, pin: "1" }), false);
    if (reportHighlight && !("component" in reportHighlight)) add(index(reportHighlight), true);
    return out;
  }, [
    exporting,
    doc,
    storeDoc,
    tool.kind,
    selection,
    wirePart,
    hovered,
    hoveredComponent,
    reportHighlight,
  ]);

  /** Directions of the labels on "Automatique", from the circuit as drawn (#295). */
  const labelDirections = useMemo(() => autoLabelDirections(doc), [doc]);

  /** The component of a hovered line of the results panel (#292), glowing on the schematic. */
  const highlightedComponent =
    !exporting && doc === storeDoc && reportHighlight && "component" in reportHighlight
      ? storeDoc.components.find((c) => c.id === reportHighlight.component)
      : undefined;

  /** Dragging `c` moves the whole selection if `c` is part of it, else only `c`. */
  const dragIds = (c: { id: string }): ReadonlySet<string> =>
    new Set(selection.includes(c.id) ? selection : [c.id]);
  const deltaFrom = (c: { position: GridPoint }, position: GridPoint): GridPoint => ({
    x: position.x - c.position.x,
    y: position.y - c.position.y,
  });

  // Start with the origin in the middle of the canvas, once its size is known.
  const centered = useRef(false);
  useEffect(() => {
    if (centered.current || size.width === 0) return;
    centered.current = true;
    setViewport({ x: Math.round(size.width / 2), y: Math.round(size.height / 2), scale: 1 });
  }, [size]);

  useEffect(() => () => endPress.current?.(), []);

  // After a right-drag released outside the canvas (over the palette...), the browser would show
  // its context menu there: swallow the one that follows a right press on the canvas.
  const swallowContextMenu = useRef(false);
  useEffect(() => {
    const onMouseDown = () => {
      swallowContextMenu.current = false;
    };
    const onContextMenu = (e: MouseEvent) => {
      if (!swallowContextMenu.current) return;
      swallowContextMenu.current = false;
      e.preventDefault();
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, []);

  const pointerGrid = (): GridPoint | null => {
    const p = stageRef.current?.getRelativePointerPosition();
    return p ? { x: Math.round(p.x / GRID), y: Math.round(p.y / GRID) } : null;
  };

  /**
   * Follows the pointer on the grid. The state only changes when it reaches another grid point:
   * moving within a cell must not redraw the schematic and route the wire being drawn again.
   */
  const trackPointer = () => {
    const p = pointerGrid();
    setPointer((prev) => (prev && p && samePoint(prev, p) ? prev : p));
  };

  /** Zooms by `factor`, keeping the canvas point `p` (pixels) where it is on screen. */
  const zoomAt = useCallback((factor: number, p: { x: number; y: number }) => {
    setViewport((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const wx = (p.x - v.x) / v.scale;
      const wy = (p.y - v.y) / v.scale;
      return { scale, x: p.x - wx * scale, y: p.y - wy * scale };
    });
  }, []);

  // Toolbar zoom buttons: zoom around the middle of the canvas.
  useEffect(() => {
    const centre = { x: size.width / 2, y: size.height / 2 };
    return registerViewCommands({
      zoomIn: () => zoomAt(BUTTON_ZOOM_STEP, centre),
      zoomOut: () => zoomAt(1 / BUTTON_ZOOM_STEP, centre),
      fit: fitView,
      show: (area) => setViewport((v) => showViewport(v, area, size.width, size.height)),
      exportImage: (options) => new Promise((done) => setExporting({ options, done })),
    });
  }, [size, zoomAt, fitView]);

  /**
   * The circuit drawn on a white or transparent background, as a PNG or an SVG (null: nothing to
   * draw). Both show the same area: the circuit and its captions, with a margin around.
   */
  const renderImage = ({ transparent, format = "png" }: ImageOptions): Promise<Blob | null> => {
    const stage = stageRef.current;
    const layer = contentRef.current;
    const box = layer?.getClientRect();
    if (!stage || !layer || !box || box.width === 0 || box.height === 0) {
      return Promise.resolve(null);
    }
    const scale = stage.scaleX();
    if (format === "svg") {
      // Back from screen pixels to the units of the schematic, which the SVG keeps.
      const frame = {
        x: (box.x - stage.x()) / scale - EXPORT_MARGIN,
        y: (box.y - stage.y()) / scale - EXPORT_MARGIN,
        width: box.width / scale + 2 * EXPORT_MARGIN,
        height: box.height / scale + 2 * EXPORT_MARGIN,
      };
      const svg = layerToSvg(layer, frame, transparent);
      return Promise.resolve(new Blob([svg], { type: "image/svg+xml" }));
    }
    const margin = EXPORT_MARGIN * scale;
    const drawn = layer.toCanvas({
      x: box.x - margin,
      y: box.y - margin,
      width: box.width + 2 * margin,
      height: box.height + 2 * margin,
      pixelRatio: EXPORT_PIXEL_RATIO / scale,
    });
    const image = document.createElement("canvas");
    image.width = drawn.width;
    image.height = drawn.height;
    const ctx = image.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    if (!transparent) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, image.width, image.height);
    }
    ctx.drawImage(drawn, 0, 0);
    return new Promise((done) => image.toBlob(done, "image/png"));
  };

  // Image export: once drawn without the editing marks, render the circuit (with its captions)
  // on a white (or transparent) background, whatever the zoom and the part shown on screen.
  useEffect(() => {
    if (!exporting) return;
    // On the next frame: the layers then show the schematic drawn for the export.
    const frame = requestAnimationFrame(() => {
      setExporting(null);
      void renderImage(exporting.options).then(exporting.done);
    });
    return () => cancelAnimationFrame(frame);
  }, [exporting]);

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = stageRef.current?.getPointerPosition();
    // Keep the point under the cursor fixed.
    if (p) zoomAt(e.evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, p);
  };

  /**
   * Right click without moving: leaves the wire being drawn or the current tool (like Escape);
   * with the select tool, opens the menu of the component (or text) clicked.
   */
  const rightClick = (press: Press, e: MouseEvent) => {
    const s = useEditorStore.getState();
    if (s.draft) s.cancelDraft();
    else if (s.tool.kind !== "select") s.cancel();
    else if (
      press.componentId &&
      [...s.doc.components, ...s.doc.texts].some((c) => c.id === press.componentId)
    ) {
      if (!s.selection.includes(press.componentId)) s.select([press.componentId]);
      const box = containerRef.current?.getBoundingClientRect();
      if (box) setMenu({ x: e.clientX - box.left, y: e.clientY - box.top });
    }
  };

  /**
   * Middle or right press: follows the mouse on the window, so the view keeps moving (and stops)
   * even outside the canvas. A right press that barely moves is a click, handled on release.
   */
  const startPress = (e: MouseEvent, button: 1 | 2) => {
    endPress.current?.();
    const press: Press = {
      button,
      x: e.clientX,
      y: e.clientY,
      vx: viewport.x,
      vy: viewport.y,
      panning: button === 1,
      componentId: button === 2 ? rightPressed.current : null,
    };
    rightPressed.current = null;
    setPanning(press.panning);

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - press.x;
      const dy = ev.clientY - press.y;
      if (!press.panning) {
        if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
        press.panning = true;
        setPanning(true);
        setMenu(null);
      }
      setViewport((v) => ({ ...v, x: press.vx + dx, y: press.vy + dy }));
    };
    const onUp = (ev: MouseEvent) => {
      if (ev.button !== press.button) return;
      stop();
      if (press.button === 2 && !press.panning) rightClick(press, ev);
    };
    const stop = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      endPress.current = null;
      setPanning(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    endPress.current = stop;
  };

  /** Pointer position in grid units, not rounded, for a mouse event anywhere on the page. */
  const pointerAt = (ev: MouseEvent): GridPoint | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    stage.setPointersPositions(ev);
    const p = stage.getRelativePointerPosition();
    return p ? { x: p.x / GRID, y: p.y / GRID } : null;
  };

  /**
   * Left press in the void with the select tool: dragging draws a selection rectangle, which
   * selects what is entirely inside it, sections of wires included. With Shift, it toggles what
   * touches it instead (see `selectInRect`). A click without moving clears the selection (not
   * with Shift). Escape while drawing drops the rectangle.
   */
  const startBand = (e: MouseEvent) => {
    endPress.current?.();
    const start = pointerAt(e);
    if (!start) return;
    const touching = e.shiftKey;
    const from = { x: e.clientX, y: e.clientY };
    let rect: GridRect | null = null;

    const onMove = (ev: MouseEvent) => {
      if (!rect && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) <= BAND_THRESHOLD) return;
      const p = pointerAt(ev);
      if (!p) return;
      rect = rectFrom(start, p);
      setBand({ rect, touching });
    };
    const onUp = (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      stop();
      const s = useEditorStore.getState();
      if (!rect) {
        if (!touching) s.select([]);
        return;
      }
      s.selectInRect(rect, touching ? "touching" : "inside");
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      // Keep the global Escape (which clears the selection) from running too.
      ev.stopPropagation();
      ev.preventDefault();
      stop();
    };
    const stop = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKeyDown, true);
      endPress.current = null;
      setBand(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKeyDown, true);
    endPress.current = stop;
  };

  /**
   * Left press on a wire with the select tool: selects the bend or segment under the mouse, and
   * dragging moves it (the wire stays orthogonal). Shift + click adds the whole wire instead.
   */
  const startWirePartPress = (wireId: string, e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.shiftKey) {
      toggleSelected(wireId);
      return;
    }
    const s = useEditorStore.getState();
    const p = pointerAt(e.evt);
    const part = p ? wirePartAt(s.doc, wireId, p) : null;
    if (!p || !part) return;
    s.selectWirePart(part);
    endPress.current?.();
    const start = { x: Math.round(p.x), y: Math.round(p.y) };
    let target: GridPoint | null = null;

    const onMove = (ev: MouseEvent) => {
      const q = pointerAt(ev);
      if (!q) return;
      const g = { x: Math.round(q.x), y: Math.round(q.y) };
      if (!target && g.x === start.x && g.y === start.y) return;
      if (target && g.x === target.x && g.y === target.y) return;
      target = g;
      setPartTarget({ grab: start, target: g });
    };
    const onUp = (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      stop();
      if (target) dropWirePart(part, target, start);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !target) return;
      // Drops the move only; the global Escape would also clear the selection.
      ev.stopPropagation();
      ev.preventDefault();
      stop();
    };
    const stop = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKeyDown, true);
      endPress.current = null;
      setPartTarget(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKeyDown, true);
    endPress.current = stop;
  };

  /** Ends a wire part drag: moves it, and keeps it selected where it landed. */
  const dropWirePart = (part: WirePart, target: GridPoint, grab: GridPoint) => {
    const s = useEditorStore.getState();
    const before = wirePartPoints(s.doc, part);
    if (!before) return;
    // A point that is on the part once moved: the bend itself, or the middle of the segment.
    let on = target;
    const [a, b] = before;
    if (part.kind === "segment" && a && b) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      on =
        a.y === b.y
          ? { x: mid.x + target.x - grab.x, y: target.y }
          : { x: target.x, y: mid.y + target.y - grab.y };
    }
    const landing = wirePartAt(moveWirePart(s.doc, part, target, grab), part.wire, on);
    s.moveWirePart(target, landing?.kind === part.kind ? landing : null, grab);
  };

  const onMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 1) {
      e.evt.preventDefault(); // no auto-scroll
      startPress(e.evt, 1);
      return;
    }
    if (e.evt.button === 2) {
      swallowContextMenu.current = true;
      startPress(e.evt, 2);
      return;
    }
    if (e.evt.button !== 0) return;
    if (tool.kind === "wire") {
      const p = pointerGrid();
      if (p) wireClick(p);
    } else if (tool.kind === "place") {
      const p = pointerGrid();
      if (p) placeAt(p);
    } else if (tool.kind === "paste") {
      const p = pointerGrid();
      if (p) pasteAt(p);
    } else if (tool.kind === "text") {
      const p = pointerGrid();
      if (!p) return;
      placeText(p);
      // The new text is selected: type its content in the properties panel.
      focusInspector();
    } else if (e.target === e.target.getStage()) {
      startBand(e.evt);
    }
  };

  const onMouseMove = () => {
    if (tool.kind !== "select") trackPointer();
  };

  /** `c` as it is in the store (the one drawn may be shifted by the drag in progress). */
  const storeComponent = (c: PlacedComponent): PlacedComponent =>
    storeDoc.components.find((x) => x.id === c.id) ?? c;
  const storeText = (t: EditorText): EditorText => storeDoc.texts.find((x) => x.id === t.id) ?? t;

  /**
   * While dragging `item`: shows the items that follow it moved by `delta` (with Ctrl, `detach`,
   * the wires stay where they are).
   */
  const dragTo = (item: { id: string }, delta: GridPoint, detach: boolean) =>
    setDrag((d) =>
      d && d.delta.x === delta.x && d.delta.y === delta.y && d.detach === detach
        ? d
        : { ids: d?.ids ?? dragIds(item), delta, detach },
    );
  /** End of a drag of `item` by `delta`: moves it with the rest of the selection. */
  const dropAt = (item: { id: string }, delta: GridPoint, detach: boolean) => {
    setDrag(null);
    if (!selection.includes(item.id)) select([item.id]);
    moveSelection(delta, { detach });
  };

  const closeMenu = useCallback(() => setMenu(null), []);
  const closeEditing = useCallback(() => setEditing(null), []);

  const selectItem = (id: string, e: KonvaEventObject<MouseEvent>) => {
    if (tool.kind !== "select") return;
    if (e.evt.shiftKey) toggleSelected(id);
    else if (!selection.includes(id)) select([id]);
  };

  /**
   * Left press on a switch or a push button (#43), with the select tool and without Shift: it is
   * not selected (a click works it). A push button closes at once, until the button is released;
   * a switch toggles on release, unless it was dragged meanwhile.
   */
  const pressSwitch = (c: PlacedComponent) => {
    switchPress.current = { id: c.id, moved: false };
    if (c.type === "push_button") {
      pressButton(c.id);
      resimulateOperatingPoint();
    }
    window.addEventListener(
      "mouseup",
      () => {
        const press = switchPress.current;
        switchPress.current = null;
        if (!press || press.moved) return;
        if (c.type === "push_button") pressButton(null);
        else toggleSwitch(c.id);
        resimulateOperatingPoint();
      },
      { once: true },
    );
  };

  /** A pressed switch or push button that moves is dragged, not worked: it opens again. */
  const switchDragged = (c: PlacedComponent, delta: GridPoint) => {
    const press = switchPress.current;
    if (!press || press.id !== c.id || press.moved || (delta.x === 0 && delta.y === 0)) return;
    press.moved = true;
    if (c.type === "push_button") {
      pressButton(null);
      resimulateOperatingPoint();
    }
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const type = e.dataTransfer.getData(DRAG_TYPE);
    const stage = stageRef.current;
    if (!type || !stage) return;
    e.preventDefault();
    stage.setPointersPositions(e.nativeEvent);
    const p = pointerGrid();
    if (p) dropComponent(type, p);
  };

  const ghost: PlacedComponent | null =
    tool.kind === "place" && pointer
      ? {
          id: "ghost",
          type: tool.type,
          position: pointer,
          rotation: tool.rotation,
          mirror: tool.mirror,
          params: {},
        }
      : null;

  // Pasted or duplicated items, centred on the pointer until a click drops them.
  const pasteGhost = useMemo(() => {
    if (tool.kind !== "paste" || !pointer) return null;
    const clip = tool.clip;
    const anchor = clipAnchor(clip);
    const ids = new Set([
      ...clip.components.map((c) => c.id),
      ...clip.wires.map((w) => w.id),
      ...clip.junctions.map((j) => j.id),
    ]);
    return moveItems(clip, ids, { x: pointer.x - anchor.x, y: pointer.y - anchor.y });
  }, [tool, pointer]);

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minWidth: 0,
        position: "relative",
        overflow: "hidden",
        background: COLORS.background,
        cursor: panning
          ? "grabbing"
          : tool.kind === "select"
            ? "default"
            : tool.kind === "text"
              ? "text"
              : "crosshair",
      }}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setPointer(null)}
      >
        <CanvasColorsContext value={canvasColors}>
          <Layer listening={false} visible={!exporting}>
            <Grid viewport={viewport} width={size.width} height={size.height} />
          </Layer>
          <Layer ref={contentRef}>
            {/* Hidden while something is dragged: the marks are those of the document simulated. */}
            {doc === storeDoc && !exporting && <DiagnosticHalos doc={doc} marks={marks} />}
            {/* Hidden while something is dragged, like the marks: they are those of the document. */}
            {doc === storeDoc &&
              simulation &&
              (simulation.errors ?? []).length === 0 &&
              (simulation.analysis === "op" ||
                (simulation.analysis === "tran" && animation.on)) && (
                <LedGlow
                  doc={storeDoc}
                  result={simulation}
                  animated={simulation.analysis === "tran"}
                />
              )}
            {highlightedComponent && <ComponentHighlight component={highlightedComponent} />}
            {highlightedNodes.map(({ node, strong }, i) => (
              <NodeHighlight key={i} doc={storeDoc} node={node} strong={strong} />
            ))}
            <Wires
              doc={doc}
              selection={shownSelection}
              part={tool.kind === "select" && !exporting ? wirePart : null}
              segments={tool.kind === "select" && !exporting ? segments : []}
              onSelect={tool.kind === "select" ? selectItem : undefined}
              onWirePress={tool.kind === "select" ? startWirePartPress : undefined}
              onWireDoubleClick={tool.kind === "select" ? (id) => select([id]) : undefined}
              onWireHover={(id) => setHovered(id === null ? null : { wire: id })}
            />
            {doc.components.map((c) => (
              <ComponentSymbol
                key={c.id}
                // A push button held down is drawn closed (#43).
                component={
                  pressedButton === c.id
                    ? (simulatedDoc(doc, c.id).components.find((x) => x.id === c.id) ?? c)
                    : c
                }
                autoDirection={labelDirections.get(c.id)}
                selected={shownSelection.includes(c.id)}
                markedPins={freePinsByComp.get(c.id) ?? NO_PINS}
                captions={captions.get(c.id)}
                onCaptionDrag={(kind, centre) => resolveCaptionDrop(doc, c.id, kind, centre)}
                onCaptionMove={(kind, centre) => {
                  if (!selection.includes(c.id)) select([c.id]);
                  moveCaption(c.id, kind, centre);
                }}
                draggable={tool.kind === "select"}
                onSelect={(e) =>
                  tool.kind === "select" && isSwitch(c.type) && !e.evt.shiftKey
                    ? pressSwitch(c)
                    : selectItem(c.id, e)
                }
                onContextPress={() => {
                  rightPressed.current = c.id;
                }}
                onDrag={(position, detach) => {
                  const delta = deltaFrom(storeComponent(c), position);
                  switchDragged(c, delta);
                  dragTo(c, delta, detach);
                }}
                onMove={(position, detach) =>
                  dropAt(c, deltaFrom(storeComponent(c), position), detach)
                }
                onDoubleClick={
                  tool.kind === "select"
                    ? () => {
                        select([c.id]);
                        // A component with no value to type (ground) goes to the panel instead.
                        if (mainParam(getDef(c.type), c.params)) setEditing(c.id);
                        else focusInspector();
                      }
                    : undefined
                }
                onPinHover={(pin) => setHovered(pin === null ? null : { comp: c.id, pin })}
                onHover={(over) =>
                  setHoveredComponent((current) =>
                    over ? c.id : current === c.id ? null : current,
                  )
                }
                onPinMouseDown={
                  tool.kind === "select"
                    ? (pin) => {
                        startWireFrom(pinPosition(c, pin));
                        trackPointer();
                      }
                    : undefined
                }
              />
            ))}
            {doc.texts.map((t) => (
              <FreeText
                key={t.id}
                text={t}
                selected={shownSelection.includes(t.id)}
                draggable={tool.kind === "select"}
                onSelect={(e) => selectItem(t.id, e)}
                onContextPress={() => {
                  rightPressed.current = t.id;
                }}
                onDrag={(position, detach) => dragTo(t, deltaFrom(storeText(t), position), detach)}
                onMove={(position, detach) => dropAt(t, deltaFrom(storeText(t), position), detach)}
                onDoubleClick={
                  tool.kind === "select"
                    ? () => {
                        select([t.id]);
                        focusInspector();
                      }
                    : undefined
                }
              />
            ))}
            {!drag &&
              valueArrows.map((a) => (
                <Arrow
                  key={a.key}
                  points={[a.from.x * GRID, a.from.y * GRID, a.to.x * GRID, a.to.y * GRID]}
                  stroke={valueColor(a.kind)}
                  fill={valueColor(a.kind)}
                  strokeWidth={1.5}
                  pointerLength={6}
                  pointerWidth={6}
                  listening={false}
                />
              ))}
            {!drag &&
              [...valueLabels, ...valueArrows.map((a) => a.label)].map((l) => (
                <ValueText key={l.key} label={l} color={valueColor(l.kind)} />
              ))}
            {freePins.map((p) => (
              <Circle
                key={`${p.comp}/${p.pin}`}
                x={p.position.x * GRID}
                y={p.position.y * GRID}
                radius={UNCONNECTED_RADIUS * GRID}
                fill={canvasColors.freePinFill}
                stroke={canvasColors.pin}
                strokeWidth={1.5}
                listening={false}
              />
            ))}
            {ghost && !exporting && <ComponentSymbol component={ghost} ghost />}
            {pasteGhost && !exporting && (
              <>
                <Group opacity={0.5} listening={false}>
                  <Wires doc={pasteGhost} selection={[]} />
                </Group>
                {pasteGhost.components.map((c) => (
                  <ComponentSymbol key={c.id} component={c} ghost />
                ))}
                {pasteGhost.texts.map((t) => (
                  <FreeText key={t.id} text={t} ghost />
                ))}
              </>
            )}
            {tool.kind === "text" && pointer && !exporting && (
              <FreeText text={{ id: "ghost", position: pointer, content: NEW_TEXT }} ghost />
            )}
            {band && !exporting && (
              // Solid: what is entirely inside. Dashed and green: what touches it (Shift).
              <Rect
                x={band.rect.min.x * GRID}
                y={band.rect.min.y * GRID}
                width={(band.rect.max.x - band.rect.min.x) * GRID}
                height={(band.rect.max.y - band.rect.min.y) * GRID}
                fill={band.touching ? canvasColors.bandTouchFill : canvasColors.bandFill}
                stroke={band.touching ? canvasColors.bandTouch : canvasColors.selected}
                strokeWidth={1 / viewport.scale}
                dash={band.touching ? [4 / viewport.scale, 4 / viewport.scale] : undefined}
                listening={false}
              />
            )}
            {tool.kind === "wire" && !exporting && (
              <WireDraft doc={doc} points={draft?.points ?? null} pointer={pointer} />
            )}
          </Layer>
          {animation.on && simulation && animatable(simulation) && (
            <CurrentLayer doc={storeDoc} result={simulation} settings={animation} />
          )}
        </CanvasColorsContext>
      </Stage>
      <EmptyCanvasHint />
      <ErrorBubbles
        doc={doc}
        viewport={viewport}
        onPick={(comp, param) => {
          select([comp]);
          focusInspector({ param });
        }}
        marks={doc === storeDoc ? marks : []}
        onPickMark={(m) => select([...m.components, ...m.wires, ...m.junctions])}
      />
      <AnimationControls />
      <div
        style={{
          position: "absolute",
          right: 8,
          bottom: 6,
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: COLORS.text,
        }}
      >
        <button
          type="button"
          title="Ajuster la vue au circuit (touche F)"
          aria-keyshortcuts="F"
          onClick={fitView}
          style={{
            font: "inherit",
            padding: "1px 8px",
            border: `1px solid ${UI.border}`,
            borderRadius: 4,
            background: UI.surface,
            color: COLORS.text,
            cursor: "pointer",
          }}
        >
          Ajuster
        </button>
        <span>{Math.round(viewport.scale * 100)} %</span>
      </div>
      {editing && <ValuePopover componentId={editing} viewport={viewport} onClose={closeEditing} />}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={componentMenu(selection.length)}
          onClose={closeMenu}
        />
      )}
      {fileOver && (
        <div
          role="status"
          style={{
            position: "absolute",
            inset: 6,
            display: "grid",
            placeItems: "center",
            border: `2px dashed ${COLORS.selected}`,
            borderRadius: 8,
            background: UI.surfaceTranslucent,
            color: COLORS.selected,
            fontSize: 15,
            fontWeight: 600,
            pointerEvents: "none",
          }}
        >
          Déposer pour ouvrir le schéma
        </div>
      )}
      <CloseDialog />
      <RecoveryPrompt />
    </div>
  );
}
