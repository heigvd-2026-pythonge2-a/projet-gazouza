import type { KonvaEventObject } from "konva/lib/Node";
import { useRef } from "react";
import { Circle, Group, Line, Rect, Text } from "react-konva";

import {
  CAPTION_FONT_SIZE,
  captionSize,
  getDef,
  layoutCaptions,
  ledColor,
  symbolBounds,
  symbolOf,
  toLocal,
  toWorld,
  type Caption,
  type CaptionKind,
  type GridPoint,
  type PlacedComponent,
  type SymbolShape,
} from "../store";
import { arcPoints } from "./symbolGeometry";
import { GRID, useCanvasColors } from "./theme";

const STROKE = 2;
/** Extra width of a text's box, around its estimated width (the font is not measured). */
const TEXT_PAD = 8;
const PIN_SIZE = 0.3;
/** Clickable area around a pin, larger than its drawn square. */
const PIN_HIT = 0.8;

function setCursor(e: KonvaEventObject<MouseEvent>, cursor: string) {
  const container = e.target.getStage()?.container();
  if (container) container.style.cursor = cursor;
}

function SymbolShapeNode({
  shape,
  color,
  lightColor = color,
  fillColor,
}: {
  shape: SymbolShape;
  color: string;
  /** Colour of the lines of `tone: "light"` (the light of an LED). */
  lightColor?: string;
  /** Inside of the `filled` lines (the flag of a label). */
  fillColor?: string;
}) {
  const stroke = shape.kind === "line" && shape.tone === "light" ? lightColor : color;
  const common = { stroke, strokeWidth: STROKE, listening: false } as const;
  switch (shape.kind) {
    case "line":
      return (
        <Line
          {...common}
          points={shape.points.map((v) => v * GRID)}
          lineCap="round"
          closed={shape.filled}
          fill={shape.filled ? fillColor : undefined}
        />
      );
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

/** The texts of a component alone (a ghost, a preview): placed as if nothing were around. */
function standaloneCaptions(c: PlacedComponent): Caption[] {
  return layoutCaptions({ components: [c], wires: [], junctions: [], texts: [] }).get(c.id) ?? [];
}

interface CaptionTextProps {
  caption: Caption;
  /** Position of the component, in grid units: the text is drawn relative to it. */
  origin: GridPoint;
  color: string;
  draggable: boolean;
  /** While dragging: where the text would land (null: nowhere free, it stays). */
  onDrag?: (kind: CaptionKind, centre: GridPoint) => GridPoint | null;
  onMove?: (kind: CaptionKind, centre: GridPoint) => void;
}

/**
 * The name or the value of a component, always upright. It is dragged on its own: its drag
 * events are kept from the component's group, which would move the component.
 */
function CaptionText({ caption, origin, color, draggable, onDrag, onMove }: CaptionTextProps) {
  const width = captionSize(caption.text).width * GRID + TEXT_PAD;
  const height = CAPTION_FONT_SIZE * GRID;
  // Top-left corner of the text box for a text centred on `centre`, and back.
  const corner = (centre: GridPoint) => ({
    x: (centre.x - origin.x) * GRID - width / 2,
    y: (centre.y - origin.y) * GRID - height / 2,
  });
  const centreOf = (x: number, y: number) => ({
    x: origin.x + (x + width / 2) / GRID,
    y: origin.y + (y + height / 2) / GRID,
  });
  const at = corner(caption.centre);
  // Last place the text could land during the drag (where it was, at first).
  const landing = useRef(caption.centre);

  return (
    <Text
      text={caption.text}
      x={at.x}
      y={at.y}
      width={width}
      height={height}
      align="center"
      verticalAlign="middle"
      wrap="none"
      fontSize={height}
      fill={color}
      listening={draggable}
      draggable={draggable}
      onMouseEnter={(e) => setCursor(e, "move")}
      onMouseLeave={(e) => setCursor(e, "")}
      onDragStart={(e) => {
        e.cancelBubble = true;
        landing.current = caption.centre;
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        const node = e.target;
        const centre = onDrag?.(caption.kind, centreOf(node.x(), node.y())) ?? landing.current;
        landing.current = centre;
        node.position(corner(centre));
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const node = e.target;
        const centre = onDrag?.(caption.kind, centreOf(node.x(), node.y())) ?? landing.current;
        // Back onto its place even if the store value does not change.
        node.position(corner(centre));
        onMove?.(caption.kind, centre);
      }}
    />
  );
}

interface ComponentSymbolProps {
  component: PlacedComponent;
  selected?: boolean;
  ghost?: boolean;
  draggable?: boolean;
  onSelect?: (e: KonvaEventObject<MouseEvent>) => void;
  /** Right press on the component (the canvas decides on release what it means). */
  onContextPress?: () => void;
  /**
   * While dragging: the grid position the component would be dropped at, and whether Ctrl is
   * held (move without the wires).
   */
  onDrag?: (position: { x: number; y: number }, detach: boolean) => void;
  /** End of a drag, with the grid position the component was dropped at (and Ctrl, as above). */
  onMove?: (position: { x: number; y: number }, detach: boolean) => void;
  /** Left press on a pin. When set, the pins are clickable (and do not start a drag). */
  onPinMouseDown?: (pin: string) => void;
  /** The pointer enters a clickable pin (its name) or leaves it (null). */
  onPinHover?: (pin: string | null) => void;
  /** Left double-click on the component (not on one of its clickable pins). */
  onDoubleClick?: () => void;
  /** The pointer enters the component (`true`) or leaves it (`false`). */
  onHover?: (over: boolean) => void;
  /**
   * Pins whose square is drawn: by default all of them. On the schematic, only the unconnected
   * ones, so a connected pin does not leave a square behind.
   */
  markedPins?: ReadonlySet<string>;
  /** Where its name and value are drawn (`layoutCaptions`). Default: as if alone. */
  captions?: Caption[];
  /** While a text is dragged: where it would land, or null if nowhere free nearby. */
  onCaptionDrag?: (kind: CaptionKind, centre: GridPoint) => GridPoint | null;
  /** End of a text's drag: where it landed. When set, the texts can be dragged. */
  onCaptionMove?: (kind: CaptionKind, centre: GridPoint) => void;
}

/**
 * A placed component. The outer group only translates (and is what gets dragged); the inner
 * group applies mirror then rotation, so the texts stay upright and readable.
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
  onPinHover,
  onDoubleClick,
  onHover,
  markedPins,
  captions,
  onCaptionDrag,
  onCaptionMove,
}: ComponentSymbolProps) {
  const colors = useCanvasColors();
  const def = getDef(c.type);
  // A label keeps its pink fill when selected; only its outline turns to the selection colour.
  const color = selected
    ? colors.selected
    : c.type === "label"
      ? colors.labelStroke
      : colors.symbol;
  const bounds = symbolBounds(def);
  const pad = 0.3;

  const texts = captions ?? standaloneCaptions(c);
  // On a diagonal a pin is put back on the grid, a little further out (#161): where it is drawn,
  // in the component's frame, and the extra lead from the symbol to it.
  const pins = def.pins.map((pin) => ({ ...pin, at: toLocal(toWorld(pin, c), c) }));

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
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onDragMove={(e) => {
        const node = e.target;
        node.position({ x: snap(node.x()), y: snap(node.y()) });
        onDrag?.(
          { x: Math.round(node.x() / GRID), y: Math.round(node.y() / GRID) },
          e.evt.ctrlKey || e.evt.metaKey,
        );
      }}
      onDragEnd={(e) => {
        const node = e.target;
        const position = { x: Math.round(node.x() / GRID), y: Math.round(node.y() / GRID) };
        // Force the node onto the grid even if the store value does not change.
        node.position({ x: position.x * GRID, y: position.y * GRID });
        onMove?.(position, e.evt.ctrlKey || e.evt.metaKey);
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
          stroke={selected ? colors.selected : undefined}
          strokeWidth={selected ? 1 : 0}
          dash={[4, 4]}
        />
        {symbolOf(def, c.params).map((shape, i) => (
          <SymbolShapeNode
            key={i}
            shape={shape}
            color={color}
            lightColor={c.type === "led" && !selected ? ledColor(c.params) : color}
            fillColor={colors.labelFill}
          />
        ))}
        {pins
          .filter((pin) => pin.at.x !== pin.x || pin.at.y !== pin.y)
          .map((pin) => (
            <Line
              key={`lead-${pin.name}`}
              points={[pin.x * GRID, pin.y * GRID, pin.at.x * GRID, pin.at.y * GRID]}
              stroke={color}
              strokeWidth={STROKE}
              lineCap="round"
              listening={false}
            />
          ))}
        {pins
          .filter((pin) => !markedPins || markedPins.has(pin.name))
          .map((pin) => (
            <Rect
              key={pin.name}
              x={(pin.at.x - PIN_SIZE / 2) * GRID}
              y={(pin.at.y - PIN_SIZE / 2) * GRID}
              width={PIN_SIZE * GRID}
              height={PIN_SIZE * GRID}
              stroke={colors.pin}
              strokeWidth={1}
              listening={false}
            />
          ))}
        {onPinMouseDown &&
          pins.map((pin) => (
            <Rect
              key={`hit-${pin.name}`}
              x={(pin.at.x - PIN_HIT / 2) * GRID}
              y={(pin.at.y - PIN_HIT / 2) * GRID}
              width={PIN_HIT * GRID}
              height={PIN_HIT * GRID}
              fill="rgba(0,0,0,0)"
              onMouseEnter={(e) => {
                setCursor(e, "crosshair");
                onPinHover?.(pin.name);
              }}
              onMouseLeave={(e) => {
                setCursor(e, "");
                onPinHover?.(null);
              }}
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
      {texts.map((caption) => (
        <CaptionText
          key={caption.kind}
          caption={caption}
          origin={c.position}
          // A text moved by hand that something now covers is shown, without blocking.
          color={selected ? colors.selected : caption.overlapping ? colors.danger : colors.text}
          draggable={draggable && !ghost && onCaptionMove !== undefined}
          onDrag={onCaptionDrag}
          onMove={onCaptionMove}
        />
      ))}
    </Group>
  );
}
