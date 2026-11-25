import { describe, expect, it } from "vitest";

import { fixtureLibrary, fixtureNames } from "../store/testFixtures";
import type { SimulationRequest } from "./client";
import { demoAnswer } from "./demoBackend";

const files = import.meta.glob<unknown>(
  "../../../shared/fixtures/*/{schematic,analysis,result,netlist}.json",
  { eager: true, import: "default" },
);
const file = (name: string, kind: string) =>
  structuredClone(files[`../../../shared/fixtures/${name}/${kind}.json`]);

/** A request whose schematic has all its fields (the fixtures do). */
type FullRequest = SimulationRequest & { schematic: Required<SimulationRequest["schematic"]> };

/** What the editor sends to simulate fixture `name` as it is. */
const requestOf = (name: string): FullRequest => ({
  schematic: file(name, "schematic") as FullRequest["schematic"],
  analysis: file(name, "analysis") as SimulationRequest["analysis"],
});

const simulate = (body: unknown) => demoAnswer("POST", "/api/simulate", body);

describe("demo backend", () => {
  it("answers health and the library", () => {
    expect(demoAnswer("GET", "/api/health")).toEqual({ status: "démo" });
    expect(demoAnswer("GET", "/api/library")).toEqual(fixtureLibrary());
  });

  it.each(fixtureNames())("gives back the result and the netlist of %s", (name) => {
    expect(simulate(requestOf(name))).toEqual(file(name, "result"));
    expect(demoAnswer("POST", "/api/netlist", requestOf(name))).toEqual(file(name, "netlist"));
  });

  it("still recognises an example that was only moved or redrawn", () => {
    const request = requestOf("rc_tran");
    for (const c of request.schematic.components) {
      c.position = { x: c.position.x + 3, y: c.position.y - 1 };
      c.rotation = 180;
    }
    request.schematic.wires = request.schematic.wires
      .map((w, i) => ({ ...w, id: `x${i}`, from: w.to, to: w.from, points: [] }))
      .reverse();
    expect(simulate(request)).toEqual(file("rc_tran", "result"));
  });

  it("does not answer for a changed value, analysis or wiring", () => {
    const value = requestOf("divider_op");
    const r1 = value.schematic.components.find((c) => c.name === "R1");
    r1!.params = { ...r1!.params, resistance: "2k" };
    expect(simulate(value)).toBeUndefined();

    const analysis = requestOf("rc_tran");
    analysis.analysis = { kind: "tran", stop_time: 0.006, max_step: 1e-5 };
    expect(simulate(analysis)).toBeUndefined();

    const wiring = requestOf("divider_op");
    wiring.schematic.wires.pop();
    expect(simulate(wiring)).toBeUndefined();
  });

  it("does not answer other requests", () => {
    expect(simulate(undefined)).toBeUndefined();
    expect(demoAnswer("GET", "/api/other")).toBeUndefined();
  });
});
