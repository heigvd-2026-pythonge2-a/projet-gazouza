// Test helper: the circuits of shared/fixtures/ as editor documents, with their results, and the
// component library as GET /api/library serves it.

import type { LibraryComponent, SimulationResult } from "../api/client";
import library from "../../../shared/fixtures/library.json";
import type { EditorDoc, EditorWire } from "./document";

const files = import.meta.glob<unknown>("../../../shared/fixtures/*/{schematic,result}.json", {
  eager: true,
  import: "default",
});

const file = (name: string, kind: "schematic" | "result"): unknown => {
  const data = files[`../../../shared/fixtures/${name}/${kind}.json`];
  if (data === undefined) throw new Error(`No fixture ${name}/${kind}.json`);
  return data;
};

/** Names of the fixture circuits (e.g. "divider_op"). */
export const fixtureNames = (): string[] =>
  [...new Set(Object.keys(files).map((k) => k.split("/").at(-2) ?? ""))].sort();

/** The fixture's schematic as an editor document (bends are optional in the contract). */
export function fixtureDoc(name: string): EditorDoc {
  const s = structuredClone(file(name, "schematic")) as EditorDoc;
  return {
    components: s.components,
    junctions: s.junctions,
    wires: s.wires.map((w: EditorWire) => ({ ...w, points: w.points ?? [] })),
  };
}

export const fixtureResult = (name: string): SimulationResult =>
  file(name, "result") as SimulationResult;

/** The answer of GET /api/library (shared/fixtures/library.json). */
export const fixtureLibrary = (): LibraryComponent[] =>
  structuredClone(library) as LibraryComponent[];
