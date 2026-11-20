import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Line } from "react-konva";

import {
  anchorAt,
  endPosition,
  routeThrough,
  routeTo,
  wirePath,
  type EditorDoc,
  type GridPoint,
} from "../store";
import { COLORS, GRID } from "./theme";

const WIRE_WIDTH = 2;
/** Clickable width of a wire, in pixels. */
const WIRE_HIT = 10;
const DOT_RADIUS = 4;

const flat = (points: readonly GridPoint[]) => points.flatMap((p) => [p.x * GRID, p.y * GRID]);

/** Points where a dot is drawn: junctions, and pins that two or more wires attach to. */
function dotPositions(doc: EditorDoc): { id: string; position: GridPoint }[] {
  const pins = new Map<string, { count: number; position: GridPoint }>();
  for (const w of doc.wires) {
    for (const end of [w.from, w.to]) {
      if (!("comp" in end)) continue;
      const key = `pin-${end.comp}-${end.pin}`;
      const entry = pins.get(key) ?? { count: 0, position: endPosition(doc, end) };
      pins.set(key, { ...entry, count: entry.count + 1 });
    }
  }
  return [
    ...doc.junctions.map((j) => ({ id: j.id, position: j.position })),
    ...[...pins]
      .filter(([, pin]) => pin.count >= 2)
      .map(([id, pin]) => ({ id, position: pin.position })),
  ];
}

interface WiresProps {
  doc: EditorDoc;
  selection: readonly string[];
  /** Left press on a wire or junction, with the select tool. */
  onSelect?: (id: string, e: KonvaEventObject<MouseEvent>) => void;
}

/** Wires of the document, and the dots of their junctions. */
export function Wires({ doc, selection, onSelect }: WiresProps) {
  const color = (id: string) => (selection.includes(id) ? COLORS.selected : COLORS.wire);
  const press = (id: string) => (e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 0) onSelect?.(id, e);
  };
  return (
    <Group>
      {doc.wires.map((w) => (
        <Line
          key={w.id}
          points={flat(wirePath(doc, w))}
          stroke={color(w.id)}
          strokeWidth={WIRE_WIDTH}
          hitStrokeWidth={WIRE_HIT}
          lineCap="round"
          lineJoin="round"
          listening={onSelect !== undefined}
          onMouseDown={press(w.id)}
        />
      ))}
      {dotPositions(doc).map((d) => (
        <Circle
          key={d.id}
          x={d.position.x * GRID}
          y={d.position.y * GRID}
          radius={DOT_RADIUS}
          fill={color(d.id)}
          hitStrokeWidth={WIRE_HIT}
          listening={onSelect !== undefined && !d.id.startsWith("pin-")}
          onMouseDown={press(d.id)}
        />
      ))}
    </Group>
  );
}

interface WireDraftProps {
  doc: EditorDoc;
  /** Points clicked so far for the wire being drawn, if any. */
  points: readonly GridPoint[] | null;
  pointer: GridPoint | null;
}

/** Wire being drawn (dashed), and a ring on what its end would attach to under the pointer. */
export function WireDraft({ doc, points, pointer }: WireDraftProps) {
  const path = points ? routeThrough(points) : [];
  const last = path[path.length - 1];
  const preview = last && pointer ? [...path, ...routeTo(last, pointer)] : null;
  const target = pointer ? anchorAt(doc, pointer) : null;
  return (
    <Group listening={false}>
      {preview && (
        <Line
          points={flat(preview)}
          stroke={COLORS.selected}
          strokeWidth={WIRE_WIDTH}
          dash={[6, 4]}
          lineCap="round"
          lineJoin="round"
        />
      )}
      {pointer && target && (
        <Circle
          x={pointer.x * GRID}
          y={pointer.y * GRID}
          radius={DOT_RADIUS + 3}
          stroke={COLORS.selected}
          strokeWidth={1.5}
        />
      )}
    </Group>
  );
}
