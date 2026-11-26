// Development and online demo (website) only: loads a circuit of shared/fixtures/ with its
// simulation result, and sets the toolbar to its analysis, so that Simulate gives that result again
// in the demo (src/api/demoBackend.ts).
//   - in the browser console: psiceDemo("rc_tran")
//   - or in the URL: http://localhost:5173/?demo=divider_op

import type { NetlistResult, SimulationRequest, SimulationResult } from "../api/client";
import { loadLibrary, useEditorStore, type EditorDoc } from "../store";
import { analysisSettings, fixtureDocument } from "./examples";

type FixtureFile = "schematic" | "analysis" | "result" | "netlist";

const files = import.meta.glob<unknown>(
  "../../../shared/fixtures/*/{schematic,analysis,result,netlist}.json",
  { eager: true, import: "default" },
);

function fixture(name: string, file: FixtureFile): unknown {
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
  const doc = fixtureDocument(schematic);
  const analysis = fixture(name, "analysis") as SimulationRequest["analysis"] | undefined;
  const settings = analysis ? analysisSettings(analysis) : null;
  const nets = (fixture(name, "netlist") as NetlistResult | undefined)?.nets ?? {};
  const store = useEditorStore.getState();
  store.openDocument(doc);
  if (settings) store.setAnalysis(settings);
  store.setSimulation(result, nets);
  store.setAnimation({ on: true });
}

declare global {
  interface Window {
    psiceDemo?: (name: string) => void;
  }
}

export function installDemo() {
  window.psiceDemo = loadDemo;
  const name = new URLSearchParams(window.location.search).get("demo");
  // The document needs the component library: wait for it (a failure is shown by the app).
  if (name)
    loadLibrary().then(
      () => loadDemo(name),
      () => {},
    );
}
