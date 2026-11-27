// What the editor sends to the backend to simulate (the contract's `SimulationRequest`), and what
// it shows of the answer on the schematic. Texts in French.

import type { Schematic, SimulationRequest, SimulationResult } from "../api/client";
import {
  normalizeContacts,
  partPath,
  pinPosition,
  type EditorDoc,
  type GridPoint,
} from "./document";
import { describeNet, netItem } from "./netNames";
import type { NodeItem } from "./nodes";

/**
 * The editor document in the contract format (`Schematic`, docs/format-schema.md), with what
 * touches connected (`normalizeContacts`): the backend only follows the wires.
 */
export function toSchematic(doc: EditorDoc): Schematic {
  const copy = structuredClone(normalizeContacts(doc));
  return {
    version: 2,
    components: copy.components,
    junctions: copy.junctions,
    wires: copy.wires.map((w) => ({ id: w.id, from: w.from, to: w.to, points: w.points })),
  };
}

// --- Analysis chosen by the user ----------------------------------------------------------------

/** Analyses offered by the Simulate button (#100, #222). */
export type AnalysisKind = "op" | "tran" | "ac" | "dc";

/** The analysis as set in the toolbar: values as typed, with SPICE suffixes. */
export interface AnalysisSettings {
  kind: AnalysisKind;
  /** Transient: end of the simulation, in seconds ("10m"). */
  stopTime: string;
  /**
   * Transient: number of time points, at least (#334); the step is stopTime / tranPoints. Empty:
   * not sent, the backend takes `DEFAULT_TRAN_POINTS`.
   */
  tranPoints: string;
  /** Transient, advanced: largest time step, in seconds; empty for automatic. */
  maxStep: string;
  /** AC: id of the input source; empty or gone: the first source of the schematic. */
  acSource: string;
  /** AC: first and last frequency, in hertz ("10", "100k"). */
  acStart: string;
  acStop: string;
  /** AC: number of points per decade. */
  acPoints: string;
  /** DC sweep: id of the swept source; empty or gone: the first source of the schematic. */
  dcSource: string;
  /** DC sweep: first and last value, and step, in volts or amperes. */
  dcStart: string;
  dcStop: string;
  dcStep: string;
}

type DcRange = Pick<AnalysisSettings, "dcStart" | "dcStop" | "dcStep">;

/** Default range of a DC sweep, by unit of the swept source: 0 to 5 V, or 0 to 10 mA. */
export const DC_DEFAULTS: Record<"V" | "A", DcRange> = {
  V: { dcStart: "0", dcStop: "5", dcStep: "100m" },
  A: { dcStart: "0", dcStop: "10m", dcStep: "100u" },
};

/**
 * The DC range to set when the swept source is in `unit`: the default of that unit if the range
 * is still the default of the other one (5 A would be far too much for a current source), else
 * nothing, so that a range typed by the user is kept.
 */
export function dcRangeFor(s: DcRange, unit: "V" | "A"): Partial<DcRange> {
  const other = DC_DEFAULTS[unit === "V" ? "A" : "V"];
  const untouched =
    s.dcStart === other.dcStart && s.dcStop === other.dcStop && s.dcStep === other.dcStep;
  return untouched ? { ...DC_DEFAULTS[unit] } : {};
}

/** Points of a transient analysis when none are typed: what ngspice took before #334. */
export const DEFAULT_TRAN_POINTS = 1000;

/**
 * Most points a simulation may give: `MAX_RESULT_POINTS` of the backend
 * (`backend/app/engines/parser.py`), checked here while typing (#334).
 */
export const MAX_TRAN_POINTS = 200_000;

export const DEFAULT_ANALYSIS: AnalysisSettings = {
  kind: "op",
  stopTime: "10m",
  tranPoints: "",
  maxStep: "",
  acSource: "",
  acStart: "10",
  acStop: "100k",
  acPoints: "20",
  dcSource: "",
  ...DC_DEFAULTS.V,
};

/** Component types that `.ac` can excite and `.dc` can sweep. */
const SOURCE_TYPES: Record<string, "V" | "A"> = { voltage_source: "V", current_source: "A" };

/** A source of the schematic, as offered for `.ac` and `.dc`. */
export interface AnalysisSource {
  id: string;
  name: string;
  /** Unit of its value: "V" for a voltage source, "A" for a current source. */
  unit: "V" | "A";
}

