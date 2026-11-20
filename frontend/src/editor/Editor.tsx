import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Layer, Stage } from "react-konva";

import { pinPosition, useEditorStore, type GridPoint, type PlacedComponent } from "../store";
import { ComponentSymbol } from "./ComponentSymbol";
import { Grid, type Viewport } from "./Grid";
import { DRAG_TYPE } from "./Palette";
import { COLORS, GRID, MAX_SCALE, MIN_SCALE } from "./theme";
import { WireDraft, Wires } from "./Wires";

const ZOOM_STEP = 1.1;

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
        // Undo / redo. In a text field the browser's own undo applies instead (returned above).
        const key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) s.undo();
        else if (key === "y" || (key === "z" && e.shiftKey)) s.redo();
        else return;
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
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
  const panStart = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const doc = useEditorStore((s) => s.doc);
  const selection = useEditorStore((s) => s.selection);
  const tool = useEditorStore((s) => s.tool);
  const placeAt = useEditorStore((s) => s.placeAt);
  const select = useEditorStore((s) => s.select);
  const toggleSelected = useEditorStore((s) => s.toggleSelected);
  const moveComponent = useEditorStore((s) => s.moveComponent);
  const draft = useEditorStore((s) => s.draft);
  const wireClick = useEditorStore((s) => s.wireClick);
  const startWireFrom = useEditorStore((s) => s.startWireFrom);
  const cancelDraft = useEditorStore((s) => s.cancelDraft);
  const dropComponent = useEditorStore((s) => s.dropComponent);

  useKeyboardShortcuts();

  // Start with the origin in the middle of the canvas, once its size is known.
  const centered = useRef(false);
  useEffect(() => {
    if (centered.current || size.width === 0) return;
    centered.current = true;
    setViewport({ x: Math.round(size.width / 2), y: Math.round(size.height / 2), scale: 1 });
  }, [size]);

  const pointerGrid = (): GridPoint | null => {
    const p = stageRef.current?.getRelativePointerPosition();
    return p ? { x: Math.round(p.x / GRID), y: Math.round(p.y / GRID) } : null;
  };

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    if (!p) return;
    setViewport((v) => {
      const factor = e.evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      // Keep the point under the cursor fixed.
      const wx = (p.x - v.x) / v.scale;
      const wy = (p.y - v.y) / v.scale;
      return { scale, x: p.x - wx * scale, y: p.y - wy * scale };
    });
  };

  const onMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 1) {
      // Middle button: pan.
      e.evt.preventDefault();
      panStart.current = { x: e.evt.clientX, y: e.evt.clientY, vx: viewport.x, vy: viewport.y };
      return;
    }
    if (e.evt.button === 2) {
      if (draft) cancelDraft();
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
      select([]);
    }
  };

  const onMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    const pan = panStart.current;
    if (pan) {
      setViewport((v) => ({
        ...v,
        x: pan.vx + e.evt.clientX - pan.x,
        y: pan.vy + e.evt.clientY - pan.y,
      }));
    }
    if (tool.kind !== "select") setPointer(pointerGrid());
  };

  const endPan = () => {
    panStart.current = null;
  };

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
        cursor: tool.kind === "select" ? "default" : "crosshair",
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
        onMouseUp={endPan}
        onMouseLeave={() => {
          endPan();
          setPointer(null);
        }}
      >
        <Layer listening={false}>
          <Grid viewport={viewport} width={size.width} height={size.height} />
        </Layer>
        <Layer>
          <Wires
            doc={doc}
            selection={selection}
            onSelect={tool.kind === "select" ? selectItem : undefined}
          />
          {doc.components.map((c) => (
            <ComponentSymbol
              key={c.id}
              component={c}
              selected={selection.includes(c.id)}
              draggable={tool.kind === "select"}
              onSelect={(e) => selectItem(c.id, e)}
              onMove={(position) => moveComponent(c.id, position)}
              onPinMouseDown={
                tool.kind === "select"
                  ? (pin) => {
                      startWireFrom(pinPosition(c, pin));
                      setPointer(pointerGrid());
                    }
                  : undefined
              }
            />
          ))}
          {ghost && <ComponentSymbol component={ghost} ghost />}
          {tool.kind === "wire" && (
            <WireDraft doc={doc} points={draft?.points ?? null} pointer={pointer} />
          )}
        </Layer>
      </Stage>
      <div
        style={{
          position: "absolute",
          right: 8,
          bottom: 6,
          fontSize: 12,
          color: COLORS.text,
          pointerEvents: "none",
        }}
      >
        {Math.round(viewport.scale * 100)} %
      </div>
    </div>
  );
}
