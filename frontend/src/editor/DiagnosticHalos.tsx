import { Circle, Group, Line, Rect } from "react-konva";

import { componentBox, wirePath, type DiagnosticMark, type EditorDoc } from "../store";
import { GRID, useCanvasColors } from "./theme";

/** Width of the halo around a wire, in pixels at zoom 1. */
const WIRE_HALO = 10;
/** Space between a component's symbol and its frame, in grid units. */
const FRAME_MARGIN = 0.3;
/** Radius of the ring around a pin or a junction, in grid units. */
const RING = 0.45;
/** Opacity of the halos: the wires and symbols stay readable through them. */
const OPACITY = 0.35;

/**
 * Halos, in the colour of the error (or warning), under the elements a simulation's diagnostics
 * point at (#253): the wires of a floating node, the sources of a loop... Drawn under the
 * schematic, so a selected element keeps its own colour on top.
 */
export function DiagnosticHalos({ doc, marks }: { doc: EditorDoc; marks: DiagnosticMark[] }) {
  const colors = useCanvasColors();
  return (
    <Group listening={false}>
      {marks.map((m) => {
        const color = m.level === "error" ? colors.error : colors.warning;
        return (
          <Group key={m.key}>
            {m.wires.map((id) => {
              const wire = doc.wires.find((w) => w.id === id);
              if (!wire) return null;
              return (
                <Line
                  key={id}
                  points={wirePath(doc, wire).flatMap((p) => [p.x * GRID, p.y * GRID])}
                  stroke={color}
                  strokeWidth={WIRE_HALO}
                  opacity={OPACITY}
                  lineCap="round"
                  lineJoin="round"
                />
              );
            })}
            {m.components.map((id) => {
              const c = doc.components.find((x) => x.id === id);
              if (!c) return null;
              const box = componentBox(c);
              return (
                <Rect
                  key={id}
                  x={(box.min.x - FRAME_MARGIN) * GRID}
                  y={(box.min.y - FRAME_MARGIN) * GRID}
                  width={(box.max.x - box.min.x + 2 * FRAME_MARGIN) * GRID}
                  height={(box.max.y - box.min.y + 2 * FRAME_MARGIN) * GRID}
                  cornerRadius={4}
                  fill={color}
                  opacity={OPACITY}
                />
              );
            })}
            {[
              ...m.pins,
              ...m.junctions.flatMap(
                (id) => doc.junctions.find((j) => j.id === id)?.position ?? [],
              ),
            ].map((p, i) => (
              <Circle
                key={`p${i}`}
                x={p.x * GRID}
                y={p.y * GRID}
                radius={RING * GRID}
                fill={color}
                opacity={OPACITY}
              />
            ))}
          </Group>
        );
      })}
    </Group>
  );
}
