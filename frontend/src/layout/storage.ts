import { DEFAULT_LAYOUT, type Layout } from "./sizes";

/** localStorage key; bump the version if the stored shape changes incompatibly. */
export const LAYOUT_STORAGE_KEY = "psice.layout.v1";

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isFraction = (v: unknown): v is number => isNumber(v) && v > 0 && v < 1;

/**
 * Turns anything read from storage into a valid layout: each field that is missing or
 * invalid falls back to its default, so a corrupted or older value never breaks the app.
 * Sizes are not clamped here; the app shell clamps them to the window when it renders.
 */
export function parseLayout(raw: unknown): Layout {
  const v = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_LAYOUT;
  return {
    resultsPosition:
      v.resultsPosition === "right" || v.resultsPosition === "bottom"
        ? v.resultsPosition
        : d.resultsPosition,
    paletteWidth: isNumber(v.paletteWidth) ? v.paletteWidth : d.paletteWidth,
    sideWidth: isNumber(v.sideWidth) ? v.sideWidth : d.sideWidth,
    inspectorFraction: isFraction(v.inspectorFraction) ? v.inspectorFraction : d.inspectorFraction,
    resultsFraction: isFraction(v.resultsFraction) ? v.resultsFraction : d.resultsFraction,
  };
}

export function loadLayout(): Layout {
  try {
    const text = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    return text === null ? DEFAULT_LAYOUT : parseLayout(JSON.parse(text));
  } catch {
    // Invalid JSON, or storage unavailable: start from the defaults.
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: Layout): void {
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage full or unavailable: the layout just won't be remembered.
  }
}
