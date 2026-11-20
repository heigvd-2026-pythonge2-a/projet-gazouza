// PROVISIONAL component library, used until the backend serves `GET /api/library`.
// The shape mirrors the backend library files (docs/format-schema.md, section 5, and
// backend/app/netlist/library/*.json), plus a `symbol` (drawing in grid units, at rotation 0)
// whose format the editor will propose. Swapping to the API should be a data swap only.

import type { GridPoint } from "./document";

export type SymbolShape =
  | { kind: "line"; points: number[] }
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "circle"; x: number; y: number; radius: number }
  /** Arc from `start` to `start + sweep` degrees, clockwise (y axis points down). */
  | { kind: "arc"; x: number; y: number; radius: number; start: number; sweep: number };

export interface PinDef {
  name: string;
  x: number;
  y: number;
}

/** One allowed value of a "choice" parameter. */
export interface ParamOption {
  /** Stored in `params` (e.g. "pulse"). */
  value: string;
  /** Shown to the user, in French (e.g. "Impulsion"). */
  label: string;
}

export interface ParamDef {
  name: string;
  label: string;
  unit: string;
  default: string;
  /** "value": SPICE number ("1k"); "text": free text (label name); "choice": one of `options`. */
  kind: "value" | "text" | "choice";
  options: ParamOption[];
  /** Sources only: the waveforms that use this parameter. Empty: always shown. */
  waveforms: string[];
}

export interface ComponentDef {
  type: string;
  label: string;
  /** SPICE prefix. `null` for ground and label, which have no SPICE line and no `name`. */
  prefix: string | null;
  pins: PinDef[];
  params: ParamDef[];
  symbol: SymbolShape[];
}

const twoPins = (a: string, b: string): PinDef[] => [
  { name: a, x: 0, y: -2 },
  { name: b, x: 0, y: 2 },
];

const value = (
  name: string,
  label: string,
  unit: string,
  defaultValue: string,
  waveforms: string[] = [],
): ParamDef => ({
  name,
  label,
  unit,
  default: defaultValue,
  kind: "value",
  options: [],
  waveforms,
});

const WAVEFORM: ParamDef = {
  name: "waveform",
  label: "Forme d'onde",
  unit: "",
  default: "dc",
  kind: "choice",
  options: [
    { value: "dc", label: "Continue" },
    { value: "pulse", label: "Impulsion" },
    { value: "sin", label: "Sinusoïde" },
  ],
  waveforms: [],
};

/** Parameters of a voltage ("V", v1/v2) or current ("A", i1/i2) source, as in the backend. */
function sourceParams(unit: "V" | "A"): ParamDef[] {
  const voltage = unit === "V";
  const low = voltage ? "v1" : "i1";
  const high = voltage ? "v2" : "i2";
  const what = voltage ? "Tension" : "Courant";
  return [
    WAVEFORM,
    value("dc", `${what} continu${voltage ? "e" : ""}`, unit, voltage ? "5" : "1m", ["dc"]),
    value(low, `${what} bas${voltage ? "se" : ""}`, unit, "0", ["pulse"]),
    value(high, `${what} haut${voltage ? "e" : ""}`, unit, voltage ? "5" : "1m", ["pulse"]),
    value("delay", "Retard", "s", "0", ["pulse", "sin"]),
    value("rise", "Temps de montée", "s", "1n", ["pulse"]),
    value("fall", "Temps de descente", "s", "1n", ["pulse"]),
    value("width", "Durée haute", "s", "1m", ["pulse"]),
    value("period", "Période", "s", "2m", ["pulse"]),
    value("offset", "Décalage", unit, "0", ["sin"]),
    value("amplitude", "Amplitude", unit, voltage ? "1" : "1m", ["sin"]),
    value("frequency", "Fréquence", "Hz", "1k", ["sin"]),
    value("damping", "Amortissement", "1/s", "0", ["sin"]),
    value("phase", "Phase", "°", "0", ["sin"]),
  ];
}

const leads = (gap: number): SymbolShape[] => [
  { kind: "line", points: [0, -2, 0, -gap] },
  { kind: "line", points: [0, gap, 0, 2] },
];

// Symbols follow IEC 60617 (rectangle resistor, humped inductor, circle sources).
const DEFS: ComponentDef[] = [
  {
    type: "resistor",
    label: "Résistance",
    prefix: "R",
    pins: twoPins("1", "2"),
    params: [value("resistance", "Résistance", "Ω", "1k")],
    symbol: [...leads(1), { kind: "rect", x: -0.4, y: -1, width: 0.8, height: 2 }],
  },
  {
    type: "capacitor",
    label: "Condensateur",
    prefix: "C",
    pins: twoPins("1", "2"),
    params: [value("capacitance", "Capacité", "F", "1u")],
    symbol: [
      ...leads(0.25),
      { kind: "line", points: [-0.8, -0.25, 0.8, -0.25] },
      { kind: "line", points: [-0.8, 0.25, 0.8, 0.25] },
    ],
  },
  {
    type: "inductor",
    label: "Bobine",
    prefix: "L",
    pins: twoPins("1", "2"),
    params: [value("inductance", "Inductance", "H", "1m")],
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
    label: "Source de tension",
    prefix: "V",
    pins: twoPins("+", "-"),
    params: sourceParams("V"),
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
    label: "Source de courant",
    prefix: "I",
    pins: twoPins("+", "-"),
    params: sourceParams("A"),
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
    label: "Masse",
    prefix: null,
    pins: [{ name: "1", x: 0, y: 0 }],
    params: [],
    symbol: [
      { kind: "line", points: [0, 0, 0, 0.5] },
      { kind: "line", points: [-0.8, 0.5, 0.8, 0.5] },
      { kind: "line", points: [-0.5, 0.8, 0.5, 0.8] },
      { kind: "line", points: [-0.2, 1.1, 0.2, 1.1] },
    ],
  },
  {
    type: "label",
    label: "Étiquette de nœud",
    prefix: null,
    pins: [{ name: "1", x: 0, y: 0 }],
    params: [
      {
        name: "net",
        label: "Nom du nœud",
        unit: "",
        default: "out",
        kind: "text",
        options: [],
        waveforms: [],
      },
    ],
    symbol: [{ kind: "line", points: [0, 0, 0.5, -0.5, 2, -0.5, 2, 0.5, 0.5, 0.5, 0, 0] }],
  },
];

export const LIBRARY: ReadonlyMap<string, ComponentDef> = new Map(DEFS.map((d) => [d.type, d]));

export function getDef(type: string): ComponentDef {
  const def = LIBRARY.get(type);
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
