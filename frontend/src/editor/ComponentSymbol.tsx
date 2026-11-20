import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Line, Rect, Text } from "react-konva";

import {
  getDef,
  symbolBounds,
  toWorld,
  visibleParams,
  type Bounds,
  type ComponentDef,
  type PlacedComponent,
  type SymbolShape,
} from "../store";
import { arcPoints } from "./symbolGeometry";
import { COLORS, GRID } from "./theme";

const STROKE = 2;
const TEXT_WIDTH = 80;
const FONT_SIZE = 12;
/** Space between the symbol and its caption, in grid units. */
const CAPTION_GAP = 0.3;
const PIN_SIZE = 0.3;
/** Clickable area around a pin, larger than its drawn square. */
const PIN_HIT = 0.8;

function setCursor(e: KonvaEventObject<MouseEvent>, cursor: string) {
  const container = e.target.getStage()?.container();
  if (container) container.style.cursor = cursor;
}

function SymbolShapeNode({ shape, color }: { shape: SymbolShape; color: string }) {
  const common = { stroke: color, strokeWidth: STROKE, listening: false } as const;
  switch (shape.kind) {
    case "line":
      return <Line {...common} points={shape.points.map((v) => v * GRID)} lineCap="round" />;
    case "rect":
      return (
        <Rect
          {...common}
          x={shape.x * GRID}
          y={shape.y * GRID}
          width={shape.width * GRID}
          height={shape.height * GRID}
        />
      );
    case "circle":
      return (
        <Circle {...common} x={shape.x * GRID} y={shape.y * GRID} radius={shape.radius * GRID} />
      );
    case "arc":
      return <Line {...common} points={arcPoints(shape)} lineCap="round" />;
  }
}

/**
 * Text shown next to the component: its name and main value (or the net name for a label).
 * A source that is not DC shows its waveform ("Impulsion"), since one value would mislead.
 */
function caption(c: PlacedComponent, def: ComponentDef): string | null {
  if (c.type === "ground") return null;
  if (c.type === "label") return c.params.net ?? "";
  const name = c.name ?? "";
  const waveform = def.params.find((p) => p.name === "waveform");
  const selected = waveform?.options.find((o) => o.value === c.params.waveform);
  if (selected && selected.value !== "dc") return `${name}\n${selected.label}`;
  const main = visibleParams(def, c.params).find((p) => p.kind === "value");
  const value = main ? (c.params[main.name] ?? "") : "";
  return value ? `${name}\n${value}${main?.unit ?? ""}` : name;
}

interface CaptionBox {
  /** Top-left corner of the text box, in pixels relative to the component position. */
  x: number;
  y: number;
  align: "left" | "center" | "right";
}

/**
 * Where to draw the caption so it never covers the symbol, its pins or its marks ("+", arrow).
 * The symbol bounds are turned like the symbol first; the caption then goes right of a vertical
 * symbol (centred on it) or centred above a horizontal one.
 */
function captionPlacement(c: PlacedComponent, bounds: Bounds, text: string): CaptionBox {
  const origin = { ...c, position: { x: 0, y: 0 } };
  const a = toWorld(bounds.min, origin);
  const b = toWorld(bounds.max, origin);
  const min = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
  const max = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
  const height = text.split("\n").length * FONT_SIZE;

  if (c.type === "label") {
    // A label's net name follows the flag's tip, wherever the flag points.
    const tip = toWorld({ x: bounds.max.x + 0.3, y: 0 }, origin);
    const right = tip.x >= -0.01;
    return {
      x: tip.x * GRID - (right ? 0 : TEXT_WIDTH),
      y: tip.y * GRID - height / 2,
      align: right ? "left" : "right",
    };
  }
  const centre = { x: ((min.x + max.x) / 2) * GRID, y: ((min.y + max.y) / 2) * GRID };
  if (max.y - min.y >= max.x - min.x) {
    return { x: (max.x + CAPTION_GAP) * GRID, y: centre.y - height / 2, align: "left" };
  }
  return {
    x: centre.x - TEXT_WIDTH / 2,
    y: (min.y - CAPTION_GAP) * GRID - height,
    align: "center",
  };
}

