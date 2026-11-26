import { Shape } from "react-konva";

import { GRID, useCanvasColors } from "./theme";

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface GridProps {
  viewport: Viewport;
  width: number;
  height: number;
}

/** Grid dots for the visible area only, drawn by a single shape. */
export function Grid({ viewport, width, height }: GridProps) {
  const colors = useCanvasColors();
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        const { x, y, scale } = viewport;
        // Show every 5th dot when the grid gets too dense, and nothing below that.
        let step = GRID;
        if (step * scale < 8) step *= 5;
        if (step * scale < 8) return;

        const left = Math.floor(-x / scale / step) * step;
        const top = Math.floor(-y / scale / step) * step;
        const right = (width - x) / scale;
        const bottom = (height - y) / scale;
        const size = 1.5 / scale;

        ctx.fillStyle = colors.gridDot;
        for (let gx = left; gx <= right; gx += step) {
          for (let gy = top; gy <= bottom; gy += step) {
            ctx.fillRect(gx - size / 2, gy - size / 2, size, size);
          }
        }
      }}
    />
  );
}
