// Colours of the app: a light and a night-blue theme, the user's choice if they made one,
// otherwise the system setting.

import { create } from "zustand";

export type ThemeName = "light" | "dark";

/** Every colour of the app, in one theme. The dark one uses the night blues of the website. */
export interface ThemePalette {
  /** Schematic canvas. */
  background: string;
  gridDot: string;
  symbol: string;
  wire: string;
  selected: string;
  pin: string;
  text: string;
  /** Labels of the operating point on the schematic. */
  voltageLabel: string;
  currentLabel: string;
  /** Ring around a pin left unconnected. */
  freePinFill: string;
  /** Selection rectangle, and its colour when it only touches the items. */
  bandFill: string;
  bandTouch: string;
  bandTouchFill: string;
  /** Moving dots of the current animation: a blue that the wires and the selection do not use. */
  currentDot: string;
  /** The "unsaved" badge. */
  highlight: string;
  /**
   * Glow under the wires and pins of the node hovered or selected (#278): a magenta that the
   * wires, the selection, the errors and the current do not use. Drawn half transparent.
   */
  nodeGlow: string;
  /**
   * Flag of a node label (#324): a pink fill, so it is not taken for the outline of a resistor,
   * and a stronger pink outline.
   */
  labelFill: string;
  labelStroke: string;

  /** Panels and controls around the canvas. */
  surface: string;
  surfaceTranslucent: string;
  panel: string;
  handle: string;
  border: string;
  inputBorder: string;
  activeBackground: string;
  activeBorder: string;
  splitterHover: string;
  muted: string;
  label: string;
  faint: string;
  shadow: string;
  /** Filled buttons (Exporter…, Simuler) and their text. */
  onAccent: string;
  success: string;
  danger: string;
  error: string;
  errorBackground: string;
  errorStrong: string;
  warning: string;
  warningBackground: string;
}

export const PALETTES: Record<ThemeName, ThemePalette> = {
  light: {
    background: "#ffffff",
    gridDot: "#c4cad3",
    symbol: "#1f2937",
    wire: "#15803d",
    selected: "#2563eb",
    pin: "#dc2626",
    text: "#374151",
    voltageLabel: "#7c3aed",
    currentLabel: "#b45309",
    freePinFill: "rgba(220, 38, 38, 0.15)",
    bandFill: "rgba(37, 99, 235, 0.08)",
    bandTouch: "#16a34a",
    bandTouchFill: "rgba(22, 163, 74, 0.08)",
    currentDot: "#0284c7",
    highlight: "#f59e0b",
    nodeGlow: "#c026d3",
    labelFill: "#fce7f3",
    labelStroke: "#be185d",

    surface: "#ffffff",
    surfaceTranslucent: "rgba(255, 255, 255, 0.92)",
    panel: "#f9fafb",
    handle: "#f3f4f6",
    border: "#e5e7eb",
    inputBorder: "#d1d5db",
    activeBackground: "#eff6ff",
    activeBorder: "#bfdbfe",
    splitterHover: "#93c5fd",
    muted: "#6b7280",
    label: "#4b5563",
    faint: "#9ca3af",
    shadow: "rgba(0, 0, 0, 0.12)",
    onAccent: "#ffffff",
    success: "#16a34a",
    danger: "#b91c1c",
    error: "#b91c1c",
    errorBackground: "#fef2f2",
    errorStrong: "#7f1d1d",
    warning: "#b45309",
    warningBackground: "#fffbeb",
  },
  // Slate greys on the night blue of the logo (#0f172a); the canvas is the page background of
  // the website (#0b1120), with its faint dots.
  dark: {
    background: "#0b1120",
    gridDot: "#334155",
    symbol: "#e2e8f0",
    wire: "#4ade80",
    selected: "#60a5fa",
    pin: "#f87171",
    text: "#cbd5e1",
    voltageLabel: "#c4b5fd",
    currentLabel: "#fbbf24",
    freePinFill: "rgba(248, 113, 113, 0.25)",
    bandFill: "rgba(96, 165, 250, 0.12)",
    bandTouch: "#4ade80",
    bandTouchFill: "rgba(74, 222, 128, 0.12)",
    // Lighter than the light theme's, so the dots stand out on the night blue.
    currentDot: "#38bdf8",
    highlight: "#fbbf24",
    nodeGlow: "#e879f9",
    labelFill: "#500724",
    labelStroke: "#f472b6",

    surface: "#1e293b",
    surfaceTranslucent: "rgba(30, 41, 59, 0.92)",
    panel: "#0f172a",
    handle: "#1e293b",
    border: "#334155",
    inputBorder: "#475569",
    activeBackground: "#1e3a8a",
    activeBorder: "#1d4ed8",
    splitterHover: "#3b82f6",
    muted: "#94a3b8",
    label: "#cbd5e1",
    faint: "#64748b",
    shadow: "rgba(0, 0, 0, 0.45)",
    onAccent: "#ffffff",
    success: "#16a34a",
    danger: "#dc2626",
    error: "#f87171",
    errorBackground: "#450a0a",
    errorStrong: "#fecaca",
    warning: "#fbbf24",
    warningBackground: "#422006",
  },
};

