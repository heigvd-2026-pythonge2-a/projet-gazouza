/** Panel sizes of the app shell, and the rules that keep every panel usable. */

/** Thickness of a splitter, in pixels. */
export const SPLITTER_SIZE = 5;

// Below 148 px the longest labels ("Condensateur") overflow their tile.
export const PALETTE_WIDTH = { min: 148, max: 320, default: 148 } as const;
export const SIDE_WIDTH = { min: 300, default: 440 } as const;
/** Fraction of the side column given to the inspector (results take the rest). */
export const INSPECTOR_FRACTION = { default: 0.45 } as const;

export const MIN_SCHEMATIC_WIDTH = 320;
export const MIN_RESULTS_HEIGHT = 120;
export const MIN_INSPECTOR_HEIGHT = 120;

export type PanelSizes = {
  paletteWidth: number;
  sideWidth: number;
  inspectorFraction: number;
};

export const DEFAULT_SIZES: PanelSizes = {
  paletteWidth: PALETTE_WIDTH.default,
  sideWidth: SIDE_WIDTH.default,
  inspectorFraction: INSPECTOR_FRACTION.default,
};

/** Clamps `value` to [min, max]; when the range is empty, `min` wins. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function clampPaletteWidth(width: number): number {
  return clamp(width, PALETTE_WIDTH.min, PALETTE_WIDTH.max);
}

/** Widest side column that still leaves room for the schematic. 0 = row not measured yet. */
export function clampSideWidth(width: number, rowWidth: number, paletteWidth: number): number {
  if (rowWidth <= 0) return Math.max(width, SIDE_WIDTH.min);
  const max = rowWidth - paletteWidth - MIN_SCHEMATIC_WIDTH - 2 * SPLITTER_SIZE;
  return clamp(width, SIDE_WIDTH.min, max);
}

/** Inspector height in pixels, from its fraction of the side column. */
export function inspectorHeight(fraction: number, columnHeight: number): number {
  const max = columnHeight - MIN_RESULTS_HEIGHT - SPLITTER_SIZE;
  return Math.round(clamp(fraction * columnHeight, MIN_INSPECTOR_HEIGHT, max));
}
