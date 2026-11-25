// What the errors and warnings of a simulation point at on the schematic (#253): the backend
// names the elements in `Diagnostic.targets` (a component, a pin, a wire, a junction or a SPICE
// node); this finds them in the document, to highlight them and point a bubble at them.

import type { SimulationResult } from "../api/client";
import {
  componentBox,
  partPath,
  pinPosition,
  type EditorDoc,
  type GridPoint,
  type GridRect,
} from "./document";
import { getDef } from "./library";
import { componentProblems } from "./values";

type Diagnostic = NonNullable<SimulationResult["errors"]>[number];
type Target = NonNullable<Diagnostic["targets"]>[number];

/** One error or warning of a simulation, with the elements of the schematic it points at. */
export interface DiagnosticMark {
  /** "error:2" for `result.errors[2]`, "warning:0" for `result.warnings[0]`. */
  key: string;
  level: "error" | "warning";
  message: string;
  /** Wires to highlight: those named, and those of the nodes named. */
  wires: string[];
  components: string[];
  junctions: string[];
  /** Pins named, in grid units. */
  pins: GridPoint[];
  /** Where its bubble points, in grid units: below the first element found. */
  anchor: GridPoint;
  /** Smallest rectangle holding every element found, to show them all. */
  bounds: GridRect;
}

/** True if a target of the result is a SPICE node: then `nets` is needed to find its wires. */
export function namesNets(result: SimulationResult): boolean {
  return [...(result.errors ?? []), ...(result.warnings ?? [])].some((d) =>
    (d.targets ?? []).some((t) => "net" in t),
  );
}

/** Middle of the longest segment of a wire: where a bubble or a value is easiest to read. */
export function wireMiddle(doc: EditorDoc, wireId: string): GridPoint | null {
  const wire = doc.wires.find((w) => w.id === wireId);
  if (!wire) return null;
  const path = partPath(doc, wire);
  let best: [GridPoint, GridPoint] | null = null;
  let bestLength = -1;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i] as GridPoint;
    const b = path[i + 1] as GridPoint;
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (length > bestLength) {
      best = [a, b];
      bestLength = length;
    }
  }
  return best ? { x: (best[0].x + best[1].x) / 2, y: (best[0].y + best[1].y) / 2 } : null;
}

/** The pin's position, or null if the component or the pin is not in the document. */
function pinAt(doc: EditorDoc, comp: string, pin: string): GridPoint | null {
  const c = doc.components.find((x) => x.id === comp);
  if (!c || !getDef(c.type).pins.some((p) => p.name === pin)) return null;
  return pinPosition(c, pin);
}

/** Space between a point and the tip of the bubble's arrow, in grid units. */
const POINT_GAP = 0.4;

/**
 * The errors, then the warnings, of a simulation result that point at elements of `doc`, with
 * those elements (`nets`, from the netlist, gives the wires of each node). Diagnostics with no
 * element found are left out (their message is only in the results panel), and so are those
 * that only point at components whose values are already shown as wrong next to them.
 */
export function diagnosticMarks(
  doc: EditorDoc,
  result: SimulationResult,
  nets: Record<string, string[]>,
): DiagnosticMark[] {
  const shownProblems = new Set(componentProblems(doc).map((p) => p.comp));
  const diagnostics = [
    ...(result.errors ?? []).map((d, index) => ({ d, index, level: "error" as const })),
    ...(result.warnings ?? []).map((d, index) => ({ d, index, level: "warning" as const })),
  ];
  const marks: DiagnosticMark[] = [];
  diagnostics.forEach(({ d, index, level }) => {
    const targets: Target[] = d.targets ?? [];
    if (
      targets.length > 0 &&
      targets.every((t) => "comp" in t && !("pin" in t) && shownProblems.has(t.comp))
    ) {
      return;
    }
    const wires = new Set<string>();
    const components = new Set<string>();
    const junctions = new Set<string>();
    const pins: GridPoint[] = [];
    /** Points of every element found, for `bounds`. */
    const points: GridPoint[] = [];
    let anchor: GridPoint | null = null;
    const addWire = (id: string) => {
      const wire = doc.wires.find((w) => w.id === id);
      if (!wire || wires.has(id)) return;
      wires.add(id);
      points.push(...partPath(doc, wire));
      const middle = wireMiddle(doc, id);
      if (!anchor && middle) anchor = { x: middle.x, y: middle.y + POINT_GAP };
    };
    for (const t of targets) {
      if ("net" in t) {
        for (const id of nets[t.net] ?? []) addWire(id);
      } else if ("wire" in t) {
        addWire(t.wire);
      } else if ("junction" in t) {
        const j = doc.junctions.find((x) => x.id === t.junction);
        if (!j) continue;
        junctions.add(j.id);
        points.push(j.position);
        anchor ??= { x: j.position.x, y: j.position.y + POINT_GAP };
      } else if ("pin" in t) {
        const p = pinAt(doc, t.comp, t.pin);
        if (!p) continue;
        pins.push(p);
        points.push(p);
        anchor ??= { x: p.x, y: p.y + POINT_GAP };
      } else {
        const c = doc.components.find((x) => x.id === t.comp);
        if (!c) continue;
        components.add(c.id);
        const box = componentBox(c);
        points.push(box.min, box.max);
        anchor ??= { x: (box.min.x + box.max.x) / 2, y: box.max.y + POINT_GAP };
      }
    }
    if (!anchor || points.length === 0) return;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    marks.push({
      key: `${level}:${index}`,
      level,
      message: d.message,
      wires: [...wires],
      components: [...components],
      junctions: [...junctions],
      pins,
      anchor,
      bounds: {
        min: { x: Math.min(...xs), y: Math.min(...ys) },
        max: { x: Math.max(...xs), y: Math.max(...ys) },
      },
    });
  });
  return marks;
}
