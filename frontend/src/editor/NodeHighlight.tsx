import { Circle, Group, Line, Rect } from "react-konva";

import {
  componentBox,
  getDef,
  pinPosition,
  wirePath,
  type CircuitNode,
  type EditorDoc,
  type PlacedComponent,
} from "../store";
import { GRID, useCanvasColors } from "./theme";

/** Width of the glow under the wires, and radius of the one on the pins, in pixels. */
const GLOW_WIDTH = 9;
const PIN_GLOW_RADIUS = 6;

/** Opacity of the glow: light under the pointer, stronger for a selected wire. */
const HOVER_OPACITY = 0.35;
const SELECTED_OPACITY = 0.6;

/**
 * Glow under every wire and pin of a node (#278), drawn below the wires so that they keep their
 * own colour (and the selection its blue) on top of it.
 */
export function NodeHighlight({
  doc,
  node,
  strong = false,
}: {
  doc: EditorDoc;
  node: CircuitNode;
  /** The node of a selected wire: more visible than a hover. */
  strong?: boolean;
}) {
  const colors = useCanvasColors();
  const opacity = strong ? SELECTED_OPACITY : HOVER_OPACITY;
  return (
    <Group listening={false} opacity={opacity}>
      {doc.wires
        .filter((w) => node.wires.has(w.id))
        .map((w) => (
          <Line
            key={w.id}
            points={wirePath(doc, w).flatMap((p) => [p.x * GRID, p.y * GRID])}
            stroke={colors.nodeGlow}
            strokeWidth={GLOW_WIDTH}
            lineCap="round"
            lineJoin="round"
          />
        ))}
      {node.pins.map(({ comp, pin }) => {
        const c = doc.components.find((x) => x.id === comp);
        if (!c) return null;
        const p = pinPosition(c, pin);
        return (
          <Circle
            key={`${comp}/${pin}`}
            x={p.x * GRID}
            y={p.y * GRID}
            radius={PIN_GLOW_RADIUS}
            fill={colors.nodeGlow}
          />
        );
      })}
    </Group>
  );
}

/** Margin of the glow around a component's symbol, in grid units. */
const COMPONENT_GLOW_MARGIN = 0.3;

/**
 * Glow over a component and its pins, below the symbol: the component of a hovered line of the
 * results panel (#292).
 */
export function ComponentHighlight({ component }: { component: PlacedComponent }) {
  const colors = useCanvasColors();
  const { min, max } = componentBox(component);
  const m = COMPONENT_GLOW_MARGIN;
  return (
    <Group listening={false} opacity={SELECTED_OPACITY}>
      <Rect
        x={(min.x - m) * GRID}
        y={(min.y - m) * GRID}
        width={(max.x - min.x + 2 * m) * GRID}
        height={(max.y - min.y + 2 * m) * GRID}
        cornerRadius={GRID / 2}
        fill={colors.nodeGlow}
      />
      {getDef(component.type).pins.map((pin) => {
        const p = pinPosition(component, pin.name);
        return (
          <Circle
            key={pin.name}
            x={p.x * GRID}
            y={p.y * GRID}
            radius={PIN_GLOW_RADIUS}
            fill={colors.nodeGlow}
          />
        );
      })}
    </Group>
  );
}
