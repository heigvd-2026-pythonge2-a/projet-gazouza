// Development only: loads a circuit of shared/fixtures/ with its simulation result, to try the
// current animation before the simulation is wired to the backend.
//   - in the browser console: psiceDemo("rc_tran")
//   - or in the URL: http://localhost:5173/?demo=divider_op

import type { SimulationResult } from "../api/client";
import { useEditorStore, type EditorDoc, type EditorWire } from "../store";

const files = import.meta.glob<unknown>("../../../shared/fixtures/*/{schematic,result}.json", {
  eager: true,
  import: "default",
});

function fixture(name: string, file: "schematic" | "result"): unknown {
  return files[`../../../shared/fixtures/${name}/${file}.json`];
}

/** Names of the fixture circuits. */
export const demoNames = (): string[] =>
  [...new Set(Object.keys(files).map((k) => k.split("/").at(-2) ?? ""))].sort();

/** Opens fixture `name` and its result as if it had just been simulated. */
export function loadDemo(name: string) {
  const schematic = fixture(name, "schematic") as EditorDoc | undefined;
  const result = fixture(name, "result") as SimulationResult | undefined;
  if (!schematic || !result) {
    console.warn(`psiceDemo : circuits disponibles : ${demoNames().join(", ")}`);
    return;
  }
  // The contract schematic (version 2) has the editor's fields; bends are optional there.
  const doc: EditorDoc = {
    components: schematic.components,
    junctions: schematic.junctions,
    wires: schematic.wires.map((w: EditorWire) => ({ ...w, points: w.points ?? [] })),
  };
  useEditorStore.getState().openDocument(doc);
  useEditorStore.getState().setSimulation(result);
  useEditorStore.getState().setAnimation({ on: true });
}

declare global {
  interface Window {
    psiceDemo?: (name: string) => void;
  }
}

export function installDemo() {
  window.psiceDemo = loadDemo;
  const name = new URLSearchParams(window.location.search).get("demo");
  if (name) loadDemo(name);
}
