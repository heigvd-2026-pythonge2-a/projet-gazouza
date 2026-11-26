import { describe, expect, it } from "vitest";

import netlist from "../../../shared/fixtures/divider_op/netlist.json";
import type { SimulationResult } from "../api/client";
import { addComponent, emptyDoc, pinPosition, type EditorDoc, type GridPoint } from "./document";
import {
  currentArrows,
  pinPotentials,
  terminalVoltageRows,
  voltageArrows,
  voltageName,
} from "./operatingPoint";
import { operatingPointLabels } from "./simulation";
import { fixtureDoc, fixtureResult } from "./testFixtures";

const p = (x: number, y: number): GridPoint => ({ x, y });
/** A point 3 steps further from the x axis than `q`: where a wire from a pin at the top or bottom ends. */
const away = (q: GridPoint): GridPoint => p(q.x, q.y + 3 * Math.sign(q.y));

/** Direction of an arrow, as a unit step on the grid axes. */
const direction = (a: { from: GridPoint; to: GridPoint }) => ({
  x: Math.sign(a.to.x - a.from.x),
  y: Math.sign(a.to.y - a.from.y),
});

/** An .op result with these node voltages and component currents. */
function opResult(voltages: Record<string, number>, currents: Record<string, number> = {}) {
  return {
    analysis: "op",
    traces: [
      ...Object.entries(voltages).map(([net, v]) => ({
        name: `v(${net})`,
        kind: "voltage",
        unit: "V",
        net,
        values: [v],
      })),
      ...Object.entries(currents).map(([id, i]) => ({
        name: `i(${id})`,
        kind: "current",
        unit: "A",
        component_id: id,
        values: [i],
      })),
    ],
  } as SimulationResult;
}

describe("pinPotentials", () => {
  it("gives every pin the voltage of its node, 0 V on the ground", () => {
    const doc = fixtureDoc("divider_op");
    const v = pinPotentials(doc, fixtureResult("divider_op"), netlist.nets);
    // V1 (c1): + on "in", - on the ground; R1 (c2) between in and out.
    expect(v.get("c1/+")).toBe(10);
    expect(v.get("c1/-")).toBe(0);
    expect([v.get("c2/1"), v.get("c2/2")].sort()).toEqual([10, 5]);
  });
});

describe("currentArrows (#290)", () => {
  it("points the current the way it flows: into R1 from in, out of V1's + terminal", () => {
    const doc = fixtureDoc("divider_op");
    const arrows = currentArrows(doc, fixtureResult("divider_op"));
    expect(arrows.map((a) => a.label.text)).toEqual(["5 mA", "5 mA", "5 mA"]);
    const r1 = doc.components.find((c) => c.id === "c2")!;
    const v1 = doc.components.find((c) => c.id === "c1")!;
    const byId = new Map(arrows.map((a) => [a.key, a]));
    // A positive current enters the component at its first pin.
    const r1Arrow = byId.get("i:c2")!;
    const intoR1 = pinPosition(r1, "2");
    const r1From = pinPosition(r1, "1");
    expect(direction(r1Arrow)).toEqual({
      x: Math.sign(intoR1.x - r1From.x),
      y: Math.sign(intoR1.y - r1From.y),
    });
    // V1 supplies: SPICE counts its current negative, the arrow leaves its + terminal.
    const v1Arrow = byId.get("i:c1")!;
    const plus = pinPosition(v1, "+");
    const minus = pinPosition(v1, "-");
    expect(direction(v1Arrow)).toEqual({
      x: Math.sign(plus.x - minus.x),
      y: Math.sign(plus.y - minus.y),
    });
  });

  it("shows nothing for another analysis", () => {
    expect(currentArrows(fixtureDoc("rc_tran"), fixtureResult("rc_tran"))).toEqual([]);
  });
});

