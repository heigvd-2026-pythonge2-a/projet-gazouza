import { describe, expect, it } from "vitest";

import { FIT_MARGIN, showViewport } from "./fitView";
import { GRID } from "./theme";

describe("showViewport (#253)", () => {
  const area = { min: { x: 0, y: 0 }, max: { x: 4, y: 2 } };

  it("keeps the view when the area is already in it", () => {
    const v = { x: 100, y: 100, scale: 1 };
    expect(showViewport(v, area, 800, 600)).toBe(v);
  });

  it("centers the area, at the same zoom if it fits", () => {
    const v = { x: -2000, y: 0, scale: 1.5 };
    const shown = showViewport(v, area, 800, 600);
    expect(shown.scale).toBe(1.5);
    expect(shown.x + 2 * GRID * 1.5).toBe(400);
    expect(shown.y + 1 * GRID * 1.5).toBe(300);
  });

  it("zooms out when the area does not fit", () => {
    const big = { min: { x: 0, y: 0 }, max: { x: 100, y: 10 } };
    const shown = showViewport({ x: 0, y: 0, scale: 2 }, big, 800, 600);
    expect(shown.scale).toBeCloseTo((800 - 2 * FIT_MARGIN) / (100 * GRID));
  });
});
