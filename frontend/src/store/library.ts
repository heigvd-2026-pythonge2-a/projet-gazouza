// Component library. The backend serves the pins and parameters (`GET /api/library`, contract
// `LibraryComponent`); the editor adds what only it needs: the palette group and the symbol
// drawing. `loadLibrary()` merges both once at startup; until then `getDef` knows no type.

import { getLibrary, type LibraryComponent } from "../api/client";
import type { GridPoint } from "./document";

// Contract types, completed: the API may leave out empty lists, the editor always has them.
type ApiParamDef = NonNullable<LibraryComponent["params"]>[number];
export type PinDef = LibraryComponent["pins"][number];
export type ParamOption = NonNullable<ApiParamDef["options"]>[number];
export type ParamDef = Required<ApiParamDef>;

export type SymbolShape =
  | { kind: "line"; points: number[] }
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "circle"; x: number; y: number; radius: number }
  /** Arc from `start` to `start + sweep` degrees, clockwise (y axis points down). */
  | { kind: "arc"; x: number; y: number; radius: number; start: number; sweep: number };

/** Group of the palette a component is shown in. Frontend only: not part of the API contract. */
export type Category = "passive" | "source" | "connection" | "semiconductor" | "amplifier";

/**
 * Palette groups, in display order, with their French titles. The semiconductors and amplifiers
 * come last so the basic tools keep their digit keys (1 to 8).
 */
export const CATEGORIES: readonly { id: Category; label: string }[] = [
  { id: "passive", label: "Passifs" },
  { id: "source", label: "Sources" },
  { id: "connection", label: "Connexions" },
  { id: "semiconductor", label: "Semi-conducteurs" },
  { id: "amplifier", label: "Amplificateurs" },
];

/** What the editor adds to a library component: where it goes in the palette, how it looks. */
interface EditorPart {
  category: Category;
  /** Drawing in grid units, at rotation 0. */
  symbol: SymbolShape[];
}

export interface ComponentDef extends EditorPart {
  type: string;
  label: string;
  /** SPICE prefix. `null` for ground and label, which have no SPICE line and no `name`. */
  prefix: string | null;
  pins: PinDef[];
  params: ParamDef[];
}

const leads = (gap: number): SymbolShape[] => [
  { kind: "line", points: [0, -2, 0, -gap] },
  { kind: "line", points: [0, gap, 0, 2] },
];

// Diode, anode (A) at the top and cathode (K) at the bottom: the triangle points to the cathode.
const DIODE_BODY: SymbolShape[] = [
  ...leads(0.6),
  { kind: "line", points: [-0.7, -0.6, 0.7, -0.6, 0, 0.6, -0.7, -0.6] },
];
const DIODE_BAR: SymbolShape = { kind: "line", points: [-0.7, 0.6, 0.7, 0.6] };

/** Arrow pointing away from the diode, for the light of an LED; (x, y) is its tail. */
const lightArrow = (x: number, y: number): SymbolShape[] => [
  { kind: "line", points: [x, y, x + 0.6, y - 0.6] },
  { kind: "line", points: [x + 0.3, y - 0.6, x + 0.6, y - 0.6, x + 0.6, y - 0.3] },
];

// Op-amp: inverting input (-) at the top left, non-inverting (+) at the bottom left, output on
// the right. The triangle's top edge crosses x = 0 at y = -0.86, the bottom edge at y = 0.86.
const OPAMP_BODY: SymbolShape[] = [
  { kind: "line", points: [-1.2, -1.6, 1.4, 0, -1.2, 1.6, -1.2, -1.6] },
  { kind: "line", points: [-2, -1, -1.2, -1] },
  { kind: "line", points: [-2, 1, -1.2, 1] },
  { kind: "line", points: [1.4, 0, 2, 0] },
  // "-" and "+" marks inside the triangle, next to their inputs.
  { kind: "line", points: [-0.95, -1, -0.55, -1] },
  { kind: "line", points: [-0.95, 1, -0.55, 1] },
  { kind: "line", points: [-0.75, 0.8, -0.75, 1.2] },
];

/**
 * Flag of a node label, by direction (its `direction` parameter), pin at (0, 0). All of them fill
 * the same box (x from 0 to 2, y from -0.5 to 0.5), so the caption and the bounds do not move when
 * the direction changes. An input points to its pin (the signal comes in), an output away from it.
 */
export const LABEL_FLAGS: Readonly<Record<string, SymbolShape[]>> = {
  none: [{ kind: "line", points: [0, 0, 0, -0.5, 2, -0.5, 2, 0.5, 0, 0.5, 0, 0] }],
  input: [{ kind: "line", points: [0, 0, 0.5, -0.5, 2, -0.5, 2, 0.5, 0.5, 0.5, 0, 0] }],
  output: [{ kind: "line", points: [0, 0, 0, -0.5, 1.5, -0.5, 2, 0, 1.5, 0.5, 0, 0.5, 0, 0] }],
  bidir: [{ kind: "line", points: [0, 0, 0.5, -0.5, 1.5, -0.5, 2, 0, 1.5, 0.5, 0.5, 0.5, 0, 0] }],
};

