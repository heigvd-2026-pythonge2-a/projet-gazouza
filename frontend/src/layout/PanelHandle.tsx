import { useRef, type PointerEvent } from "react";

import { COLORS, UI } from "../store";

/** Thickness of a handle, in pixels. */
export const HANDLE_SIZE = 24;
/** A press on a handle that moves more than this (pixels) opens the panel, like a click. */
const DRAG_THRESHOLD = 4;

const ARROWS = { left: "◀", up: "▲", down: "▼" } as const;

type Props = {
  /** Name of the folded panel, e.g. "Propriétés". */
  panel: string;
  /** Where the panel opens from the handle: "left" for a strip at the right edge of the window. */
  opens: keyof typeof ARROWS;
  onOpen: () => void;
};

/**
 * What is left of a folded or hidden panel (#198): a narrow strip with its name and an arrow,
 * at the edge where the panel was. A click, or a drag towards the panel, opens it again.
 */
export function PanelHandle({ panel, opens, onOpen }: Props) {
  const vertical = opens === "left";
  const press = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    press.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!press.current) return;
    if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) <= DRAG_THRESHOLD)
      return;
    press.current = null;
    onOpen();
  };

  return (
    <button
      type="button"
      title={`Afficher le panneau ${panel}`}
      aria-label={`Afficher le panneau ${panel}`}
      onClick={onOpen}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (press.current = null)}
      onPointerLeave={() => (press.current = null)}
      style={{
        // Strips at the window edge share its height when there are two.
        flex: vertical ? 1 : "none",
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        [vertical ? "width" : "height"]: HANDLE_SIZE,
        ...(vertical ? {} : { width: "100%" }),
        padding: vertical ? "10px 0" : "0 10px",
        border: 0,
        [vertical ? "borderLeft" : opens === "up" ? "borderTop" : "borderBottom"]:
          `1px solid ${UI.border}`,
        background: UI.handle,
        color: COLORS.text,
        font: "inherit",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        writingMode: vertical ? "vertical-rl" : undefined,
        userSelect: "none",
      }}
    >
      <span aria-hidden style={vertical ? { writingMode: "horizontal-tb" } : undefined}>
        {ARROWS[opens]}
      </span>
      {panel}
    </button>
  );
}
