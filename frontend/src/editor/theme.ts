/** Size of one grid unit, in pixels at zoom 1. */
export const GRID = 20;

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 5;

export const COLORS = {
  background: "#ffffff",
  gridDot: "#c4cad3",
  symbol: "#1f2937",
  wire: "#15803d",
  selected: "#2563eb",
  pin: "#dc2626",
  text: "#374151",
} as const;

/** Colors and styles of the panels around the canvas (palette, inspector, bars). */
export const UI = {
  border: "#e5e7eb",
  panel: "#f9fafb",
  muted: "#6b7280",
  activeBackground: "#eff6ff",
  error: "#b91c1c",
  heading: {
    margin: "0 0 8px",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#6b7280",
  },
} as const;