/** Envelope of the transistors (IEC 60617 draws it, and beginners know it from textbooks). */
const TRANSISTOR_ENVELOPE: SymbolShape = { kind: "circle", x: 0.25, y: 0, radius: 1.2 };

// Bipolar transistor: base (B) on the left, the two other pins at (1, -2) and (1, 2).
const BIPOLAR_BODY: SymbolShape[] = [
  TRANSISTOR_ENVELOPE,
  { kind: "line", points: [-2, 0, -0.5, 0] },
  { kind: "line", points: [-0.5, -0.8, -0.5, 0.8] },
  { kind: "line", points: [-0.5, -0.4, 1, -1.2, 1, -2] },
  { kind: "line", points: [-0.5, 0.4, 1, 1.2, 1, 2] },
];

// Symbols follow IEC 60617 (rectangle resistor, humped inductor, circle sources). The order of
// this table is the order of the palette (and of its digit shortcuts), whatever the API order.
const EDITOR_PARTS: readonly (EditorPart & { type: string })[] = [
  {
    type: "resistor",
    category: "passive",
    symbol: [...leads(1), { kind: "rect", x: -0.4, y: -1, width: 0.8, height: 2 }],
  },
  {
    type: "capacitor",
    category: "passive",
    symbol: [
      ...leads(0.25),
      { kind: "line", points: [-0.8, -0.25, 0.8, -0.25] },
      { kind: "line", points: [-0.8, 0.25, 0.8, 0.25] },
    ],
  },
  {
    type: "inductor",
    category: "passive",
    symbol: [
      ...leads(1.2),
      ...[-0.9, -0.3, 0.3, 0.9].map((y): SymbolShape => ({
        kind: "arc",
        x: 0,
        y,
        radius: 0.3,
        start: -90,
        sweep: 180,
      })),
    ],
  },
  {
    type: "voltage_source",
    category: "source",
    symbol: [
      ...leads(1),
      { kind: "circle", x: 0, y: 0, radius: 1 },
      { kind: "line", points: [0, -1, 0, 1] },
      // "+" mark next to the + pin.
      { kind: "line", points: [0.5, -1.5, 0.9, -1.5] },
      { kind: "line", points: [0.7, -1.7, 0.7, -1.3] },
    ],
  },
  {
    type: "current_source",
    category: "source",
    symbol: [
      ...leads(1),
      { kind: "circle", x: 0, y: 0, radius: 1 },
      { kind: "line", points: [-1, 0, 1, 0] },
      // SPICE convention: current flows through the source from + to -.
      { kind: "line", points: [1.4, -0.6, 1.4, 0.6] },
      { kind: "line", points: [1.2, 0.3, 1.4, 0.6, 1.6, 0.3] },
    ],
  },
  {
    type: "ground",
    category: "connection",
    // Signal ground (masse): a triangle pointing down, not the three bars of the earth (terre).
    symbol: [
      { kind: "line", points: [0, 0, 0, 0.5] },
      { kind: "line", points: [-0.8, 0.5, 0.8, 0.5, 0, 1.3, -0.8, 0.5] },
    ],
  },
  { type: "label", category: "connection", symbol: LABEL_FLAGS.none },
  { type: "diode", category: "semiconductor", symbol: [...DIODE_BODY, DIODE_BAR] },
  {
    type: "zener",
    category: "semiconductor",
    // The cathode bar has bent ends (IEC 60617 Zener / avalanche diode).
    symbol: [...DIODE_BODY, { kind: "line", points: [-0.9, 0.8, -0.7, 0.6, 0.7, 0.6, 0.9, 0.4] }],
  },
  {
    type: "led",
    category: "semiconductor",
    symbol: [...DIODE_BODY, DIODE_BAR, ...lightArrow(0.7, -0.1), ...lightArrow(0.7, 0.4)],
  },
  {
    type: "npn",
    category: "semiconductor",
    // Emitter at the bottom; its arrow points out of the transistor.
    symbol: [...BIPOLAR_BODY, { kind: "line", points: [0.24, 1.02, 0.65, 1.01, 0.43, 0.67] }],
  },
  {
    type: "pnp",
    category: "semiconductor",
    // Emitter at the top; its arrow points into the transistor, towards the base.
    symbol: [...BIPOLAR_BODY, { kind: "line", points: [0.3, -0.6, -0.1, -0.61, 0.11, -0.95] }],
  },
  {
    type: "nmos",
    category: "semiconductor",
    // Enhancement MOSFET, N channel: drain (D) at the top, source (S) at the bottom, gate (G) on
    // the left. Broken channel line, bulk tied to the source, arrow pointing into the channel.
    symbol: [
      TRANSISTOR_ENVELOPE,
      { kind: "line", points: [-2, 0, -0.7, 0] },
      { kind: "line", points: [-0.7, -0.8, -0.7, 0.8] },
      { kind: "line", points: [-0.4, -0.95, -0.4, -0.45] },
      { kind: "line", points: [-0.4, -0.25, -0.4, 0.25] },
      { kind: "line", points: [-0.4, 0.45, -0.4, 0.95] },
      { kind: "line", points: [-0.4, -0.7, 1, -0.7, 1, -2] },
      { kind: "line", points: [-0.4, 0.7, 1, 0.7, 1, 2] },
      { kind: "line", points: [-0.4, 0, 1, 0, 1, 0.7] },
      { kind: "line", points: [0, -0.2, -0.35, 0, 0, 0.2] },
    ],
  },
  { type: "opamp", category: "amplifier", symbol: OPAMP_BODY },
  {
    type: "opamp_real",
    category: "amplifier",
    // Supply pins V+ (top) and V- (bottom), drawn to the triangle's edges.
    symbol: [
      ...OPAMP_BODY,
      { kind: "line", points: [0, -2, 0, -0.86] },
      { kind: "line", points: [0, 0.86, 0, 2] },
    ],
  },
];

