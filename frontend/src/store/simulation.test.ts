import { describe, expect, it } from "vitest";

import schematic from "../../../shared/fixtures/divider_op/schematic.json";
import netlist from "../../../shared/fixtures/divider_op/netlist.json";
import {
  analysisSources,
  DC_DEFAULTS,
  dcRangeFor,
  formatSI,
  operatingPointLabels,
  operatingPointTable,
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
    const tran = { ...DEFAULT_ANALYSIS, kind: "tran", stopTime: "10m", maxStep: "" } as const;
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

describe("AC and DC analyses (#222)", () => {
  const sources = analysisSources(fixtureDoc("lowpass_ac"));
  const ac = { ...DEFAULT_ANALYSIS, kind: "ac" } as const;
  const dc = { ...DEFAULT_ANALYSIS, kind: "dc" } as const;

  it("lists the sources of the schematic", () => {
    expect(sources).toEqual([{ id: "c1", name: "V1", unit: "V" }]);
    expect(analysisSources(fixtureDoc("divider_op")).every((s) => s.unit === "V")).toBe(true);
  });

  it("builds an .ac analysis on the chosen source, or the first one", () => {
    const expected = {
      kind: "ac",
      input_source_id: "c1",
      start_frequency: 10,
      stop_frequency: 1e5,
      points_per_decade: 20,
    };
    expect(toAnalysis(ac, sources)).toEqual({ analysis: expected });
    // A source that was deleted since: the first one of the schematic.
    expect(toAnalysis({ ...ac, acSource: "gone" }, sources)).toEqual({ analysis: expected });
    expect(toAnalysis(ac, [])).toEqual({ error: expect.stringMatching(/source/) });
  });

  it("says what is wrong in the .ac settings", () => {
    const error = (patch: object) => toAnalysis({ ...ac, ...patch }, sources);
    expect(error({ acStart: "0" })).toEqual({ error: expect.stringMatching(/début/) });
    expect(error({ acStop: "x" })).toEqual({ error: expect.stringMatching(/fin/) });
    expect(error({ acStart: "1k", acStop: "100" })).toEqual({
      error: expect.stringMatching(/plus grande/),
    });
    expect(error({ acPoints: "2.5" })).toEqual({ error: expect.stringMatching(/Points/) });
    expect(error({ acPoints: "0" })).toEqual({ error: expect.stringMatching(/Points/) });
  });

  it("gives a current source a range in milliamperes, but keeps a range typed by the user", () => {
    expect(dcRangeFor(DC_DEFAULTS.V, "A")).toEqual(DC_DEFAULTS.A);
    expect(dcRangeFor(DC_DEFAULTS.A, "V")).toEqual(DC_DEFAULTS.V);
    expect(dcRangeFor(DC_DEFAULTS.V, "V")).toEqual({});
    expect(dcRangeFor({ ...DC_DEFAULTS.V, dcStop: "10" }, "A")).toEqual({});
  });

  it("builds a .dc sweep, or says what is wrong", () => {
    expect(toAnalysis(dc, sources)).toEqual({
      analysis: { kind: "dc", source_id: "c1", start: 0, stop: 5, step: 0.1 },
    });
    expect(toAnalysis({ ...dc, dcStart: "-5" }, sources)).toEqual({
      analysis: { kind: "dc", source_id: "c1", start: -5, stop: 5, step: 0.1 },
    });
    const error = (patch: object) => toAnalysis({ ...dc, ...patch }, sources);
    expect(toAnalysis(dc, [])).toEqual({ error: expect.stringMatching(/source/) });
    expect(error({ dcStart: "a" })).toEqual({ error: expect.stringMatching(/début/) });
    expect(error({ dcStop: "-1" })).toEqual({ error: expect.stringMatching(/plus grande/) });
    expect(error({ dcStep: "0" })).toEqual({ error: expect.stringMatching(/Pas/) });
    expect(error({ dcStep: "10" })).toEqual({ error: expect.stringMatching(/plus petit/) });
    expect(error({ dcStep: "1u" })).toEqual({ error: expect.stringMatching(/trop petit/) });
  });
});

describe("operating point on the schematic (#102)", () => {
  it("formats values with SI prefixes", () => {
    expect(formatSI(0.005, "A")).toBe("5 mA");
    expect(formatSI(10, "V")).toBe("10 V");
    expect(formatSI(-1.23456e-6, "A")).toBe("-1,23 µA");
    expect(formatSI(4700, "V")).toBe("4,7 kV");
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

describe("operating point table (#292)", () => {
  it("names the nodes after the schematic and gives the supplied current", () => {
    const doc = fixtureDoc("divider_op");
    const groups = operatingPointTable(doc, fixtureResult("divider_op"), netlist.nets);
    expect(groups.map((g) => [g.title, g.rows.map((r) => `${r.label} : ${r.value}`)])).toEqual([
      ["Potentiels des nœuds (par rapport à la masse)", ["in : 10 V", "out : 5 V"]],
      ["Courants", ["V1 fournit : 5 mA", "Courant dans R1 : 5 mA", "Courant dans R2 : 5 mA"]],
    ]);
    const rows = groups.flatMap((g) => g.rows);
    expect(rows.find((r) => r.label === "in")?.highlight).toEqual({ wire: "w1" });
    expect(rows.find((r) => r.label === "V1 fournit")?.highlight).toEqual({ component: "c1" });
  });

  it("shows nothing for another analysis", () => {
    expect(operatingPointTable(fixtureDoc("rc_tran"), fixtureResult("rc_tran"), {})).toEqual([]);
  });
});
