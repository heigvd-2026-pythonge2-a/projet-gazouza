import { beforeEach, describe, expect, it } from "vitest";

import { editorState, resetEditorStore } from "../test/editorStore";
import { useEditorStore } from "./editorStore";
import {
  keptProbes,
  PROBE_GROUND,
  PROBE_NEW_ITEM,
  PROBE_NO_SIMULATION,
  PROBE_NO_TRACE,
  probeFor,
  toggleProbe,
} from "./probes";
import { fixtureDoc, fixtureResult } from "./testFixtures";

// rc_tran: V1 (c1) -> R1 (c2) -> C1 (c3); node "in" = w1, w5; "out" = w2, w6; ground = w3, w4.
const NETS = { in: ["w1", "w5"], out: ["w2", "w6"], "0": ["w3", "w4"] };
const simulation = () => ({
  result: fixtureResult("rc_tran"),
  doc: fixtureDoc("rc_tran"),
  nets: NETS,
});

describe("probeFor (#105)", () => {
  it("gives the voltage of the node of a wire, the current of a component", () => {
    expect(probeFor(simulation(), { wire: "w6" })).toEqual({
      probe: { trace: "v(out)", kind: "voltage", at: { wire: "w6" } },
    });
    expect(probeFor(simulation(), { component: "c2" })).toEqual({
      probe: { trace: "i(R1)", kind: "current", at: { component: "c2" } },
    });
  });

  it("says why there is nothing to probe", () => {
    expect(probeFor(null, { wire: "w1" })).toEqual({ error: PROBE_NO_SIMULATION });
    expect(probeFor(simulation(), { wire: "w3" })).toEqual({ error: PROBE_GROUND });
    // Drawn after the simulation: not in its nodes, not in its document.
    expect(probeFor(simulation(), { wire: "w99" })).toEqual({ error: PROBE_NEW_ITEM });
    expect(probeFor(simulation(), { component: "c99" })).toEqual({ error: PROBE_NEW_ITEM });
    const noTraces = { ...simulation(), result: { ...fixtureResult("rc_tran"), traces: [] } };
    expect(probeFor(noTraces, { wire: "w1" })).toEqual({ error: PROBE_NO_TRACE });
    expect(probeFor(noTraces, { component: "c1" })).toEqual({ error: PROBE_NO_TRACE });
  });
});

describe("toggleProbe (#105)", () => {
  it("adds a probe, and removes it with a click on any wire of the same node", () => {
    const first = toggleProbe([], simulation(), { wire: "w2" });
    if (!("probes" in first)) throw new Error(first.error);
    expect(first.probes.map((p) => p.trace)).toEqual(["v(out)"]);
    const second = toggleProbe(first.probes, simulation(), { component: "c1" });
    if (!("probes" in second)) throw new Error(second.error);
    expect(second.probes.map((p) => p.trace)).toEqual(["v(out)", "i(V1)"]);
    expect(toggleProbe(second.probes, simulation(), { wire: "w6" })).toEqual({
      probes: [second.probes[1]],
    });
  });
});

describe("keptProbes (#105)", () => {
  const probes = [
    { trace: "v(out)", kind: "voltage", at: { wire: "w2" } },
    { trace: "v(gone)", kind: "voltage", at: { wire: "w7" } },
  ] as const;

  it("keeps the probes whose trace is still in the new result", () => {
    expect(keptProbes(probes, fixtureResult("rc_tran"))).toEqual([probes[0]]);
  });

  it("keeps them all after a simulation that gave no trace", () => {
    expect(keptProbes(probes, { ...fixtureResult("rc_tran"), traces: [] })).toEqual(probes);
    expect(keptProbes(probes, null)).toEqual(probes);
  });
});

describe("the probe tool in the store (#105)", () => {
  beforeEach(resetEditorStore);

  const simulate = () => {
    const doc = fixtureDoc("rc_tran");
    useEditorStore.setState({ doc });
    editorState().setSimulation(fixtureResult("rc_tran"), NETS);
  };

  it("probes only with the probe tool", () => {
    simulate();
    editorState().probeAt({ wire: "w1" });
    expect(editorState().probes).toEqual([]);
    editorState().startProbe();
    expect(editorState().tool).toEqual({ kind: "probe" });
    editorState().probeAt({ wire: "w1" });
    expect(editorState().probes.map((p) => p.trace)).toEqual(["v(in)"]);
    editorState().cancel();
    expect(editorState().tool).toEqual({ kind: "select" });
    expect(editorState().probes.map((p) => p.trace)).toEqual(["v(in)"]);
  });

  it("says in the status bar why a click probes nothing", () => {
    editorState().startProbe();
    editorState().probeAt({ wire: "w1" });
    expect(editorState().notice).toBe(PROBE_NO_SIMULATION);
    simulate();
    editorState().probeAt({ wire: "w1" });
    expect(editorState().notice).toBeNull();
  });

  it("keeps the probes through a new simulation, forgets them with another document", () => {
    simulate();
    editorState().startProbe();
    editorState().probeAt({ component: "c3" });
    simulate();
    expect(editorState().probes.map((p) => p.trace)).toEqual(["i(C1)"]);
    editorState().clearProbes();
    expect(editorState().probes).toEqual([]);
    editorState().probeAt({ component: "c3" });
    expect(editorState().probes).toHaveLength(1);
    editorState().newDocument();
    expect(editorState().probes).toEqual([]);
  });
});
