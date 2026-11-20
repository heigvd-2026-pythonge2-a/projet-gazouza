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

/** One application of Kirchhoff's current law: at `node`, `edge` is the only unknown current. */
interface FlowStep {
  edge: FlowEdge;
  node: string;
  /** Every edge that meets at `node`, `edge` included. */
  incident: readonly FlowEdge[];
}

/**
 * Order in which the currents of a network are deduced, given which components have a known
 * current. It only depends on the network, not on the values: an animation computes it once and
 * then only replays the additions with `applyFlowPlan` on every frame.
 */
export interface FlowPlan {
  /** Edges whose current is given. */
  known: readonly string[];
  /** Wires with both ends at the same point: they carry nothing worth showing. */
  zero: readonly string[];
  steps: readonly FlowStep[];
}

/**
 * Plans the deduction of the currents of `edges` when those of `knownIds` are given. Kirchhoff's
 * current law is applied again and again at each node where a single current is unknown. In a
 * loop made only of wires the split is unknown: those wires are left out.
 */
export function flowPlan(edges: readonly FlowEdge[], knownIds: ReadonlySet<string>): FlowPlan {
  const known: string[] = [];
  const zero: string[] = [];
  const solved = new Set<string>();
  for (const e of edges) {
    if (knownIds.has(e.id)) known.push(e.id);
    else if (e.from === e.to) zero.push(e.id);
    else continue;
    solved.add(e.id);
  }
  const byNode = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    for (const n of [e.from, e.to]) {
      const list = byNode.get(n);
      if (list) list.push(e);
      else byNode.set(n, [e]);
    }
  }
  const steps: FlowStep[] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const [node, incident] of byNode) {
      const unknown = incident.filter((e) => !solved.has(e.id));
      const e = unknown[0];
      if (!e || unknown.length > 1) continue;
      steps.push({ edge: e, node, incident });
      solved.add(e.id);
      changed = true;
    }
  }
  return { known, zero, steps };
}

/** Currents of the edges `plan` determines, from those of the components (id -> A). */
export function applyFlowPlan(
  plan: FlowPlan,
  known: ReadonlyMap<string, number>,
): Map<string, number> {
  const values = new Map<string, number>();
  for (const id of plan.known) values.set(id, known.get(id) ?? 0);
  for (const id of plan.zero) values.set(id, 0);
  for (const { edge, node, incident } of plan.steps) {
    // Current flowing into the node through the known edges.
    let inflow = 0;
    for (const k of incident) {
      if (k === edge) continue;
      const v = values.get(k.id) as number;
      if (k.to === node) inflow += v;
      if (k.from === node) inflow -= v;
    }
    // The unknown edge must take it away: out of the node if it starts there.
    values.set(edge.id, edge.from === node ? inflow : -inflow);
  }
  return values;
}

/**
 * Current of every edge that `known` (component id -> current, in A) determines (see
 * `flowPlan`). To solve the same network many times, keep the plan instead.
 */
export function solveFlows(
  edges: readonly FlowEdge[],
  known: ReadonlyMap<string, number>,
): Map<string, number> {
  return applyFlowPlan(flowPlan(edges, new Set(known.keys())), known);
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
  // Index of the last sample at or before t (binary search: called on every animation frame),
  // and how far t is towards the next one.
  let i = 0;
  let hi = times.length - 1;
  while (i < hi) {
    const mid = (i + hi + 1) >> 1;
    if ((times[mid] as number) <= t) i = mid;
    else hi = mid - 1;
  }
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
