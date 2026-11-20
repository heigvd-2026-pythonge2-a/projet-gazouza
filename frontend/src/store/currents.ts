// Currents to animate on the schematic, from a simulation result: the current of each component
// (given by the simulator) and of each wire (deduced with Kirchhoff's current law).

import type { SimulationResult } from "../api/client";
import { pinPosition, wirePath, type EditorDoc, type GridPoint } from "./document";
import { getDef } from "./library";

/**
 * Something current flows through, from node `from` to node `to`. A positive current flows
 * from `from` to `to`, along `path` (grid units).
 * - "component": a two-pin component, from its first pin (SPICE n+) to its second;
 * - "wire": a wire, from its `from` end to its `to` end;
 * - "link": an invisible connection by name: a ground to the ground net, a label to its net.
 */
export interface FlowEdge {
  id: string;
  kind: "component" | "wire" | "link";
  from: string;
  to: string;
  path: GridPoint[];
}

/** Wires and pins meet at grid points: a node is a grid position (or a named net). */
const nodeAt = (p: GridPoint) => `${p.x},${p.y}`;

/** The conductors of `doc` and how they are connected. */
export function flowNetwork(doc: EditorDoc): FlowEdge[] {
  const edges: FlowEdge[] = [];
  for (const c of doc.components) {
    const pins = getDef(c.type).pins;
    const [first, second] = pins;
    if (pins.length === 2 && first && second) {
      const a = pinPosition(c, first.name);
      const b = pinPosition(c, second.name);
      edges.push({ id: c.id, kind: "component", from: nodeAt(a), to: nodeAt(b), path: [a, b] });
    } else if (first && (c.type === "ground" || c.type === "label")) {
      const net = c.type === "ground" ? "0" : (c.params.net ?? "");
      const p = pinPosition(c, first.name);
      edges.push({ id: c.id, kind: "link", from: nodeAt(p), to: `net:${net}`, path: [] });
    }
  }
  for (const w of doc.wires) {
    const path = wirePath(doc, w);
    const a = path[0];
    const b = path[path.length - 1];
    if (a && b) edges.push({ id: w.id, kind: "wire", from: nodeAt(a), to: nodeAt(b), path });
  }
  return edges;
}

/**
 * Current of every edge that `known` (component id -> current, in A) determines. Kirchhoff's
 * current law is applied again and again at each node where a single current is unknown. In a
 * loop made only of wires the split is unknown: those wires are left out of the result.
 */
export function solveFlows(
  edges: readonly FlowEdge[],
  known: ReadonlyMap<string, number>,
): Map<string, number> {
  const values = new Map<string, number>();
  for (const e of edges) {
    const v = known.get(e.id);
    if (v !== undefined) values.set(e.id, v);
    // A wire with both ends at the same point carries nothing worth showing.
    else if (e.from === e.to) values.set(e.id, 0);
  }
  const byNode = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    for (const n of [e.from, e.to]) byNode.set(n, [...(byNode.get(n) ?? []), e]);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const [node, incident] of byNode) {
      const unknown = incident.filter((e) => !values.has(e.id));
      const e = unknown[0];
      if (!e || unknown.length > 1) continue;
      // Current flowing into the node through the known edges.
      let inflow = 0;
      for (const k of incident) {
        if (k === e) continue;
        const v = values.get(k.id) as number;
        if (k.to === node) inflow += v;
        if (k.from === node) inflow -= v;
      }
      // The unknown edge must take it away: out of the node if it starts there.
      values.set(e.id, e.from === node ? inflow : -inflow);
      changed = true;
    }
  }
  return values;
}

/** Analyses whose currents can be animated: a steady state, or currents that vary with time. */
export const animatable = (r: SimulationResult): boolean =>
  r.analysis === "op" || (r.analysis === "tran" && r.axis !== null && r.axis !== undefined);

/** Simulated time span of a transient result, in seconds ([0, 0] for an operating point). */
export function timeSpan(r: SimulationResult): [number, number] {
  const t = r.axis?.values ?? [];
  return [t[0] ?? 0, t[t.length - 1] ?? 0];
}

/** Current of each component (id -> A) at time `t` (linear interpolation between samples). */
export function componentCurrents(r: SimulationResult, t = 0): Map<string, number> {
  const times = r.axis?.values ?? [];
  // Index of the last sample at or before t, and how far t is towards the next one.
  let i = 0;
  while (i + 1 < times.length && (times[i + 1] as number) <= t) i++;
  const t0 = times[i] ?? 0;
  const t1 = times[i + 1];
  const f = t1 !== undefined && t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  const out = new Map<string, number>();
  for (const trace of r.traces ?? []) {
    if (trace.kind !== "current" || !trace.component_id) continue;
    const a = trace.values[i] ?? 0;
    const b = trace.values[i + 1] ?? a;
    out.set(trace.component_id, a + (b - a) * f);
  }
  return out;
}

/** Largest current magnitude of the result, over all components and times (A). */
export function maxCurrent(r: SimulationResult): number {
  let max = 0;
  for (const trace of r.traces ?? []) {
    if (trace.kind !== "current") continue;
    for (const v of trace.values) max = Math.max(max, Math.abs(v));
  }
  return max;
}
