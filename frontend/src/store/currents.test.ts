import { describe, expect, it } from "vitest";

import type { SimulationResult } from "../api/client";
import {
  MAX_DOT_SPEED,
  MIN_DOT_SPEED,
  animatable,
  applyFlowPlan,
  componentCurrents,
  dotSpeed,
  flowNetwork,
  flowPlan,
  maxCurrent,
  peakFlows,
  solveFlows,
  timeSpan,
  type FlowEdge,
} from "./currents";
import { addComponent, emptyDoc, type PlacedComponent } from "./document";
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

  it("shows nothing on a zero-length wire", () => {
    const flows = solveFlows([edge("w0", "c", "c")], new Map());
    expect(flows.get("w0")).toBe(0);
  });

  it("sends the current the shortest way round a loop made only of wires (#258)", () => {
    // R: a -> b (2 A). From b back to a, two ways: a short wire b -> c, and a long detour b -> c.
    const p = (x: number, y: number) => ({ x, y });
    const edges: FlowEdge[] = [
      { ...edge("R", "a", "b"), kind: "component" },
      { ...edge("short", "b", "c"), path: [p(0, 0), p(2, 0)] },
      { ...edge("detour", "c", "b"), path: [p(2, 0), p(2, 3), p(0, 3), p(0, 0)] },
      { ...edge("back", "c", "a"), path: [p(2, 0), p(5, 0)] },
    ];
    const flows = solveFlows(edges, new Map([["R", 2]]));
    expect(flows.get("detour")).toBe(0);
    expect(flows.get("short")).toBe(2);
    expect(flows.get("back")).toBe(2);
    for (const node of ["a", "b", "c"]) expect(netInflow(edges, flows, node)).toBe(0);
  });

  it("solves every wire, even with several loops of wires and links", () => {
    // Two grounds (links to net:0) also joined by a wire, and a square of four wires.
    const edges: FlowEdge[] = [
      { ...edge("V", "g1", "top"), kind: "component" },
      { ...edge("R", "top", "g2"), kind: "component" },
      { ...edge("G1", "g1", "net:0"), kind: "link" },
      { ...edge("G2", "g2", "net:0"), kind: "link" },
      edge("wg", "g1", "g2"),
      edge("s1", "top", "x"),
      edge("s2", "x", "y"),
      edge("s3", "y", "z"),
      edge("s4", "z", "top"),
    ];
    const flows = solveFlows(
      edges,
      new Map([
        ["V", 1],
        ["R", 1],
      ]),
    );
    expect(edges.every((e) => flows.has(e.id))).toBe(true);
    for (const node of ["g1", "g2", "top", "x", "y", "z", "net:0"]) {
      expect(netInflow(edges, flows, node)).toBeCloseTo(0);
    }
  });

  it("animates both ends of a resistor joined to the ground by two ways of wires", () => {
    // V1 (0,0) and R1 (4,0) in a loop; R1's pin 2 goes to V1's pin - straight along y = 2, and
    // once more through a detour down to y = 5.
    let doc = addComponent(emptyDoc(), {
      type: "voltage_source",
      position: { x: 0, y: 0 },
      rotation: 0,
      mirror: false,
    }).doc;
    doc = addComponent(doc, {
      type: "resistor",
      position: { x: 4, y: 0 },
      rotation: 0,
      mirror: false,
    }).doc;
    const [v1, r1] = doc.components as [PlacedComponent, PlacedComponent];
    doc = {
      ...doc,
      wires: [
        { id: "w1", from: { comp: v1.id, pin: "+" }, to: { comp: r1.id, pin: "1" }, points: [] },
        { id: "w2", from: { comp: r1.id, pin: "2" }, to: { comp: v1.id, pin: "-" }, points: [] },
        {
          id: "w3",
          from: { comp: r1.id, pin: "2" },
          to: { comp: v1.id, pin: "-" },
          points: [
            { x: 4, y: 5 },
            { x: 0, y: 5 },
          ],
        },
      ],
    };
    const flows = solveFlows(
      flowNetwork(doc),
      new Map([
        [v1.id, -0.005],
        [r1.id, 0.005],
      ]),
    );
    expect(flows.get("w2")).toBeCloseTo(0.005);
    expect(flows.get("w3")).toBe(0);
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

describe("dotSpeed (#341)", () => {
  it("operating point: no dots for a zero current, a minimum speed for a small one", () => {
    expect(dotSpeed(0, 1, false)).toBeNull();
    expect(dotSpeed(1e-6, 1, false)).toBeNull();
    expect(dotSpeed(0.01, 1, false)).toBe(MIN_DOT_SPEED);
    expect(dotSpeed(-1, 1, false)).toBe(MAX_DOT_SPEED);
    expect(dotSpeed(undefined, 1, false)).toBeNull();
    expect(dotSpeed(1, 0, false)).toBeNull();
  });

  it("transient: slows down to a stop, without losing its dots, where a current flowed", () => {
    expect(dotSpeed(0.5, 1, true, 1)).toBe(MAX_DOT_SPEED / 2);
    expect(dotSpeed(0.01, 1, true, 1)).toBeCloseTo(MAX_DOT_SPEED / 100);
    expect(dotSpeed(0, 1, true, 1)).toBe(0);
    // A conductor that never carries a current has no dots.
    expect(dotSpeed(0, 1, true, 0)).toBeNull();
    expect(dotSpeed(0, 1, true)).toBeNull();
  });
});

describe("the dots of a half-wave rectifier (#341)", () => {
  it("stop in the diode while it blocks, instead of disappearing", () => {
    const doc = fixtureDoc("half_wave_rectifier");
    const result = fixtureResult("half_wave_rectifier");
    const edges = flowNetwork(doc);
    const plan = flowPlan(edges, new Set(componentCurrents(result).keys()));
    const peaks = peakFlows(plan, result);
    const imax = maxCurrent(result);
    const diode = doc.components.find((c) => c.type === "diode")!;
    expect(peaks.get(diode.id)).toBeGreaterThan(imax / 2);

    // At some sample the diode blocks: its dots are still there, and (almost) still.
    const speeds = (result.axis?.values ?? []).map((t) =>
      dotSpeed(
        applyFlowPlan(plan, componentCurrents(result, t)).get(diode.id),
        imax,
        true,
        peaks.get(diode.id),
      ),
    );
    expect(speeds.every((v) => v !== null)).toBe(true);
    expect(Math.min(...(speeds as number[]))).toBeLessThan(MIN_DOT_SPEED / 10);
    expect(Math.max(...(speeds as number[]))).toBeGreaterThan(MAX_DOT_SPEED / 2);
  });
});
