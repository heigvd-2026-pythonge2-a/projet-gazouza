import { describe, expect, it } from "vitest";

import {
  DEFAULT_LAYOUT,
  MIN_INSPECTOR_HEIGHT,
  PALETTE_WIDTH,
  SIDE_WIDTH,
  clampPaletteWidth,
  clampSideWidth,
  inspectorHeight,
} from "./sizes";
import { parseLayout } from "./storage";

describe("parseLayout", () => {
  it("keeps a valid stored layout", () => {
    const stored = {
      resultsPosition: "bottom",
      paletteWidth: 200,
      sideWidth: 500,
      inspectorFraction: 0.3,
      resultsFraction: 0.6,
      resultsVisible: true,
      inspectorVisible: false,
    };
    expect(parseLayout(stored)).toEqual(stored);
  });

  it.each([null, undefined, 42, "text", []])("falls back to the defaults for %j", (raw) => {
    expect(parseLayout(raw)).toEqual(DEFAULT_LAYOUT);
  });

  it("replaces each invalid field by its default", () => {
    const layout = parseLayout({
      resultsPosition: "left",
      paletteWidth: Number.NaN,
      sideWidth: "500",
      inspectorFraction: 1.5,
      resultsFraction: 0,
      resultsVisible: "yes",
      inspectorVisible: 1,
    });
    expect(layout).toEqual(DEFAULT_LAYOUT);
  });
});

describe("sizes", () => {
  it("clamps the palette width", () => {
    expect(clampPaletteWidth(0)).toBe(PALETTE_WIDTH.min);
    expect(clampPaletteWidth(10_000)).toBe(PALETTE_WIDTH.max);
  });

  it("never makes the side column narrower than its minimum", () => {
    expect(clampSideWidth(10, 2000, PALETTE_WIDTH.default)).toBe(SIDE_WIDTH.min);
  });

  it("keeps the inspector at least its minimum height", () => {
    expect(inspectorHeight(0.01, 800)).toBe(MIN_INSPECTOR_HEIGHT);
  });
});
