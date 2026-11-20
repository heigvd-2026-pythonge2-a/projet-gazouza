import type { SymbolShape } from "../store";
import { GRID } from "./theme";

/** Points of an arc as a polyline, multiplied by `scale` (pixels per grid unit). */
export function arcPoints(s: Extract<SymbolShape, { kind: "arc" }>, scale = GRID): number[] {
  const points: number[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const a = ((s.start + (s.sweep * i) / steps) * Math.PI) / 180;
    points.push((s.x + s.radius * Math.cos(a)) * scale, (s.y + s.radius * Math.sin(a)) * scale);
  }
  return points;
}
