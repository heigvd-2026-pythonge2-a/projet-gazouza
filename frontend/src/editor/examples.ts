// Examples menu (#226): the reference circuits of shared/fixtures/, ready to simulate, so that a
// beginner sees at once what a working circuit looks like. Only their schematic and analysis are
// bundled in the app (a few kilobytes), not their results.

import type { SimulationRequest } from "../api/client";
import type { AnalysisSettings, EditorDoc, EditorWire } from "../store";

type Analysis = SimulationRequest["analysis"];

const files = import.meta.glob<unknown>("../../../shared/fixtures/*/{schematic,analysis}.json", {
  eager: true,
  import: "default",
});

const SUFFIXES: [number, string][] = [
  [1e9, "g"],
  [1e6, "Meg"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "u"],
  [1e-9, "n"],
  [1e-12, "p"],
];

/** A number as typed in the toolbar: 0.005 -> "5m", 1e-5 -> "10u", 1e5 -> "100k", 0 -> "0". */
export function spiceNumber(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  const [factor, suffix] = SUFFIXES.find(([f]) => abs >= f) ?? SUFFIXES.at(-1) ?? [1, ""];
  return `${Number((value / factor).toPrecision(6))}${suffix}`;
}

/** The toolbar settings of an analysis of the contract. */
export function analysisSettings(analysis: Analysis): Partial<AnalysisSettings> {
  switch (analysis.kind) {
    case "op":
      return { kind: "op" };
    case "tran":
      return {
        kind: "tran",
        stopTime: spiceNumber(analysis.stop_time),
        maxStep: analysis.max_step ? spiceNumber(analysis.max_step) : "",
      };
    case "ac":
      return {
        kind: "ac",
        acSource: analysis.input_source_id,
        acStart: spiceNumber(analysis.start_frequency),
        acStop: spiceNumber(analysis.stop_frequency),
        acPoints: String(analysis.points_per_decade ?? 20),
      };
    case "dc":
      return {
        kind: "dc",
        dcSource: analysis.source_id,
        dcStart: spiceNumber(analysis.start),
        dcStop: spiceNumber(analysis.stop),
        dcStep: spiceNumber(analysis.step),
      };
  }
}

/** A contract schematic (version 2) as an editor document: bends are optional there. */
export function fixtureDocument(schematic: EditorDoc): EditorDoc {
  const copy = structuredClone(schematic);
  return {
    components: copy.components,
    junctions: copy.junctions,
    wires: copy.wires.map((w: EditorWire) => ({ ...w, points: w.points ?? [] })),
    texts: copy.texts ?? [],
  };
}

/** An example of the menu. */
export interface Example {
  /** Folder of the circuit in shared/fixtures/. */
  name: string;
  title: string;
  /** What it shows, in a few words (tooltip). */
  description: string;
}

/** The examples, in the order of the menu: from the simplest analysis to the hardest. */
export const EXAMPLES: Example[] = [
  {
    name: "divider_op",
    title: "Diviseur de tension (.op)",
    description: "Deux résistances : la tension de sortie et le courant, en un clic.",
  },
  {
    name: "rc_tran",
    title: "Circuit RC sur une impulsion (.tran)",
    description: "Le condensateur se charge puis se décharge en suivant une exponentielle.",
  },
  {
    name: "lowpass_ac",
    title: "Filtre passe-bas RC (.ac)",
    description: "Le gain baisse au-delà de la fréquence de coupure : diagramme de Bode.",
  },
  {
    name: "loaded_divider_dc",
    title: "Diviseur chargé (.dc)",
    description: "La tension de sortie quand la tension d'entrée varie de 0 à 10 V.",
  },
];

/** The document and the toolbar settings of an example, or null if its files are missing. */
export function exampleContent(
  name: string,
): { doc: EditorDoc; analysis: Partial<AnalysisSettings> } | null {
  const schematic = files[`../../../shared/fixtures/${name}/schematic.json`] as
    EditorDoc | undefined;
  const analysis = files[`../../../shared/fixtures/${name}/analysis.json`] as Analysis | undefined;
  if (!schematic || !analysis) return null;
  return { doc: fixtureDocument(schematic), analysis: analysisSettings(analysis) };
}
