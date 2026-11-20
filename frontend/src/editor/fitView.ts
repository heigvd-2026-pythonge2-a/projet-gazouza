// Viewport that shows a whole rectangle of the schematic (the "fit to circuit" view).

import type { GridRect } from "../store";
import type { Viewport } from "./Grid";
import { GRID, MIN_SCALE } from "./theme";

/** Space left around the circuit, in screen pixels (room for the component captions). */
export const FIT_MARGIN = 48;
/** Highest zoom when fitting, so a single component is not blown up to the maximum zoom. */
export const FIT_MAX_SCALE = 2;

/**
 * Zoom and position that fit `bounds` (grid units) in a `width` x `height` canvas, centered, with
 * `FIT_MARGIN` around it. No bounds (empty schematic): zoom 100 %, origin in the middle.
 */
export function fitViewport(bounds: GridRect | null, width: number, height: number): Viewport {
  if (!bounds) return { x: Math.round(width / 2), y: Math.round(height / 2), scale: 1 };
  const w = (bounds.max.x - bounds.min.x) * GRID;
  const h = (bounds.max.y - bounds.min.y) * GRID;
  const fit = Math.min(
    w > 0 ? (width - 2 * FIT_MARGIN) / w : Infinity,
    h > 0 ? (height - 2 * FIT_MARGIN) / h : Infinity,
  );
  const scale = Math.max(MIN_SCALE, Math.min(FIT_MAX_SCALE, fit));
  const cx = ((bounds.min.x + bounds.max.x) / 2) * GRID;
  const cy = ((bounds.min.y + bounds.max.y) / 2) * GRID;
  return { x: Math.round(width / 2 - cx * scale), y: Math.round(height / 2 - cy * scale), scale };
}