let library: ReadonlyMap<string, ComponentDef> = new Map();

/** Fill the library from the API answer. Types the editor cannot draw yet are left out. */
export function setLibrary(components: readonly LibraryComponent[]): void {
  const byType = new Map(components.map((c) => [c.type, c]));
  for (const c of components) {
    if (!EDITOR_PARTS.some((p) => p.type === c.type)) {
      console.warn(`Bibliothèque : le type « ${c.type} » n'a pas encore de symbole, ignoré.`);
    }
  }
  const defs = new Map<string, ComponentDef>();
  for (const { type, category, symbol } of EDITOR_PARTS) {
    const c = byType.get(type);
    if (!c) continue;
    defs.set(type, {
      type,
      label: c.label,
      prefix: c.prefix,
      pins: c.pins,
      params: (c.params ?? []).map((p) => ({
        ...p,
        options: p.options ?? [],
        waveforms: p.waveforms ?? [],
      })),
      category,
      symbol,
    });
  }
  library = defs;
}

/** True once the library has been received from the backend. */
export const isLibraryLoaded = (): boolean => library.size > 0;

let loading: Promise<void> | null = null;

/** Fetch the library from the backend once; later calls share the same request. */
export function loadLibrary(fetchLibrary = getLibrary): Promise<void> {
  if (isLibraryLoaded()) return Promise.resolve();
  loading ??= fetchLibrary()
    .then(setLibrary)
    .finally(() => {
      loading = null; // a failed request can be retried
    });
  return loading;
}

/** Library components grouped as in the palette: categories in order, empty ones left out. */
export function paletteGroups(): { id: Category; label: string; defs: ComponentDef[] }[] {
  return CATEGORIES.map((c) => ({
    ...c,
    defs: [...library.values()].filter((d) => d.category === c.id),
  })).filter((g) => g.defs.length > 0);
}

export function getDef(type: string): ComponentDef {
  const def = library.get(type);
  if (!def) throw new Error(`Unknown component type: ${type}`);
  return def;
}

/** Parameters to show for these values: those of the selected waveform, and the common ones. */
export function visibleParams(def: ComponentDef, params: Record<string, string>): ParamDef[] {
  const waveform = params.waveform;
  return def.params.filter(
    (p) => p.waveforms.length === 0 || (waveform !== undefined && p.waveforms.includes(waveform)),
  );
}

/**
 * The parameter edited by a double-click on the component (#197): its main value (resistance,
 * capacitance, voltage…), else its first text (the node name of a label). Null when it has none.
 */
export function mainParam(def: ComponentDef, params: Record<string, string>): ParamDef | null {
  const shown = visibleParams(def, params);
  return shown.find((p) => p.kind === "value") ?? shown.find((p) => p.kind === "text") ?? null;
}

/**
 * Drawing of a placed component: the symbol of its type, except for a label, whose flag follows
 * its direction (absent or unknown: no direction, as in files saved before it existed).
 */
export function symbolOf(def: ComponentDef, params: Record<string, string>): SymbolShape[] {
  if (def.type !== "label") return def.symbol;
  return LABEL_FLAGS[params.direction ?? "none"] ?? def.symbol;
}

export interface Bounds {
  min: GridPoint;
  max: GridPoint;
}

/** Bounding box of a symbol and its pins, at rotation 0, in grid units. */
export function symbolBounds(def: ComponentDef): Bounds {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (x: number, y: number) => {
    xs.push(x);
    ys.push(y);
  };
  for (const pin of def.pins) add(pin.x, pin.y);
  for (const s of def.symbol) {
    switch (s.kind) {
      case "line":
        for (let i = 0; i + 1 < s.points.length; i += 2)
          add(s.points[i] ?? 0, s.points[i + 1] ?? 0);
        break;
      case "rect":
        add(s.x, s.y);
        add(s.x + s.width, s.y + s.height);
        break;
      case "circle":
      case "arc":
        add(s.x - s.radius, s.y - s.radius);
        add(s.x + s.radius, s.y + s.radius);
        break;
    }
  }
  return {
    min: { x: Math.min(...xs), y: Math.min(...ys) },
    max: { x: Math.max(...xs), y: Math.max(...ys) },
  };
}
