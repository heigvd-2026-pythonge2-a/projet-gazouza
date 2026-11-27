// Interactive probe (#105): with the probe tool, a click on a wire gives the voltage of its node,
// a click on a component the current through it. The store keeps the probed traces; the results
// panel (src/plot/) decides how to show them.

import type { SimulationResult } from "../api/client";
import type { EditorDoc } from "./document";

/** What was clicked with the probe tool. */
export type ProbeTarget = { wire: string } | { component: string };

/** A probed trace of the last simulation, and where it was clicked on the schematic. */
export interface Probe {
  /** Name of the trace in `SimulationResult.traces` ("v(out)", "i(R1)"): the probe's key. */
  trace: string;
  kind: "voltage" | "current";
  /** The wire or the component clicked, for marks on the schematic (#167). */
  at: ProbeTarget;
}

/** The last simulation, as kept by the store. */
interface ProbedSimulation {
  result: SimulationResult;
  /** Document the simulation was run on. */
  doc: EditorDoc;
  /** Netlist node -> its wires (`NetlistResult.nets`). */
  nets: Record<string, string[]>;
}

export const PROBE_NO_SIMULATION = "Lance d'abord une simulation pour sonder le circuit.";
export const PROBE_NEW_ITEM =
  "Cet élément n'existait pas lors de la dernière simulation : relance-la pour le sonder.";
export const PROBE_GROUND = "C'est la masse : sa tension vaut toujours 0 V.";
export const PROBE_NO_TRACE = "La simulation n'a pas de courbe pour cet élément.";

/** The probe for a click on `target`, or why there is none (in French, for the status bar). */
export function probeFor(
  simulation: ProbedSimulation | null,
  target: ProbeTarget,
): { probe: Probe } | { error: string } {
  if (!simulation) return { error: PROBE_NO_SIMULATION };
  const { result, doc, nets } = simulation;
  if ("wire" in target) {
    // A wire drawn since the simulation has no node yet.
    const net = Object.keys(nets).find((n) => nets[n]?.includes(target.wire));
    if (net === undefined) return { error: PROBE_NEW_ITEM };
    if (net === "0") return { error: PROBE_GROUND };
    const trace = (result.traces ?? []).find((t) => t.kind === "voltage" && t.net === net);
    if (!trace) return { error: PROBE_NO_TRACE };
    return { probe: { trace: trace.name, kind: "voltage", at: target } };
  }
  if (!doc.components.some((c) => c.id === target.component)) return { error: PROBE_NEW_ITEM };
  // The first current of the component: the one of the whole component, before any per-pin one.
  const trace = (result.traces ?? []).find(
    (t) => t.kind === "current" && t.component_id === target.component,
  );
  if (!trace) return { error: PROBE_NO_TRACE };
  return { probe: { trace: trace.name, kind: "current", at: target } };
}

/**
 * The probes after a click on `target`: the probe of its trace is removed if there was one (a
 * second click, on the same wire or on another wire of the same node), else added at the end.
 */
export function toggleProbe(
  probes: readonly Probe[],
  simulation: ProbedSimulation | null,
  target: ProbeTarget,
): { probes: Probe[] } | { error: string } {
  const found = probeFor(simulation, target);
  if ("error" in found) return found;
  const { probe } = found;
  return probes.some((p) => p.trace === probe.trace)
    ? { probes: probes.filter((p) => p.trace !== probe.trace) }
    : { probes: [...probes, probe] };
}

/**
 * The probes still meaningful for a new result: those whose trace is still in it. A result
 * without any trace (a simulation that failed) keeps them all, for the next one.
 */
export function keptProbes(probes: readonly Probe[], result: SimulationResult | null): Probe[] {
  if (!result || (result.traces ?? []).length === 0) return [...probes];
  const names = new Set((result.traces ?? []).map((t) => t.name));
  return probes.filter((p) => names.has(p.trace));
}
