import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from "react";

import {
  componentBounds,
  componentProblems,
  type ComponentProblem,
  type EditorDoc,
} from "../store";
import type { Viewport } from "./Grid";
import { GRID, UI } from "./theme";

/** Space between the bottom of the symbol and the tip of the bubble's arrow, in grid units. */
const GAP = 0.6;
/** Size of the arrow, in pixels. */
const ARROW = 6;
/** Smallest space kept between a bubble and the edges of the canvas, in pixels. */
const MARGIN = 4;

/** Centres the box under its arrow. */
const CENTRED = "translateX(-50%)";

const STYLES = {
  error: { color: UI.error, background: "#fef2f2" },
  warning: { color: "#b45309", background: "#fffbeb" },
} as const;

const arrowStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  width: 0,
  height: 0,
  borderLeft: `${ARROW}px solid transparent`,
  borderRight: `${ARROW}px solid transparent`,
  transform: "translateX(-50%)",
};

/**
 * One bubble: its arrow points at (x, y) in the canvas; the box is centred under it, but slides
 * sideways to stay inside the canvas.
 */
function Bubble({
  problem,
  label,
  x,
  y,
  container,
  onPick,
}: {
  problem: ComponentProblem;
  label: string;
  x: number;
  y: number;
  container: RefObject<HTMLDivElement | null>;
  onPick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // After every render (the canvas redraws the bubbles whenever the view moves or resizes):
  // centre the box under the arrow, then slide it back inside the canvas if it sticks out.
  useLayoutEffect(() => {
    const el = ref.current;
    const area = container.current?.getBoundingClientRect();
    if (!el || !area) return;
    el.style.transform = CENTRED;
    const box = el.getBoundingClientRect();
    if (box.width === 0) return;
    let shift = 0;
    if (box.left < area.left + MARGIN) shift = area.left + MARGIN - box.left;
    else if (box.right > area.right - MARGIN) shift = area.right - MARGIN - box.right;
    if (shift !== 0) el.style.transform = `${CENTRED} translateX(${shift}px)`;
  });

  const { color, background } = STYLES[problem.level];
  return (
    <div style={{ position: "absolute", left: x, top: y }}>
      {/* Arrow: the border colour, then the background a little lower over it. */}
      <span
        aria-hidden
        style={{ ...arrowStyle, top: 0, borderBottom: `${ARROW}px solid ${color}` }}
      />
      <span
        aria-hidden
        style={{
          ...arrowStyle,
          top: 1.5,
          zIndex: 1,
          borderBottom: `${ARROW}px solid ${background}`,
        }}
      />
      <button
        ref={ref}
        type="button"
        onClick={onPick}
        title="Corriger dans le panneau Propriétés"
        aria-label={`${label} : ${problem.message}`}
        data-level={problem.level}
        style={{
          position: "absolute",
          left: 0,
          top: ARROW,
          transform: CENTRED,
          width: "max-content",
          maxWidth: 240,
          padding: "3px 7px",
          border: `1px solid ${color}`,
          borderRadius: 4,
          background,
          color,
          font: "inherit",
          fontSize: 12,
          lineHeight: 1.35,
          textAlign: "left",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.15)",
          cursor: "pointer",
          pointerEvents: "auto",
        }}
      >
        {problem.message}
      </button>
    </div>
  );
}

/**
 * Bubbles pointing at the components whose name or values are wrong (#196), with the same message
 * as the properties panel. They are HTML over the canvas: same size at every zoom, above every
 * drawn item, and left out of the PNG export of the stage. Clicking one calls `onPick` with the
 * component and the field to correct (null for the name).
 */
export function ErrorBubbles({
  doc,
  viewport,
  onPick,
}: {
  doc: EditorDoc;
  viewport: Viewport;
  onPick: (comp: string, param: string | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const problems = componentProblems(doc);
  if (problems.length === 0) return null;
  return (
    <div
      ref={container}
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      {problems.map((p) => {
        const c = doc.components.find((x) => x.id === p.comp);
        if (!c) return null;
        const box = componentBounds(c);
        return (
          <Bubble
            key={p.comp}
            problem={p}
            label={c.name ?? c.params.net ?? c.id}
            x={((box.min.x + box.max.x) / 2) * GRID * viewport.scale + viewport.x}
            y={(box.max.y + GAP) * GRID * viewport.scale + viewport.y}
            container={container}
            onPick={() => onPick(p.comp, p.param)}
          />
        );
      })}
    </div>
  );
}
