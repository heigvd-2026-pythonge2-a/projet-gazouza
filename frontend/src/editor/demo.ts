// Development and online demo (website) only: loads a circuit of shared/fixtures/ with its
// simulation result, and sets the toolbar to its analysis, so that Simulate gives that result again
// in the demo (src/api/demoBackend.ts).
//   - in the browser console: psiceDemo("rc_tran")
//   - or in the URL: http://localhost:5173/?demo=divider_op

import type { NetlistResult, SimulationRequest, SimulationResult } from "../api/client";
import {
  loadLibrary,
  useEditorStore,
  type AnalysisSettings,
  type EditorDoc,
  type EditorWire,
} from "../store";

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

const SUFFIXES: [number, string][] = [
  [1, ""],
  [1e-3, "m"],
  [1e-6, "u"],
  [1e-9, "n"],
  [1e-12, "p"],
];

/** A time as typed in the toolbar: 0.005 -> "5m", 1e-5 -> "10u". */
export function spiceTime(seconds: number): string {
  const [factor, suffix] = SUFFIXES.find(([f]) => seconds >= f) ?? SUFFIXES.at(-1) ?? [1, ""];
  return `${Number((seconds / factor).toPrecision(6))}${suffix}`;
}

/** The toolbar settings of a fixture's analysis, or null if the toolbar does not offer it. */
export function analysisSettings(
  analysis: SimulationRequest["analysis"],
): Partial<AnalysisSettings> | null {
  if (analysis.kind === "op") return { kind: "op" };
  if (analysis.kind !== "tran") return null;
  return {
    kind: "tran",
    stopTime: spiceTime(analysis.stop_time),
    maxStep: analysis.max_step ? spiceTime(analysis.max_step) : "",
  };
}

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
