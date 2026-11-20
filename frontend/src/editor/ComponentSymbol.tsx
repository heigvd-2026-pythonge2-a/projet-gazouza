import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Line, Rect, Text } from "react-konva";

import {
  getDef,
  symbolBounds,
  toWorld,
  type ComponentDef,
  type PlacedComponent,
  type SymbolShape,
} from "../store";
import { COLORS, GRID } from "./theme";

const STROKE = 2;
const TEXT_WIDTH = 80;
const PIN_SIZE = 0.3;
/** Clickable area around a pin, larger than its drawn square. */
const PIN_HIT = 0.8;

function setCursor(e: KonvaEventObject<MouseEvent>, cursor: string) {
  const container = e.target.getStage()?.container();
  if (container) container.style.cursor = cursor;
}

function arcPoints(s: Extract<SymbolShape, { kind: "arc" }>): number[] {
  const points: number[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const a = ((s.start + (s.sweep * i) / steps) * Math.PI) / 180;
    points.push((s.x + s.radius * Math.cos(a)) * GRID, (s.y + s.radius * Math.sin(a)) * GRID);
  }
  return points;
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

/** Text shown next to the component: its name and main value (or the net name for a label). */
function caption(c: PlacedComponent, def: ComponentDef): string | null {
  if (c.type === "ground") return null;
  if (c.type === "label") return c.params.net ?? "";
  const main = def.params.find((p) => p.name !== "waveform");
  const value = main ? (c.params[main.name] ?? "") : "";
  return value ? `${c.name}\n${value}${main?.unit ?? ""}` : c.name;
}

interface ComponentSymbolProps {
  component: PlacedComponent;
  selected?: boolean;
  ghost?: boolean;
  draggable?: boolean;
  onSelect?: (e: KonvaEventObject<MouseEvent>) => void;
  onMove?: (position: { x: number; y: number }) => void;
  /** Left press on a pin. When set, the pins are clickable (and do not start a drag). */
  onPinMouseDown?: (pin: string) => void;
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
  onMove,
  onPinMouseDown,
}: ComponentSymbolProps) {
  const def = getDef(c.type);
  const color = selected ? COLORS.selected : COLORS.symbol;
  const bounds = symbolBounds(def);
  const pad = 0.3;

  // Caption anchor: right of the symbol at rotation 0, then transformed like the symbol.
  const anchorLocal =
    c.type === "label" ? { x: bounds.max.x + 0.3, y: 0 } : { x: bounds.max.x + 0.4, y: -0.6 };
  const anchor = toWorld(anchorLocal, { ...c, position: { x: 0, y: 0 } });
  const text = caption(c, def);
  const alignRight = anchor.x < -0.01;

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
      }}
      onDragMove={(e) => {
        const node = e.target;
        node.position({ x: snap(node.x()), y: snap(node.y()) });
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
      {text !== null && (
        <Text
          text={text}
          x={anchor.x * GRID - (alignRight ? TEXT_WIDTH : 0)}
          y={anchor.y * GRID - (c.type === "label" ? 6 : 0)}
          width={TEXT_WIDTH}
          align={alignRight ? "right" : "left"}
          fontSize={12}
          fill={selected ? COLORS.selected : COLORS.text}
          listening={false}
        />
      )}
    </Group>
  );
}
