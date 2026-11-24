// Answers of the online demo (`vite build --mode demo`, shown on the website): there is no
// backend there, so the client asks this module instead of calling fetch. Everything comes from
// shared/fixtures/: the component library (kept equal to the real GET /api/library by a backend
// test), and the reference circuits with their netlist and their real ngspice result, given back
// when one of them is simulated as it is. Only imported in demo mode, so the fixtures are not
// bundled in the app.
import library from "../../../shared/fixtures/library.json";
import type { SimulationRequest } from "./client";

/** Message shown when the demo is asked for something only the real backend can do. */
export const DEMO_UNAVAILABLE =
  "La démo en ligne ne simule que les circuits d'exemple, tels quels : installez Psice pour " +
  "simuler les vôtres.";

const files = import.meta.glob<unknown>(
  "../../../shared/fixtures/*/{schematic,analysis,result,netlist}.json",
  { eager: true, import: "default" },
);

interface Example {
  request: SimulationRequest;
  result: unknown;
  netlist: unknown;
}

/** The reference circuits: what is sent to simulate them, and the backend's answers. */
const examples: Example[] = [...new Set(Object.keys(files).map((k) => k.split("/").at(-2)))].map(
  (name) => {
    const file = (kind: string) => files[`../../../shared/fixtures/${name}/${kind}.json`];
    return {
      request: { schematic: file("schematic"), analysis: file("analysis") } as SimulationRequest,
      result: file("result"),
      netlist: file("netlist"),
    };
  },
);

type Schematic = SimulationRequest["schematic"];
type WireEnd = NonNullable<Schematic["wires"]>[number]["from"];

/**
 * What makes the circuit, whatever its drawing: each component with its values, and each node as
 * the set of pins it links. Positions, rotations, bends and ids of wires and junctions are left out.
 */
function circuitKey(schematic: Schematic): string {
  const parts = (schematic.components ?? [])
    .map((c) => JSON.stringify([c.id, c.type, c.name ?? null, sortedEntries(c.params ?? {})]))
    .sort();

  // Union-find over the wire ends: pins ("p:comp:pin") and junctions ("j:id") of each wire join.
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(k, root);
    return root;
  };
  const key = (end: WireEnd, wire: string, side: string): string =>
    "comp" in end
      ? `p:${end.comp}:${end.pin}`
      : "junction" in end
        ? `j:${end.junction}`
        : `f:${wire}:${side}`;
  for (const w of schematic.wires ?? []) {
    const a = find(key(w.from, w.id, "from"));
    const b = find(key(w.to, w.id, "to"));
    parent.set(a, b);
  }
  const nodes = new Map<string, string[]>();
  for (const k of parent.keys()) {
    if (!k.startsWith("p:")) continue;
    const root = find(k);
    nodes.set(root, [...(nodes.get(root) ?? []), k]);
  }
  const nets = [...nodes.values()].map((pins) => pins.sort().join(",")).sort();
  return JSON.stringify([parts, nets]);
}

const sortedEntries = (o: object) => Object.entries(o).sort(([a], [b]) => a.localeCompare(b));

/** Same analysis: same kind and settings, numbers equal up to rounding. */
function sameAnalysis(a: object, b: object): boolean {
  const ea = sortedEntries(a);
  const eb = sortedEntries(b);
  return (
    ea.length === eb.length &&
    ea.every(([k, v], i) => {
      const [kb, vb] = eb[i] ?? [];
      if (k !== kb) return false;
      if (typeof v === "number" && typeof vb === "number") {
        return Math.abs(v - vb) <= 1e-9 * Math.max(Math.abs(v), Math.abs(vb));
      }
      return v === vb;
    })
  );
}

/** The reference circuit that this request simulates, if any. */
function example(body: unknown): Example | undefined {
  const request = body as SimulationRequest | undefined;
  if (!request?.schematic || !request.analysis) return undefined;
  const circuit = circuitKey(request.schematic);
  return examples.find(
    (e) =>
      sameAnalysis(e.request.analysis, request.analysis) &&
      circuitKey(e.request.schematic) === circuit,
  );
}

/** The demo's answer to `method path` with this JSON body, or `undefined` when it has none. */
export function demoAnswer(method: string, path: string, body?: unknown): unknown {
  if (method === "GET" && path === "/api/health") return { status: "démo" };
  if (method === "GET" && path === "/api/library") return library;
  if (method === "POST" && path === "/api/simulate") return example(body)?.result;
  if (method === "POST" && path === "/api/netlist") return example(body)?.netlist;
  return undefined;
}
