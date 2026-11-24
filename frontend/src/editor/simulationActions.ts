// Simulate button (#100) and netlist export (#114): send the schematic and the analysis set in the
// toolbar to the backend. Errors are shown to the user in French.

import { ApiError, generateNetlist, simulate, type SimulationRequest } from "../api/client";
import { toAnalysis, toSchematic, useEditorStore } from "../store";
import { saveNewFile } from "./fileActions";

/** Cancels the simulation in progress, if any. */
let stop: AbortController | null = null;

/** The request for the current document and analysis, or why there is none. */
function request(): { request: SimulationRequest } | { error: string } {
  const s = useEditorStore.getState();
  if (s.doc.components.length === 0) {
    return { error: "Le schéma est vide : pose des composants avant de simuler." };
  }
  const analysis = toAnalysis(s.analysis);
  if ("error" in analysis) return analysis;
  return { request: { schematic: toSchematic(s.doc), analysis: analysis.analysis } };
}

const message = (error: unknown) =>
  error instanceof ApiError ? error.message : "La simulation a échoué de façon inattendue.";

/**
 * Runs the simulation of the current document. The result is kept with the document it was run
 * on (see `setSimulation`); for an operating point, the netlist's nodes are fetched too, to show
 * the voltages on the schematic. Running it again while it runs stops it.
 */
export async function runSimulation(): Promise<void> {
  if (stop) {
    stopSimulation();
    return;
  }
  const s = useEditorStore.getState();
  const built = request();
  if ("error" in built) {
    s.setSimulating(false, built.error);
    return;
  }
  const doc = s.doc;
  const controller = new AbortController();
  stop = controller;
  s.setSimulating(true);
  try {
    const result = await simulate(built.request, { signal: controller.signal });
    let nets: Record<string, string[]> = {};
    if (result.analysis === "op" && (result.errors ?? []).length === 0) {
      // Only needed to place the values; the result is shown without them if this fails.
      nets = await generateNetlist(built.request, { signal: controller.signal })
        .then((n) => n.nets ?? {})
        .catch(() => ({}));
    }
    // Stopped while the nodes were fetched (that error is swallowed above): drop the result.
    if (controller.signal.aborted) {
      useEditorStore.getState().setSimulating(false);
      return;
    }
    const now = useEditorStore.getState();
    // Edited meanwhile: the result is of another schematic, it would show as stale at once.
    if (now.doc !== doc) {
      now.setSimulating(false, "Le schéma a changé pendant la simulation : relance-la.");
      return;
    }
    now.setSimulation(result, nets);
    now.setSimulating(false);
  } catch (error: unknown) {
    const aborted = error instanceof ApiError && error.kind === "aborted";
    useEditorStore.getState().setSimulating(false, aborted ? null : message(error));
  } finally {
    if (stop === controller) stop = null;
  }
}

/** Stops the simulation in progress (its result is dropped). */
export function stopSimulation() {
  stop?.abort();
  stop = null;
}

/** Name proposed for an exported netlist. */
export const NETLIST_FILE_NAME = "schema.cir";

/**
 * Exports the SPICE netlist of the schematic, with the analysis set in the toolbar, in a `.cir`
 * file that ngspice runs as is (#114). If the circuit has errors, says which instead.
 */
export async function exportNetlist(): Promise<void> {
  const built = request();
  if ("error" in built) {
    window.alert(built.error);
    return;
  }
  try {
    const result = await generateNetlist(built.request);
    const errors = result.errors ?? [];
    if (errors.length > 0 || !result.netlist) {
      window.alert(
        ["La netlist ne peut pas être générée :", ...errors.map((e) => `• ${e.message}`)].join(
          "\n",
        ),
      );
      return;
    }
    const content = new Blob([result.netlist], { type: "text/plain" });
    await saveNewFile(NETLIST_FILE_NAME, content, [
      { description: "Netlist SPICE", accept: { "text/plain": [".cir"] } },
    ]);
  } catch (error: unknown) {
    window.alert(message(error));
  }
}