/** CSS custom property of a palette entry: `--psice-grid-dot` for `gridDot`. */
export const cssVariable = (key: keyof ThemePalette) =>
  `--psice-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

const v = (key: keyof ThemePalette) => `var(${cssVariable(key)})`;

/** The custom properties of a theme, as set on the document root. */
export function cssVariables(palette: ThemePalette): Record<string, string> {
  return Object.fromEntries(
    (Object.keys(palette) as (keyof ThemePalette)[]).map((key) => [cssVariable(key), palette[key]]),
  );
}

/**
 * Colours of the schematic, for the HTML around it (the canvas itself draws with
 * `useCanvasColors`, since a canvas does not understand CSS variables).
 */
export const COLORS = {
  background: v("background"),
  gridDot: v("gridDot"),
  symbol: v("symbol"),
  wire: v("wire"),
  selected: v("selected"),
  pin: v("pin"),
  text: v("text"),
  highlight: v("highlight"),
  labelFill: v("labelFill"),
  labelStroke: v("labelStroke"),
} as const;

/** Colors and styles of the panels around the canvas (palette, inspector, bars). */
export const UI = {
  surface: v("surface"),
  surfaceTranslucent: v("surfaceTranslucent"),
  border: v("border"),
  inputBorder: v("inputBorder"),
  panel: v("panel"),
  handle: v("handle"),
  muted: v("muted"),
  label: v("label"),
  faint: v("faint"),
  shadow: v("shadow"),
  activeBackground: v("activeBackground"),
  activeBorder: v("activeBorder"),
  splitterHover: v("splitterHover"),
  onAccent: v("onAccent"),
  success: v("success"),
  danger: v("danger"),
  error: v("error"),
  errorBackground: v("errorBackground"),
  errorStrong: v("errorStrong"),
  warning: v("warning"),
  warningBackground: v("warningBackground"),
  heading: {
    margin: "0 0 8px",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: v("muted"),
  },
} as const;

/** localStorage key of the theme chosen with the toolbar button. */
export const THEME_STORAGE_KEY = "psice.theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The stored choice, or null when the user never chose (or storage holds something else). */
export function parseTheme(raw: string | null): ThemeName | null {
  return raw === "light" || raw === "dark" ? raw : null;
}

export function loadTheme(): ThemeName | null {
  try {
    return parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveTheme(theme: ThemeName): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable: the choice just won't be remembered.
  }
}

/** The system setting (Windows: Paramètres > Personnalisation > Couleurs). */
export function systemTheme(): ThemeName {
  if (typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

interface ThemeState {
  theme: ThemeName;
  /** Whether the user chose the theme: it then no longer follows the system setting. */
  chosen: boolean;
  toggle: () => void;
  followSystem: (theme: ThemeName) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const stored = loadTheme();
  return {
    theme: stored ?? systemTheme(),
    chosen: stored !== null,
    toggle: () => {
      const theme = get().theme === "dark" ? "light" : "dark";
      saveTheme(theme);
      set({ theme, chosen: true });
    },
    followSystem: (theme) => {
      if (!get().chosen) set({ theme });
    },
  };
});

/** Puts the colours of a theme on the page, native controls and scrollbars included. */
export function applyTheme(theme: ThemeName, root: HTMLElement = document.documentElement) {
  for (const [name, value] of Object.entries(cssVariables(PALETTES[theme]))) {
    root.style.setProperty(name, value);
  }
  root.style.colorScheme = theme;
  root.style.background = PALETTES[theme].surface;
  root.dataset.theme = theme;
}

/** At startup: applies the theme now, then on every change of the choice or the system setting. */
export function installTheme() {
  applyTheme(useThemeStore.getState().theme);
  useThemeStore.subscribe((s, previous) => {
    if (s.theme !== previous.theme) applyTheme(s.theme);
  });
  if (typeof window.matchMedia === "function") {
    window
      .matchMedia(DARK_QUERY)
      .addEventListener("change", (e) =>
        useThemeStore.getState().followSystem(e.matches ? "dark" : "light"),
      );
  }
}
