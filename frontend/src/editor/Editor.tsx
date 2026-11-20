import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Circle, Layer, Rect, Stage } from "react-konva";

import {
  animatable,
  docBounds,
  freshSimulation,
  itemsInRect,
  moveItems,
  moveWirePart,
  pinPosition,
  rectFrom,
  samePoint,
  unconnectedPins,
  useEditorStore,
  wirePartAt,
  wirePartPoints,
  type GridPoint,
  type GridRect,
  type PlacedComponent,
  type WirePart,
} from "../store";
import { AnimationControls } from "./AnimationControls";
import { ComponentSymbol } from "./ComponentSymbol";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { Grid, type Viewport } from "./Grid";
import { fitViewport } from "./fitView";
import { newFile, openFile, saveFile } from "./fileActions";
import { CurrentLayer } from "./CurrentLayer";
import { focusInspector } from "./inspectorFocus";
import { DRAG_TYPE } from "./Palette";
import { entryForKey } from "./paletteLayout";
import { COLORS, GRID, MAX_SCALE, MIN_SCALE, UI } from "./theme";
import { registerViewCommands } from "./viewCommands";
import { WireDraft, Wires } from "./Wires";

const ZOOM_STEP = 1.1;
/** Zoom factor of the toolbar zoom buttons (bigger than one wheel step). */
const BUTTON_ZOOM_STEP = 1.25;
/** Radius of the ring drawn around a pin connected to nothing, in grid units. */
const UNCONNECTED_RADIUS = 0.4;
/** A right press that moves more than this (screen pixels) pans the view instead of clicking. */
const DRAG_THRESHOLD = 4;
/** A left press in the void that moves more than this (screen pixels) draws a selection box. */
const BAND_THRESHOLD = 3;

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
  /** Component under the right press, if any. */
  componentId: string | null;
}