/** The independent sources of the document, in drawing order. */
export function analysisSources(doc: EditorDoc): AnalysisSource[] {
  return doc.components.flatMap((c) => {
    const unit = SOURCE_TYPES[c.type];
    return unit ? [{ id: c.id, name: c.name ?? c.id, unit }] : [];
  });
}

/** The source chosen for `.ac` or `.dc`: the one set if it still exists, else the first one. */
export function chosenSource(sources: AnalysisSource[], id: string): AnalysisSource | undefined {
  return sources.find((s) => s.id === id) ?? sources[0];
}

/** Largest number of points of a DC sweep: beyond, the step is surely a typing mistake. */
const MAX_DC_POINTS = 100_000;

/** Power of ten of each SPICE suffix. */
const SUFFIXES: Record<string, number> = {
  f: -15,
  p: -12,
  n: -9,
  u: -6,
  m: -3,
  k: 3,
  meg: 6,
  g: 9,
  t: 12,
};

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|[fpnumkgt])?s?$/i;

/** "10m" -> 0.01, "1.5u" -> 1.5e-6, "2ms" -> 0.002 (a time may end with "s"). Null if invalid. */
export function parseSpiceNumber(text: string): number | null {
  const m = NUMBER.exec(text.trim());
  if (!m?.[1]) return null;
  // Through the exponent rather than a product, so "10u" is exactly 1e-5.
  const exponent = m[2] ? (SUFFIXES[m[2].toLowerCase()] ?? 0) : 0;
  const value = Number(`${Number(m[1])}e${exponent}`);
  return Number.isFinite(value) ? value : null;
}

type AnalysisOrError = { analysis: SimulationRequest["analysis"] } | { error: string };

/**
 * The analysis of the request, or the reason why the settings cannot be simulated. `sources` are
 * the sources of the schematic (`analysisSources`), needed by `.ac` and `.dc` only.
 */
export function toAnalysis(s: AnalysisSettings, sources: AnalysisSource[] = []): AnalysisOrError {
  if (s.kind === "op") return { analysis: { kind: "op" } };
  if (s.kind === "ac") return toAc(s, sources);
  if (s.kind === "dc") return toDc(s, sources);
  const stop = parseSpiceNumber(s.stopTime);
  if (stop === null || stop <= 0) {
    return { error: "Durée de la simulation invalide : par exemple 10m (10 millisecondes)." };
  }
  const points = tranPoints(s.tranPoints);
  if (typeof points === "string") return { error: points };
  // Points left empty are not sent: the requests of the examples stay those of the fixtures.
  const tran = { kind: "tran", stop_time: stop, ...(points ? { points } : {}) } as const;
  if (s.maxStep.trim() === "") return { analysis: tran };
  const step = parseSpiceNumber(s.maxStep);
  if (step === null || step <= 0) {
    return { error: "Pas maximal invalide : par exemple 10u (10 microsecondes), ou vide." };
  }
  if (step >= stop) return { error: "Le pas maximal doit être plus petit que la durée." };
  return { analysis: { ...tran, max_step: step } };
}

