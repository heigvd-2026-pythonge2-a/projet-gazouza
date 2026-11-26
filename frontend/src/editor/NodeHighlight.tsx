import { Circle, Group, Line } from "react-konva";

import { pinPosition, wirePath, type CircuitNode, type EditorDoc } from "../store";
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