/** Actions of the menu opened by a right click on a component; they apply to the selection. */
function componentMenu(selectionSize: number): MenuItem[] {
  const s = () => useEditorStore.getState();
  return [
    { label: "Tourner", shortcut: "R", keys: ["r", "R"], onSelect: () => s().rotate() },
    { label: "Miroir", shortcut: "M", keys: ["m", "M"], onSelect: () => s().mirror() },
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
        else if (key === "n") newFile();
        else if (key === "o") openFile();
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
        s.moveSelection(arrow, true);
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
          s.rotate();
          break;
        case "m":
        case "M":
          s.mirror();
          break;
        case "w":
        case "W":
          s.startWiring();
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
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [pointer, setPointer] = useState<GridPoint | null>(null);
  const [panning, setPanning] = useState(false);
  /** Selection rectangle being drawn (grid units). */
  const [band, setBand] = useState<GridRect | null>(null);
  /** Context menu, at this position in the canvas. */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  /** Component under the right press being handled (set by the component, read by the stage). */
  const rightPressed = useRef<string | null>(null);
  /** Items being dragged and how far (grid units): shown moved before the store changes. */
  const [drag, setDrag] = useState<{ ids: ReadonlySet<string>; delta: GridPoint } | null>(null);
  /** Where the selected wire part is being dragged (grid point), before the store changes. */
  const [partTarget, setPartTarget] = useState<GridPoint | null>(null);
  /** Removes the window listeners of the press in progress, if any. */
  const endPress = useRef<(() => void) | null>(null);

  const storeDoc = useEditorStore((s) => s.doc);
  const selection = useEditorStore((s) => s.selection);
  const wirePart = useEditorStore((s) => s.wirePart);
  const tool = useEditorStore((s) => s.tool);
  const placeAt = useEditorStore((s) => s.placeAt);
  const select = useEditorStore((s) => s.select);
  const toggleSelected = useEditorStore((s) => s.toggleSelected);
  const moveSelection = useEditorStore((s) => s.moveSelection);
  const draft = useEditorStore((s) => s.draft);
  const wireClick = useEditorStore((s) => s.wireClick);
  const startWireFrom = useEditorStore((s) => s.startWireFrom);
  const dropComponent = useEditorStore((s) => s.dropComponent);
  const simulation = useEditorStore(freshSimulation);
  const animation = useEditorStore((s) => s.animation);

  useKeyboardShortcuts();

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
    ? moveItems(storeDoc, drag.ids, drag.delta)
    : partTarget && wirePart
      ? moveWirePart(storeDoc, wirePart, partTarget)
      : storeDoc;
  const freePins = useMemo(() => unconnectedPins(doc), [doc]);

  /** Dragging `c` moves the whole selection if `c` is part of it, else only `c`. */
  const dragIds = (c: PlacedComponent): ReadonlySet<string> =>
    new Set(selection.includes(c.id) ? selection : [c.id]);
  const deltaFrom = (c: PlacedComponent, position: GridPoint): GridPoint => ({
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
    });
  }, [size, zoomAt, fitView]);

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = stageRef.current?.getPointerPosition();
    // Keep the point under the cursor fixed.
    if (p) zoomAt(e.evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, p);
  };

  /**
   * Right click without moving: leaves the wire being drawn or the current tool (like Escape);
   * with the select tool, opens the menu of the component clicked.
   */
  const rightClick = (press: Press, e: MouseEvent) => {
    const s = useEditorStore.getState();
    if (s.draft) s.cancelDraft();
    else if (s.tool.kind !== "select") s.cancel();
    else if (press.componentId && s.doc.components.some((c) => c.id === press.componentId)) {
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
   * selects what is entirely inside it (Shift adds to the selection). A click without moving
   * clears the selection. Escape while drawing drops the rectangle.
   */
  const startBand = (e: MouseEvent) => {
    endPress.current?.();
    const start = pointerAt(e);
    if (!start) return;
    const additive = e.shiftKey;
    const from = { x: e.clientX, y: e.clientY };
    let rect: GridRect | null = null;

    const onMove = (ev: MouseEvent) => {
      if (!rect && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) <= BAND_THRESHOLD) return;
      const p = pointerAt(ev);
      if (!p) return;
      rect = rectFrom(start, p);
      setBand(rect);
    };
    const onUp = (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      stop();
      const s = useEditorStore.getState();
      if (!rect) {
        if (!additive) s.select([]);
        return;
      }
      const inside = itemsInRect(s.doc, rect);
      s.select(additive ? [...new Set([...s.selection, ...inside])] : inside);
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
      setPartTarget(g);
    };
    const onUp = (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      stop();
      if (target) dropWirePart(part, target);
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
  const dropWirePart = (part: WirePart, target: GridPoint) => {
    const s = useEditorStore.getState();
    const before = wirePartPoints(s.doc, part);
    if (!before) return;
    // A point that is on the part once moved: the bend itself, or the middle of the segment.
    let on = target;
    const [a, b] = before;
    if (part.kind === "segment" && a && b) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      on = a.y === b.y ? { x: mid.x, y: target.y } : { x: target.x, y: mid.y };
    }
    const landing = wirePartAt(moveWirePart(s.doc, part, target), part.wire, on);
    s.moveWirePart(target, landing?.kind === part.kind ? landing : null);
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

  const closeMenu = useCallback(() => setMenu(null), []);

  const selectItem = (id: string, e: KonvaEventObject<MouseEvent>) => {
    if (tool.kind !== "select") return;
    if (e.evt.shiftKey) toggleSelected(id);
    else if (!selection.includes(id)) select([id]);
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

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minWidth: 0,
        position: "relative",
        overflow: "hidden",
        background: COLORS.background,
        cursor: panning ? "grabbing" : tool.kind === "select" ? "default" : "crosshair",
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
        <Layer listening={false}>
          <Grid viewport={viewport} width={size.width} height={size.height} />
        </Layer>
        <Layer>
          <Wires
            doc={doc}
            selection={selection}
            part={tool.kind === "select" ? wirePart : null}
            onSelect={tool.kind === "select" ? selectItem : undefined}
            onWirePress={tool.kind === "select" ? startWirePartPress : undefined}
            onWireDoubleClick={tool.kind === "select" ? (id) => select([id]) : undefined}
          />
          {doc.components.map((c) => (
            <ComponentSymbol
              key={c.id}
              component={c}
              selected={selection.includes(c.id)}
              draggable={tool.kind === "select"}
              onSelect={(e) => selectItem(c.id, e)}
              onContextPress={() => {
                rightPressed.current = c.id;
              }}
              onDrag={(position) => {
                const delta = deltaFrom(storeComponent(c), position);
                setDrag((d) =>
                  d && d.delta.x === delta.x && d.delta.y === delta.y
                    ? d
                    : { ids: d?.ids ?? dragIds(c), delta },
                );
              }}
              onMove={(position) => {
                setDrag(null);
                if (!selection.includes(c.id)) select([c.id]);
                moveSelection(deltaFrom(storeComponent(c), position));
              }}
              onDoubleClick={
                tool.kind === "select"
                  ? () => {
                      select([c.id]);
                      focusInspector({ value: true });
                    }
                  : undefined
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
          {freePins.map((p) => (
            <Circle
              key={`${p.comp}/${p.pin}`}
              x={p.position.x * GRID}
              y={p.position.y * GRID}
              radius={UNCONNECTED_RADIUS * GRID}
              fill="rgba(220, 38, 38, 0.15)"
              stroke={COLORS.pin}
              strokeWidth={1.5}
              listening={false}
            />
          ))}
          {ghost && <ComponentSymbol component={ghost} ghost />}
          {band && (
            <Rect
              x={band.min.x * GRID}
              y={band.min.y * GRID}
              width={(band.max.x - band.min.x) * GRID}
              height={(band.max.y - band.min.y) * GRID}
              fill="rgba(37, 99, 235, 0.08)"
              stroke={COLORS.selected}
              strokeWidth={1 / viewport.scale}
              dash={[4 / viewport.scale, 4 / viewport.scale]}
              listening={false}
            />
          )}
          {tool.kind === "wire" && (
            <WireDraft doc={doc} points={draft?.points ?? null} pointer={pointer} />
          )}
        </Layer>
        {animation.on && simulation && animatable(simulation) && (
          <CurrentLayer doc={storeDoc} result={simulation} settings={animation} />
        )}
      </Stage>
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
            background: "#ffffff",
            color: COLORS.text,
            cursor: "pointer",
          }}
        >
          Ajuster
        </button>
        <span>{Math.round(viewport.scale * 100)} %</span>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={componentMenu(selection.length)}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
