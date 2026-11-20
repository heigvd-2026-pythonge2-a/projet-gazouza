import { symbolBounds, type ComponentDef, type SymbolShape } from "../store";
import { arcPoints } from "./symbolGeometry";

const MARGIN = 0.3;

function ShapeSvg({ shape }: { shape: SymbolShape }) {
  switch (shape.kind) {
    case "line":
      return <polyline points={shape.points.join(" ")} />;
    case "rect":
      return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} />;
    case "circle":
      return <circle cx={shape.x} cy={shape.y} r={shape.radius} />;
    case "arc":
      return <polyline points={arcPoints(shape, 1).join(" ")} />;
  }
}

/** The library symbol of a component, drawn as a small SVG (for the palette). */
export function SymbolIcon({ def, size = 32 }: { def: ComponentDef; size?: number }) {
  const { min, max } = symbolBounds(def);
  const side = Math.max(max.x - min.x, max.y - min.y) + 2 * MARGIN;
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${cx - side / 2} ${cy - side / 2} ${side} ${side}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={(1.5 * side) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {def.symbol.map((shape, i) => (
        <ShapeSvg key={i} shape={shape} />
      ))}
    </svg>
  );
}
