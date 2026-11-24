import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { SPLITTER_SIZE } from "./sizes";

const KEY_STEP = 16;

type Props = {
  /** "vertical": a vertical bar between a left and a right panel; "horizontal": between top and bottom. */
  orientation: "vertical" | "horizontal";
  /** Accessible name, e.g. "Redimensionner la palette". */
  label: string;
  /** Size in pixels of the panel this splitter resizes. */
  value: number;
  /**
   * +1 when that panel is before the splitter (left / top): dragging right / down grows it.
   * -1 when it is after the splitter (right / bottom).
   */
  direction: 1 | -1;
  /** Receives the wanted size; the caller clamps it. */
  onChange: (size: number) => void;
  /** Double-click: back to the default size. */
  onReset: () => void;
  /**
   * End of a drag that moved: the size asked for when the pointer was released (not clamped) and
   * the size at the start of the drag. Lets the caller fold the panel away (#198).
   */
  onRelease?: (wanted: number, start: number) => void;
};

/** Draggable bar between two panels. Also usable with the arrow keys once focused. */
export function Splitter({
  orientation,
  label,
  value,
  direction,
  onChange,
  onReset,
  onRelease,
}: Props) {
  const drag = useRef<{ start: number; value: number; wanted: number | null } | null>(null);
  const [active, setActive] = useState(false);
  const [hover, setHover] = useState(false);
  const vertical = orientation === "vertical";
  const position = (e: PointerEvent) => (vertical ? e.clientX : e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: position(e), value, wanted: null };
    setActive(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const wanted = drag.current.value + direction * (position(e) - drag.current.start);
    drag.current.wanted = wanted;
    onChange(wanted);
  };
  const endDrag = (released: boolean) => {
    const ended = drag.current;
    drag.current = null;
    setActive(false);
    if (released && ended?.wanted != null) onRelease?.(ended.wanted, ended.value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const [less, more] = vertical ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (e.key !== less && e.key !== more) return;
    e.preventDefault();
    onChange(value + direction * (e.key === more ? KEY_STEP : -KEY_STEP));
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title="Glisser pour redimensionner · Double-clic : taille par défaut"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endDrag(true)}
      onPointerCancel={() => endDrag(false)}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      style={{
        flex: "none",
        [vertical ? "width" : "height"]: SPLITTER_SIZE,
        cursor: vertical ? "col-resize" : "row-resize",
        touchAction: "none",
        // A 1px line in the middle; the whole bar lights up while hovered or dragged.
        background: active
          ? "#93c5fd"
          : hover
            ? "#bfdbfe"
            : `linear-gradient(${vertical ? "to right" : "to bottom"}, transparent 2px, #e5e7eb 2px, #e5e7eb 3px, transparent 3px)`,
      }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    />
  );
}