describe("voltageArrows (#290)", () => {
  it("shows the voltage across a component only in detail, against the current in R1", () => {
    const doc = fixtureDoc("divider_op");
    const result = fixtureResult("divider_op");
    expect(voltageArrows(doc, result, netlist.nets)).toEqual([]);
    const [u] = voltageArrows(doc, result, netlist.nets, new Set(["c2"]));
    expect(u?.label.text).toBe("5 V");
    const i = currentArrows(doc, result).find((a) => a.key === "i:c2")!;
    // Receiver convention: the voltage arrow points the other way.
    const d = direction(i);
    expect(direction(u!)).toEqual({ x: -d.x || 0, y: -d.y || 0 });
  });

  /** A transistor (Q1) at the origin, base on the left, nodes c, b and e on its pins. */
  function transistor(type = "npn"): { doc: EditorDoc; nets: Record<string, string[]> } {
    let doc = addComponent(emptyDoc(), {
      type,
      position: p(0, 0),
      rotation: 0,
      mirror: false,
    }).doc;
    const q = doc.components[0]!;
    doc = {
      ...doc,
      wires: [
        { id: "wc", from: { comp: q.id, pin: "C" }, to: away(pinPosition(q, "C")), points: [] },
        { id: "wb", from: { comp: q.id, pin: "B" }, to: p(-5, 0), points: [] },
        { id: "we", from: { comp: q.id, pin: "E" }, to: away(pinPosition(q, "E")), points: [] },
      ],
    };
    return { doc, nets: { c: ["wc"], b: ["wb"], e: ["we"] } };
  }

  it("always shows V_CE of a transistor, pointing at the collector, away from the base", () => {
    const { doc, nets } = transistor();
    const result = opResult({ c: 5, b: 0.7, e: 0 });
    const arrows = voltageArrows(doc, result, nets);
    expect(arrows).toHaveLength(1);
    const [vce] = arrows;
    expect(vce?.label.text).toBe("V_CE = 5 V");
    expect(direction(vce!)).toEqual({ x: 0, y: -1 });
    // C and E are on x = 1, the base on the left: the arrow is on the right.
    expect(vce!.from.x).toBeGreaterThan(1);
    expect(vce?.label.side).toBe("right");
    // V_BE in detail.
    const detail = voltageArrows(doc, result, nets, new Set([doc.components[0]!.id]));
    expect(detail.map((a) => a.label.text)).toEqual(["V_CE = 5 V", "V_BE = 700 mV"]);
  });

  it("names a PNP's voltages emitter first, so their values stay positive", () => {
    const { doc, nets } = transistor("pnp");
    const result = opResult({ c: 0, b: 4.3, e: 5 });
    const arrows = voltageArrows(doc, result, nets, new Set([doc.components[0]!.id]));
    expect(arrows.map((a) => a.label.text)).toEqual(["V_EC = 5 V", "V_EB = 700 mV"]);
    // The arrow points at the emitter, the more positive pin (at the top of a PNP).
    const q = doc.components[0]!;
    const e = pinPosition(q, "E");
    const c = pinPosition(q, "C");
    expect(direction(arrows[0]!)).toEqual({ x: Math.sign(e.x - c.x), y: Math.sign(e.y - c.y) });
    expect(voltageName("C", "E", -1)).toBe("V_EC");
    expect(voltageName("C", "E", 0)).toBe("V_CE");
  });

  it("gives the voltages across the transistors for the table", () => {
    const { doc, nets } = transistor();
    const rows = terminalVoltageRows(doc, opResult({ c: 5, b: 0.7, e: 0 }), nets);
    const q = doc.components[0]!;
    expect(rows.map((r) => [r.label, r.value, r.highlight])).toEqual([
      [`V_CE de ${q.name}`, "5 V", { component: q.id }],
      [`V_BE de ${q.name}`, "700 mV", { component: q.id }],
    ]);
    expect(terminalVoltageRows(doc, fixtureResult("rc_tran"), nets)).toEqual([]);
  });

  it("shows nothing when a potential is unknown", () => {
    const { doc, nets } = transistor();
    expect(voltageArrows(doc, opResult({ c: 5 }), nets)).toEqual([]);
  });
});

describe("potential of a node without wire (#290)", () => {
  it("is written next to a pin of the node", () => {
    const place = (doc: EditorDoc, y: number) =>
      addComponent(doc, { type: "resistor", position: p(0, y), rotation: 0, mirror: false });
    const r1 = place(emptyDoc(), 0);
    const doc = place(r1.doc, 4).doc;
    // The netlist names the contact wire joining both resistors (added when sending).
    const labels = operatingPointLabels(doc, opResult({ mid: 2.5 }), { mid: ["w1"] });
    expect(labels).toEqual([
      { key: "v:mid", kind: "voltage", text: "2,5 V", position: p(0, 2), side: "right" },
    ]);
  });
});