interface ComponentSymbolProps {
  component: PlacedComponent;
  selected?: boolean;
  ghost?: boolean;
  draggable?: boolean;
  onSelect?: (e: KonvaEventObject<MouseEvent>) => void;
  /** Right press on the component (the canvas decides on release what it means). */
  onContextPress?: () => void;
  /** While dragging: the grid position the component would be dropped at. */
  onDrag?: (position: { x: number; y: number }) => void;
  /** End of a drag, with the grid position the component was dropped at. */
  onMove?: (position: { x: number; y: number }) => void;
  /** Left press on a pin. When set, the pins are clickable (and do not start a drag). */
  onPinMouseDown?: (pin: string) => void;
  /** Left double-click on the component (not on one of its clickable pins). */
  onDoubleClick?: () => void;
}

/**
 * A placed component. The outer group only translates (and is what gets dragged); the inner
 * group applies mirror then rotation, so the caption stays upright and readable.
 */
export function ComponentSymbol({
  component: c,
  selected = false,
  ghost = false,
  draggable = false,
  onSelect,
  onContextPress,
  onDrag,
  onMove,
  onPinMouseDown,
  onDoubleClick,
}: ComponentSymbolProps) {
  const def = getDef(c.type);
  const color = selected ? COLORS.selected : COLORS.symbol;
  const bounds = symbolBounds(def);
  const pad = 0.3;

  const text = caption(c, def);
  const textBox = text === null ? null : captionPlacement(c, bounds, text);

  const snap = (v: number) => Math.round(v / GRID) * GRID;

  return (
    <Group
      x={c.position.x * GRID}
      y={c.position.y * GRID}
      opacity={ghost ? 0.5 : 1}
      listening={!ghost}
      draggable={draggable}
      onMouseDown={(e) => {
        if (e.evt.button === 0) onSelect?.(e);
        else if (e.evt.button === 2) onContextPress?.();
      }}
      onDblClick={(e) => {
        if (e.evt.button === 0) onDoubleClick?.();
      }}
      onDragMove={(e) => {
        const node = e.target;
        node.position({ x: snap(node.x()), y: snap(node.y()) });
        onDrag?.({ x: Math.round(node.x() / GRID), y: Math.round(node.y() / GRID) });
      }}
      onDragEnd={(e) => {
        const node = e.target;
        const position = { x: Math.round(node.x() / GRID), y: Math.round(node.y() / GRID) };
        // Force the node onto the grid even if the store value does not change.
        node.position({ x: position.x * GRID, y: position.y * GRID });
        onMove?.(position);
      }}
    >
      <Group rotation={c.rotation} scaleX={c.mirror ? -1 : 1}>
        {/* Transparent hit area: thin symbol lines alone are hard to click. */}
        <Rect
          x={(bounds.min.x - pad) * GRID}
          y={(bounds.min.y - pad) * GRID}
          width={(bounds.max.x - bounds.min.x + 2 * pad) * GRID}
          height={(bounds.max.y - bounds.min.y + 2 * pad) * GRID}
          fill="rgba(0,0,0,0)"
          stroke={selected ? COLORS.selected : undefined}
          strokeWidth={selected ? 1 : 0}
          dash={[4, 4]}
        />
        {def.symbol.map((shape, i) => (
          <SymbolShapeNode key={i} shape={shape} color={color} />
        ))}
        {def.pins.map((pin) => (
          <Rect
            key={pin.name}
            x={(pin.x - PIN_SIZE / 2) * GRID}
            y={(pin.y - PIN_SIZE / 2) * GRID}
            width={PIN_SIZE * GRID}
            height={PIN_SIZE * GRID}
            stroke={COLORS.pin}
            strokeWidth={1}
            listening={false}
          />
        ))}
        {onPinMouseDown &&
          def.pins.map((pin) => (
            <Rect
              key={`hit-${pin.name}`}
              x={(pin.x - PIN_HIT / 2) * GRID}
              y={(pin.y - PIN_HIT / 2) * GRID}
              width={PIN_HIT * GRID}
              height={PIN_HIT * GRID}
              fill="rgba(0,0,0,0)"
              onMouseEnter={(e) => setCursor(e, "crosshair")}
              onMouseLeave={(e) => setCursor(e, "")}
              onMouseDown={(e) => {
                if (e.evt.button !== 0) return;
                // Keep the press from reaching the group, which would select and drag it.
                e.cancelBubble = true;
                setCursor(e, "");
                onPinMouseDown(pin.name);
              }}
            />
          ))}
      </Group>
      {text !== null && textBox !== null && (
        <Text
          text={text}
          x={textBox.x}
          y={textBox.y}
          width={TEXT_WIDTH}
          align={textBox.align}
          fontSize={FONT_SIZE}
          fill={selected ? COLORS.selected : COLORS.text}
          listening={false}
        />
      )}
    </Group>
  );
}