/** The number of points typed for `.tran`, or why it is wrong (#334). Empty: null. */
function tranPoints(text: string): number | null | string {
  if (text.trim() === "") return null;
  const points = Number(text.trim().replace(/[\s']/g, ""));
  if (!Number.isInteger(points) || points < 2) {
    return "Nombre de points invalide : un nombre entier, par exemple 1000.";
  }
  if (points > MAX_TRAN_POINTS) {
    return `Trop de points : la limite est ${MAX_TRAN_POINTS.toLocaleString("fr-CH")}, réduis le nombre de points.`;
  }
  return points;
}

/**
 * The time step of a transient analysis, shown next to its settings (#334), as the backend
 * computes it (`tran_max_step` in `backend/app/netlist/writer.py`): the smaller of
 * `stopTime / tranPoints` and the maximum step, the one given if only one is, else
 * `stopTime / DEFAULT_TRAN_POINTS`. Null while a setting is invalid.
 */
export function tranStep(s: AnalysisSettings): number | null {
  const result = toAnalysis({ ...s, kind: "tran" });
  if (!("analysis" in result) || result.analysis.kind !== "tran") return null;
  const { stop_time, points, max_step } = result.analysis;
  const steps = [max_step, points ? stop_time / points : null].filter((x) => x != null);
  return steps.length > 0 ? Math.min(...steps) : stop_time / DEFAULT_TRAN_POINTS;
}

function toAc(s: AnalysisSettings, sources: AnalysisSource[]): AnalysisOrError {
  const source = chosenSource(sources, s.acSource);
  if (!source) {
    return { error: "L'analyse fréquentielle a besoin d'une source de tension ou de courant." };
  }
  const start = parseSpiceNumber(s.acStart);
  if (start === null || start <= 0) {
    return { error: "Fréquence de début invalide : par exemple 10 (10 Hz) ou 1k (1 kHz)." };
  }
  const stop = parseSpiceNumber(s.acStop);
  if (stop === null || stop <= 0) {
    return { error: "Fréquence de fin invalide : par exemple 100k (100 kHz)." };
  }
  if (stop <= start) {
    return { error: "La fréquence de fin doit être plus grande que la fréquence de début." };
  }
  const points = Number(s.acPoints.trim());
  if (!Number.isInteger(points) || points <= 0 || points > 1000) {
    return {
      error: "Points par décade invalides : un nombre entier entre 1 et 1000, par exemple 20.",
    };
  }
  return {
    analysis: {
      kind: "ac",
      input_source_id: source.id,
      start_frequency: start,
      stop_frequency: stop,
      points_per_decade: points,
    },
  };
}

function toDc(s: AnalysisSettings, sources: AnalysisSource[]): AnalysisOrError {
  const source = chosenSource(sources, s.dcSource);
  if (!source) return { error: "Le balayage DC a besoin d'une source de tension ou de courant." };
  const unit = source.unit === "V" ? "5 (5 V)" : "10m (10 mA)";
  const start = parseSpiceNumber(s.dcStart);
  if (start === null) return { error: `Valeur de début invalide : par exemple 0 ou ${unit}.` };
  const stop = parseSpiceNumber(s.dcStop);
  if (stop === null) return { error: `Valeur de fin invalide : par exemple ${unit}.` };
  if (stop <= start) return { error: "La valeur de fin doit être plus grande que celle de début." };
  const step = parseSpiceNumber(s.dcStep);
  if (step === null || step <= 0) {
    return { error: "Pas du balayage invalide : un nombre positif, par exemple 100m." };
  }
  if (step > stop - start) {
    return { error: "Le pas du balayage doit être plus petit que l'écart entre début et fin." };
  }
  if ((stop - start) / step > MAX_DC_POINTS) {
    return { error: "Le pas du balayage est trop petit : plus de 100 000 points à calculer." };
  }
  return { analysis: { kind: "dc", source_id: source.id, start, stop, step } };
}

// --- Operating point shown on the schematic (#102) ----------------------------------------------

const PREFIXES: [number, string][] = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
  [1e-9, "n"],
  [1e-12, "p"],
];

/** 0.0045, "A" -> "4,5 mA"; 3 significant digits, SI prefixes, French decimal comma. */
export function formatSI(value: number, unit: string): string {
  if (value === 0 || !Number.isFinite(value)) return `0 ${unit}`;
  const abs = Math.abs(value);
  const [factor, prefix] = PREFIXES.find(([f]) => abs >= f * 0.9995) ?? [1e-12, "p"];
  const shown = String(Number((value / factor).toPrecision(3))).replace(".", ",");
  return `${shown} ${prefix}${unit}`;
}

/** A value shown next to the schematic: the voltage of a node or the current of a component. */
export interface OperatingPointLabel {
  key: string;
  kind: "voltage" | "current";
  text: string;
  /** Where the text is anchored, in grid units. */
  position: GridPoint;
  /** Side of the anchor the text goes to. */
  side: "above" | "right" | "left" | "below";
  /**
   * Slant of the text, in degrees clockwise (between -90 and 90, so it reads left to right): the
   * text of a diagonal arrow follows it, centred on `position` (#290).
   */
  angle?: number;
}

/**
 * Potential labels of an operating point (.op) result: each node voltage on the longest segment of
 * one of its wires (`nets`, from the netlist, gives them), or next to one of its pins for a node
 * without a wire on screen (two pins touching). The ground (0 V) is not labelled. The currents
 * are drawn as arrows (`currentArrows`, #290).
 */
export function operatingPointLabels(
  doc: EditorDoc,
  result: SimulationResult,
  nets: Record<string, string[]>,
): OperatingPointLabel[] {
  if (result.analysis !== "op") return [];
  const labels: OperatingPointLabel[] = [];
  for (const trace of result.traces ?? []) {
    const value = trace.values[0];
    if (value === undefined || trace.kind !== "voltage" || !trace.net || trace.net === "0") {
      continue;
    }
    const key = `v:${trace.net}`;
    const text = formatSI(value, "V");
    const wire = (nets[trace.net] ?? [])
      .map((id) => doc.wires.find((w) => w.id === id))
      .find((w) => w !== undefined);
    if (!wire) {
      const item = netItem(doc, nets[trace.net] ?? []);
      const c = item && "comp" in item ? doc.components.find((x) => x.id === item.comp) : null;
      if (c && item && "comp" in item) {
        labels.push({
          key,
          kind: "voltage",
          text,
          position: pinPosition(c, item.pin),
          side: "right",
        });
      }
      continue;
    }
    const path = partPath(doc, wire);
    let best: [GridPoint, GridPoint] | null = null;
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i] as GridPoint;
      const b = path[i + 1] as GridPoint;
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (!best || length > Math.abs(best[1].x - best[0].x) + Math.abs(best[1].y - best[0].y)) {
        best = [a, b];
      }
    }
    if (!best) continue;
    const [a, b] = best;
    labels.push({
      key,
      kind: "voltage",
      text,
      position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      side: a.y === b.y ? "above" : "right",
    });
  }
  return labels;
}

