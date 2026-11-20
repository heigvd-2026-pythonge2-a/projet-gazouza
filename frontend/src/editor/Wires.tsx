import type { KonvaEventObject } from "konva/lib/Node";
import { useMemo } from "react";
import { Circle, Group, Line, Rect } from "react-konva";

import {
  anchorAt,
  endPosition,
  routeThrough,
  routeTo,
  wirePartPoints,
  wirePath,
  type EditorDoc,
  type GridPoint,
  type WirePart,
} from "../store";
import { COLORS, GRID } from "./theme";

const WIRE_WIDTH = 2;
/** Clickable width of a wire, in pixels. */
const WIRE_HIT = 10;
const DOT_RADIUS = 4;
/** Side of the square handle drawn on a selected bend, in pixels. */
const HANDLE = 8;

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
  /** Bend or segment selected on its own, highlighted. */
  part?: WirePart | null;
  /** Left press on a wire or junction, with the select tool. */
  onSelect?: (id: string, e: KonvaEventObject<MouseEvent>) => void;
  /** Left press on a wire (instead of `onSelect`), to pick one of its bends or segments. */
  onWirePress?: (id: string, e: KonvaEventObject<MouseEvent>) => void;
  /** Double click on a wire. */
  onWireDoubleClick?: (id: string) => void;
}

/** Wires of the document, and the dots of their junctions. */
export function Wires({
  doc,
  selection,
  part = null,
  onSelect,
  onWirePress,
  onWireDoubleClick,
}: WiresProps) {
  const color = (id: string) => (selection.includes(id) ? COLORS.selected : COLORS.wire);
  const press = (id: string) => (e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 0) onSelect?.(id, e);
  };
  const wirePress = (id: string) => (e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    if (onWirePress) onWirePress(id, e);
    else onSelect?.(id, e);
  };
  const partPoints = part ? wirePartPoints(doc, part) : null;
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
          onMouseDown={wirePress(w.id)}
          onDblClick={(e) => {
            if (e.evt.button === 0) onWireDoubleClick?.(w.id);
          }}
        />
      ))}
      {partPoints?.length === 2 && (
        <Line
          points={flat(partPoints)}
          stroke={COLORS.selected}
          strokeWidth={WIRE_WIDTH + 1}
          lineCap="round"
          listening={false}
        />
      )}
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
      {partPoints?.length === 1 && partPoints[0] && (
        <Rect
          x={partPoints[0].x * GRID - HANDLE / 2}
          y={partPoints[0].y * GRID - HANDLE / 2}
          width={HANDLE}
          height={HANDLE}
          fill="#ffffff"
          stroke={COLORS.selected}
          strokeWidth={1.5}
          listening={false}
        />
      )}
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
  // Routing goes around the components: only redo it when the clicks or the document change,
  // and for the last segment when the pointer moves to another grid point.
  const path = useMemo(() => (points ? routeThrough(doc, points) : []), [doc, points]);
  const last = path[path.length - 1];
  const px = pointer?.x;
  const py = pointer?.y;
  const tail = useMemo(
    () =>
      last && px !== undefined && py !== undefined ? routeTo(doc, last, { x: px, y: py }) : null,
    [doc, last, px, py],
  );
  const preview = tail ? [...path, ...tail] : null;
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
