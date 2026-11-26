import type { KonvaEventObject } from "konva/lib/Node";
import { Group, Rect, Text } from "react-konva";

import {
  TEXT_FONT_SIZE,
  TEXT_LINE_HEIGHT,
  textBounds,
  type EditorText,
  type GridPoint,
} from "../store";
import { GRID, useCanvasColors } from "./theme";

/** Shown instead of an empty text, so it can still be seen and selected. */
const EMPTY = "(texte vide)";
/** Margin of the selection box and of the clickable area around the text, in grid units. */
const PAD = 0.2;

interface FreeTextProps {
  text: EditorText;
  selected?: boolean;
  ghost?: boolean;
  draggable?: boolean;
  onSelect?: (e: KonvaEventObject<MouseEvent>) => void;
  /** Right press on the text (the canvas decides on release what it means). */
  onContextPress?: () => void;
  /**
   * While dragging: the grid position the text would be dropped at, and whether Ctrl is held
   * (the wires of the other selected items stay where they are).
   */
  onDrag?: (position: GridPoint, detach: boolean) => void;
  /** End of a drag, with the grid position the text was dropped at (and Ctrl, as above). */
  onMove?: (position: GridPoint, detach: boolean) => void;
  onDoubleClick?: () => void;
}

/** A free text of the schematic (#123): decorative, its top-left corner on the grid. */
export function FreeText({
  text: t,
  selected = false,
  ghost = false,
  draggable = false,
  onSelect,
  onContextPress,
  onDrag,
  onMove,
  onDoubleClick,
}: FreeTextProps) {
  const colors = useCanvasColors();
  const empty = t.content === "";
  const box = textBounds(empty ? { ...t, content: EMPTY } : t);
  const width = (box.max.x - box.min.x + 2 * PAD) * GRID;
  const height = (box.max.y - box.min.y + 2 * PAD) * GRID;
  const toGrid = (v: number) => Math.round(v / GRID);

  return (
    <Group
      x={t.position.x * GRID}
      y={t.position.y * GRID}
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
        node.position({ x: toGrid(node.x()) * GRID, y: toGrid(node.y()) * GRID });
        onDrag?.({ x: toGrid(node.x()), y: toGrid(node.y()) }, e.evt.ctrlKey || e.evt.metaKey);
      }}
      onDragEnd={(e) => {
        const node = e.target;
        const position = { x: toGrid(node.x()), y: toGrid(node.y()) };
        // Force the node onto the grid even if the store value does not change.
        node.position({ x: position.x * GRID, y: position.y * GRID });
        onMove?.(position, e.evt.ctrlKey || e.evt.metaKey);
      }}
    >
      {/* Clickable area (the letters alone are hard to hit), and the selection box. */}
      <Rect
        x={-PAD * GRID}
        y={-PAD * GRID}
        width={width}
        height={height}
        fill="rgba(0,0,0,0)"
        stroke={selected ? colors.selected : undefined}
        strokeWidth={selected ? 1 : 0}
        dash={[4, 4]}
      />
      <Text
        text={empty ? EMPTY : t.content}
        fontSize={TEXT_FONT_SIZE * GRID}
        lineHeight={TEXT_LINE_HEIGHT / TEXT_FONT_SIZE}
        fill={selected ? colors.selected : colors.text}
        fontStyle={empty ? "italic" : "normal"}
        opacity={empty ? 0.6 : 1}
        listening={false}
      />
    </Group>
  );
}