// --- Operating point table of the results panel (#292) ------------------------------------------

/** One line of the operating point table. */
export interface OperatingPointRow {
  key: string;
  /** What the value is about ("Base de Q1", "V1 fournit"…). */
  label: string;
  /** The value, formatted ("4,27 mA"). */
  value: string;
  /** What to highlight on the schematic while the line is hovered. */
  highlight: NodeItem | { component: string } | null;
}

/** A group of lines of the table, with its title. */
export interface OperatingPointGroup {
  title: string;
  rows: OperatingPointRow[];
}

/**
 * The values of an operating point (.op) result, as shown in the results panel: node potentials
 * named after the schematic (`describeNet`, never "n1"), sorted by name, then the voltages across
 * the transistors given in `terminals` (`terminalVoltageRows`, #290), then currents. A voltage
 * source's current is given as what it supplies (SPICE counts it negative then) or receives; the
 * other currents without sign, their direction being shown on the schematic. Empty groups are
 * left out.
 */
export function operatingPointTable(
  doc: EditorDoc,
  result: SimulationResult,
  nets: Record<string, string[]>,
  terminals: OperatingPointRow[] = [],
): OperatingPointGroup[] {
  if (result.analysis !== "op") return [];
  const potentials: OperatingPointRow[] = [];
  const currents: OperatingPointRow[] = [];
  for (const trace of result.traces ?? []) {
    const value = trace.values[0];
    if (value === undefined) continue;
    if (trace.kind === "voltage") {
      const net = trace.net ?? trace.name;
      const { name, item } = describeNet(doc, net, nets[net] ?? []);
      potentials.push({
        key: trace.name,
        label: name,
        value: formatSI(value, "V"),
        highlight: item,
      });
      continue;
    }
    const c = doc.components.find((x) => x.id === trace.component_id);
    const name = c?.name ?? trace.component_id ?? trace.name;
    const highlight = c ? { component: c.id } : null;
    const label =
      c?.type === "voltage_source"
        ? `${name} ${value <= 0 ? "fournit" : "reçoit"}`
        : `Courant dans ${name}`;
    currents.push({ key: trace.name, label, value: formatSI(Math.abs(value), "A"), highlight });
  }
  potentials.sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }));
  return [
    { title: "Potentiels des nœuds (par rapport à la masse)", rows: potentials },
    { title: "Tensions aux bornes des transistors", rows: terminals },
    { title: "Courants", rows: currents },
  ].filter((g) => g.rows.length > 0);
}
