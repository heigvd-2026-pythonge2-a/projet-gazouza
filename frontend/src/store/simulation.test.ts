import { describe, expect, it } from "vitest";

import schematic from "../../../shared/fixtures/divider_op/schematic.json";
import netlist from "../../../shared/fixtures/divider_op/netlist.json";
import {
  formatSI,
  operatingPointLabels,
  parseSpiceNumber,
  toAnalysis,
  toSchematic,
  DEFAULT_ANALYSIS,
} from "./simulation";
import { fixtureDoc, fixtureNames, fixtureResult } from "./testFixtures";

describe("toSchematic", () => {
  it("gives back the contract schematic of every fixture", () => {
    for (const name of fixtureNames()) {
      const s = toSchematic(fixtureDoc(name));
      expect(s.version).toBe(2);
      expect(s.components?.length, name).toBeGreaterThan(0);
    }
    const s = toSchematic(fixtureDoc("divider_op"));
    expect(s.components).toEqual(schematic.components);
    expect(s.junctions).toEqual(schematic.junctions);
    expect(s.wires?.map((w) => [w.id, w.from, w.to])).toEqual(
      schematic.wires.map((w) => [w.id, w.from, w.to]),
    );
  });
});

describe("analysis settings", () => {
  it("reads SPICE numbers, a time possibly ending with s", () => {
    expect(parseSpiceNumber("10m")).toBeCloseTo(0.01);
    expect(parseSpiceNumber("2ms")).toBeCloseTo(0.002);
    expect(parseSpiceNumber("1.5u")).toBeCloseTo(1.5e-6);
    expect(parseSpiceNumber("1Meg")).toBe(1e6);
    expect(parseSpiceNumber("abc")).toBeNull();
    expect(parseSpiceNumber("")).toBeNull();
  });

  it("builds the analysis of the request, or says what is wrong", () => {
    expect(toAnalysis(DEFAULT_ANALYSIS)).toEqual({ analysis: { kind: "op" } });
    const tran = { kind: "tran", stopTime: "10m", maxStep: "" } as const;
    expect(toAnalysis(tran)).toEqual({ analysis: { kind: "tran", stop_time: 0.01 } });
    expect(toAnalysis({ ...tran, maxStep: "10u" })).toEqual({
      analysis: { kind: "tran", stop_time: 0.01, max_step: 1e-5 },
    });
    expect(toAnalysis({ ...tran, stopTime: "0" })).toEqual({
      error: expect.stringMatching(/Durée/),
    });
    expect(toAnalysis({ ...tran, maxStep: "x" })).toEqual({ error: expect.stringMatching(/Pas/) });
    expect(toAnalysis({ ...tran, maxStep: "1" })).toEqual({
      error: expect.stringMatching(/plus petit/),
    });
  });
});

describe("operating point on the schematic (#102)", () => {
  it("formats values with SI prefixes", () => {
    expect(formatSI(0.005, "A")).toBe("5 mA");
    expect(formatSI(10, "V")).toBe("10 V");
    expect(formatSI(-1.23456e-6, "A")).toBe("-1.23 µA");
    expect(formatSI(4700, "V")).toBe("4.7 kV");
    expect(formatSI(0, "V")).toBe("0 V");
  });

  it("labels the voltage divider of the fixtures with the right values", () => {
    const doc = fixtureDoc("divider_op");
    const labels = operatingPointLabels(doc, fixtureResult("divider_op"), netlist.nets);
    const byKey = Object.fromEntries(labels.map((l) => [l.key, l.text]));
    expect(byKey).toEqual({
      "v:in": "10 V",
      "v:out": "5 V",
      "i:c1": "5 mA",
      "i:c2": "5 mA",
      "i:c3": "5 mA",
    });
    // A voltage is placed on one of the node's wires.
    const vin = labels.find((l) => l.key === "v:in")!;
    expect(vin.side).toMatch(/above|right/);
  });

  it("labels nothing for another analysis", () => {
    const doc = fixtureDoc("rc_tran");
    expect(operatingPointLabels(doc, fixtureResult("rc_tran"), {})).toEqual([]);
  });
});
