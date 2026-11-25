import { createContext, useContext } from "react";

import { PALETTES, type ThemePalette } from "../store";

export { COLORS, UI } from "../store";

/** Size of one grid unit, in pixels at zoom 1. */
export const GRID = 20;

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 5;

/** Colours the canvas draws with: those of the current theme, the light ones for an export. */
export const CanvasColorsContext = createContext<ThemePalette>(PALETTES.light);

export const useCanvasColors = () => useContext(CanvasColorsContext);
