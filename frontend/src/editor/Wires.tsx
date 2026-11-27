import type { KonvaEventObject } from "konva/lib/Node";
import { useMemo } from "react";
import { Circle, Group, Line, Rect } from "react-konva";

import {
  anchorAt,
  connectionDots,
  routeThrough,
  routeTo,
  wirePartPoints,
  wirePath,
  type EditorDoc,
  type GridPoint,
  type WirePart,
} from "../store";
import { GRID, useCanvasColors } from "./theme";

const WIRE_WIDTH = 2;
/** Clickable width of a wire, in pixels. */
const WIRE_HIT = 10;
const DOT_RADIUS = 4;
/** Side of the square handle drawn on a selected bend, in pixels. */
const HANDLE = 8;

const flat = (points: readonly GridPoint[]) => points.flatMap((p) => [p.x * GRID, p.y * GRID]);

interface WiresProps {
  doc: EditorDoc;
  selection: readonly string[];
  /** Bend or segment selected on its own, highlighted. */
  part?: WirePart | null;
  /** Wire sections selected with the selection rectangle, highlighted. */
  segments?: readonly WirePart[];
  /** Left press on a wire or junction, with the select tool. */
  onSelect?: (id: string, e: KonvaEventObject<MouseEvent>) => void;
  /** Left press on a wire (instead of `onSelect`), to pick one of its bends or segments. */
  onWirePress?: (id: string, e: KonvaEventObject<MouseEvent>) => void;
  /** Double click on a wire. */
  onWireDoubleClick?: (id: string) => void;
  /** The pointer enters a wire (its id) or leaves it (null). */
  onWireHover?: (id: string | null) => void;
}

/** Wires of the document, and the connection dots (see `connectionDots`). */
export function Wires({
  doc,
  selection,
  part = null,
  segments = [],
  onSelect,
  onWirePress,
  onWireDoubleClick,
  onWireHover,
}: WiresProps) {
  const colors = useCanvasColors();
  const color = (id: string) => (selection.includes(id) ? colors.selected : colors.wire);
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
          onMouseEnter={() => onWireHover?.(w.id)}
          onMouseLeave={() => onWireHover?.(null)}
        />
      ))}
      {segments.map((seg) => {
        const points = wirePartPoints(doc, seg);
        return points ? (
          <Line
            key={`${seg.wire}/${seg.index}`}
            points={flat(points)}
            stroke={colors.selected}
            strokeWidth={WIRE_WIDTH + 1}
            lineCap="round"
            listening={false}
          />
        ) : null;
      })}
      {partPoints?.length === 2 && (
        <Line
          points={flat(partPoints)}
          stroke={colors.selected}
          strokeWidth={WIRE_WIDTH + 1}
          lineCap="round"
          listening={false}
        />
      )}
      {connectionDots(doc).map((d) => (
        <Circle
          key={d.id}
          x={d.position.x * GRID}
          y={d.position.y * GRID}
          radius={DOT_RADIUS}
          fill={color(d.id)}
          hitStrokeWidth={WIRE_HIT}
          listening={onSelect !== undefined && d.junction !== undefined}
          onMouseDown={press(d.id)}
        />
      ))}
      {partPoints?.length === 1 && partPoints[0] && (
        <Rect
          x={partPoints[0].x * GRID - HANDLE / 2}
          y={partPoints[0].y * GRID - HANDLE / 2}
          width={HANDLE}
          height={HANDLE}
          fill={colors.background}
          stroke={colors.selected}
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
  const colors = useCanvasColors();
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
          stroke={colors.selected}
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
          stroke={colors.selected}
          strokeWidth={1.5}
        />
      )}
    </Group>
  );
}
