import { describe, expect, it } from "vitest";

import type { SimulationResult } from "../api/client";
import {
  animatable,
  componentCurrents,
  flowNetwork,
  maxCurrent,
  solveFlows,
  timeSpan,
  type FlowEdge,
} from "./currents";
import { fixtureDoc, fixtureNames, fixtureResult } from "./testFixtures";

const edge = (id: string, from: string, to: string): FlowEdge => ({
  id,
  kind: "wire",
  from,
  to,
  path: [],
});

/** Sum of the currents entering `node` minus those leaving it. */
function netInflow(edges: readonly FlowEdge[], flows: ReadonlyMap<string, number>, node: string) {
  let sum = 0;
  for (const e of edges) {
    const v = flows.get(e.id);
    if (v === undefined) continue;
    if (e.to === node) sum += v;
    if (e.from === node) sum -= v;
  }
  return sum;
}

describe("solveFlows", () => {
  it("carries a known current along a chain, whatever the wire directions", () => {
    // R: a -> b (2 A), wires b -> c and d -> c (reversed), then d -> a closes the loop.
    const edges: FlowEdge[] = [
      { ...edge("R", "a", "b"), kind: "component" },
      edge("w1", "b", "c"),
      edge("w2", "d", "c"),
      edge("w3", "d", "a"),
    ];
    const flows = solveFlows(edges, new Map([["R", 2]]));
    expect(flows.get("w1")).toBe(2);
    expect(flows.get("w2")).toBe(-2);
    expect(flows.get("w3")).toBe(2);
  });

  it("splits at a node when the other branches are known", () => {
    const edges: FlowEdge[] = [
      { ...edge("A", "x", "n"), kind: "component" },
      { ...edge("B", "n", "y"), kind: "component" },
      edge("w", "n", "z"),
    ];
    const flows = solveFlows(
      edges,
      new Map([
        ["A", 3],
        ["B", 1],
      ]),
    );
    expect(flows.get("w")).toBeCloseTo(2);
  });

  it("leaves out a loop made only of wires, and shows nothing on a zero-length wire", () => {
    const edges = [edge("w1", "a", "b"), edge("w2", "b", "a"), edge("w0", "c", "c")];
    const flows = solveFlows(edges, new Map());
    expect(flows.has("w1")).toBe(false);
    expect(flows.has("w2")).toBe(false);
    expect(flows.get("w0")).toBe(0);
  });

  it.each(fixtureNames())("respects Kirchhoff's current law on the %s fixture", (name) => {
    const doc = fixtureDoc(name);
    const result = fixtureResult(name);
    const edges = flowNetwork(doc);
    const flows = solveFlows(edges, componentCurrents(result));
    const nodes = new Set(edges.flatMap((e) => [e.from, e.to]));
    for (const node of nodes) {
      const incident = edges.filter((e) => e.from === node || e.to === node);
      if (incident.some((e) => !flows.has(e.id))) continue;
      expect(Math.abs(netInflow(edges, flows, node)), `node ${node}`).toBeLessThan(1e-12);
    }
  });
});

describe("componentCurrents", () => {
  const result = {
    analysis: "tran",
    axis: { name: "time", unit: "s", values: [0, 1, 2, 4] },
    traces: [
      { name: "i(R1)", kind: "current", unit: "A", component_id: "c1", values: [0, 10, 20, 0] },
      { name: "v(out)", kind: "voltage", unit: "V", net: "out", values: [1, 2, 3, 4] },
    ],
  } as unknown as SimulationResult;

  it("interpolates linearly between samples", () => {
    expect(componentCurrents(result, 0).get("c1")).toBe(0);
    expect(componentCurrents(result, 0.5).get("c1")).toBe(5);
    expect(componentCurrents(result, 1).get("c1")).toBe(10);
    expect(componentCurrents(result, 3).get("c1")).toBe(10);
  });

  it("holds the first and last values outside the time span", () => {
    expect(componentCurrents(result, -1).get("c1")).toBe(0);
    expect(componentCurrents(result, 10).get("c1")).toBe(0);
  });

  it("only keeps the currents of components", () => {
    expect([...componentCurrents(result).keys()]).toEqual(["c1"]);
  });

  it("gives the span, the largest current and whether it can be animated", () => {
    expect(timeSpan(result)).toEqual([0, 4]);
    expect(maxCurrent(result)).toBe(20);
    expect(animatable(result)).toBe(true);
    expect(animatable({ ...result, analysis: "ac" } as SimulationResult)).toBe(false);
  });
});
