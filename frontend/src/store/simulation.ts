// What the editor sends to the backend to simulate (the contract's `SimulationRequest`), and what
// it shows of the answer on the schematic. Texts in French.

import type { Schematic, SimulationRequest, SimulationResult } from "../api/client";
import { partPath, type EditorDoc, type GridPoint } from "./document";
import { getDef } from "./library";

/** The editor document in the contract format (`Schematic`, docs/format-schema.md). */
export function toSchematic(doc: EditorDoc): Schematic {
  const copy = structuredClone(doc);
  return {
    version: 2,
    components: copy.components,
    junctions: copy.junctions,
    wires: copy.wires.map((w) => ({ id: w.id, from: w.from, to: w.to, points: w.points })),
  };
}

// --- Analysis chosen by the user ----------------------------------------------------------------

/** Analyses offered by the Simulate button (#100). */
export type AnalysisKind = "op" | "tran";

/** The analysis as set in the toolbar: values as typed, with SPICE suffixes. */
export interface AnalysisSettings {
  kind: AnalysisKind;
  /** Transient: end of the simulation, in seconds ("10m"). */
  stopTime: string;
  /** Transient: largest time step, in seconds; empty for automatic. */
  maxStep: string;
}

export const DEFAULT_ANALYSIS: AnalysisSettings = { kind: "op", stopTime: "10m", maxStep: "" };

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

/** The analysis of the request, or the reason why the settings cannot be simulated. */
export function toAnalysis(
  s: AnalysisSettings,
): { analysis: SimulationRequest["analysis"] } | { error: string } {
  if (s.kind === "op") return { analysis: { kind: "op" } };
  const stop = parseSpiceNumber(s.stopTime);
  if (stop === null || stop <= 0) {
    return { error: "Durée de la simulation invalide : par exemple 10m (10 millisecondes)." };
  }
  if (s.maxStep.trim() === "") return { analysis: { kind: "tran", stop_time: stop } };
  const step = parseSpiceNumber(s.maxStep);
  if (step === null || step <= 0) {
    return { error: "Pas maximal invalide : par exemple 10u (10 microsecondes), ou vide." };
  }
  if (step >= stop) return { error: "Le pas maximal doit être plus petit que la durée." };
  return { analysis: { kind: "tran", stop_time: stop, max_step: step } };
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

/** 0.005, "A" -> "5 mA"; 3 significant digits, SI prefixes. */
export function formatSI(value: number, unit: string): string {
  if (value === 0 || !Number.isFinite(value)) return `0 ${unit}`;
  const abs = Math.abs(value);
  const [factor, prefix] = PREFIXES.find(([f]) => abs >= f * 0.9995) ?? [1e-12, "p"];
  const shown = Number((value / factor).toPrecision(3));
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
}

/**
 * Labels of an operating point (.op) result: each node voltage on the longest segment of one of
 * its wires (`nets`, from the netlist, gives them), each two-pin component's current beside it,
 * on the side away from its caption. The ground (0 V) is not labelled.
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
    if (value === undefined) continue;
    if (trace.kind === "voltage" && trace.net && trace.net !== "0") {
      const wire = (nets[trace.net] ?? [])
        .map((id) => doc.wires.find((w) => w.id === id))
        .find((w) => w !== undefined);
      if (!wire) continue;
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
        key: `v:${trace.net}`,
        kind: "voltage",
        text: formatSI(value, "V"),
        position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        side: a.y === b.y ? "above" : "right",
      });
    } else if (trace.kind === "current" && trace.component_id) {
      const c = doc.components.find((x) => x.id === trace.component_id);
      if (!c || getDef(c.type).pins.length !== 2) continue;
      // The caption is right of a vertical symbol and above a horizontal one.
      const vertical = c.rotation === 0 || c.rotation === 180;
      labels.push({
        key: `i:${c.id}`,
        kind: "current",
        text: formatSI(Math.abs(value), "A"),
        position: vertical
          ? { x: c.position.x - 1.2, y: c.position.y }
          : { x: c.position.x, y: c.position.y + 1.2 },
        side: vertical ? "left" : "below",
      });
    }
  }
  return labels;
}
