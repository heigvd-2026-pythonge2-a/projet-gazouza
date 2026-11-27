import { describe, expect, it } from "vitest";

import type { EditorDoc, PlacedComponent } from "./document";
import { nodeIndex, type CircuitNode } from "./nodes";

/** A component at (x, y), unturned. Resistor pins: 1 at (x, y-2), 2 at (x, y+2). */
const comp = (
  id: string,
  type: string,
  x: number,
  y: number,
  params: Record<string, string> = {},
): PlacedComponent => ({ id, type, position: { x, y }, rotation: 0, mirror: false, params });

const pins = (node: CircuitNode | null) =>
  (node?.pins ?? []).map((p) => `${p.comp}/${p.pin}`).sort();
const wires = (node: CircuitNode | null) => [...(node?.wires ?? [])].sort();

describe("nodeIndex", () => {
  it("follows the wires through a junction, to every pin of the node", () => {
    // R1 and R2 side by side, their top pins joined through junction j1 by w1 and w2; w3 goes on
    // to R3's top pin.
    const doc: EditorDoc = {
      components: [
        comp("R1", "resistor", 0, 0),
        comp("R2", "resistor", 4, 0),
        comp("R3", "resistor", 8, 0),
      ],
      junctions: [{ id: "j1", position: { x: 2, y: -2 } }],
      texts: [],
      wires: [
        { id: "w1", from: { comp: "R1", pin: "1" }, to: { junction: "j1" }, points: [] },
        { id: "w2", from: { junction: "j1" }, to: { comp: "R2", pin: "1" }, points: [] },
        { id: "w3", from: { comp: "R2", pin: "1" }, to: { comp: "R3", pin: "1" }, points: [] },
        { id: "w4", from: { comp: "R1", pin: "2" }, to: { comp: "R2", pin: "2" }, points: [] },
      ],
    };
    const node = nodeIndex(doc)({ wire: "w1" });
    expect(wires(node)).toEqual(["w1", "w2", "w3"]);
    expect(pins(node)).toEqual(["R1/1", "R2/1", "R3/1"]);
    expect(nodeIndex(doc)({ comp: "R3", pin: "1" })).toBe(node);
    expect(wires(nodeIndex(doc)({ comp: "R2", pin: "2" }))).toEqual(["w4"]);
  });

  it("keeps two wires crossing without a junction apart", () => {
    const doc: EditorDoc = {
      components: [
        comp("R1", "resistor", 0, 2),
        comp("R2", "resistor", 4, 2),
        comp("R3", "resistor", 2, -4),
        comp("R4", "resistor", 2, 8),
      ],
      junctions: [],
      texts: [],
      wires: [
        // Horizontal from R1/1 (0,0) to R2/1 (4,0), vertical from R3/2 (2,-2) to R4/1 (2,6).
        { id: "h", from: { comp: "R1", pin: "1" }, to: { comp: "R2", pin: "1" }, points: [] },
        { id: "v", from: { comp: "R3", pin: "2" }, to: { comp: "R4", pin: "1" }, points: [] },
      ],
    };
    const index = nodeIndex(doc);
    expect(wires(index({ wire: "h" }))).toEqual(["h"]);
    expect(wires(index({ wire: "v" }))).toEqual(["v"]);
  });

  it("joins pins that touch directly, without a wire (#256)", () => {
    // R2 stands on R1: R1/2 and R2/1 are both at (0, 2).
    const doc: EditorDoc = {
      components: [
        comp("R1", "resistor", 0, 0),
        comp("R2", "resistor", 0, 4),
        comp("R3", "resistor", 4, 4),
      ],
      junctions: [],
      texts: [],
      wires: [
        { id: "w1", from: { comp: "R2", pin: "2" }, to: { comp: "R3", pin: "2" }, points: [] },
      ],
    };
    const index = nodeIndex(doc);
    expect(pins(index({ comp: "R1", pin: "2" }))).toEqual(["R1/2", "R2/1"]);
    // The contact wire the normalization adds is not on screen: no wire to highlight.
    expect(wires(index({ comp: "R1", pin: "2" }))).toEqual([]);
    expect(pins(index({ wire: "w1" }))).toEqual(["R2/2", "R3/2"]);
  });

  it("joins every ground, and the labels of the same name", () => {
    const doc: EditorDoc = {
      components: [
        comp("G1", "ground", 0, 10),
        comp("G2", "ground", 20, 10),
        comp("L1", "label", 0, -10, { net: "out" }),
        comp("L2", "label", 20, -10, { net: "OUT " }),
        comp("L3", "label", 40, -10, { net: "in" }),
      ],
      junctions: [],
      texts: [],
      wires: [],
    };
    const index = nodeIndex(doc);
    expect(pins(index({ comp: "G1", pin: "1" }))).toEqual(["G1/1", "G2/1"]);
    expect(pins(index({ comp: "L1", pin: "1" }))).toEqual(["L1/1", "L2/1"]);
    expect(pins(index({ comp: "L3", pin: "1" }))).toEqual(["L3/1"]);
  });

  it("computes a document once, and knows nothing of unknown items", () => {
    const doc: EditorDoc = {
      components: [comp("R1", "resistor", 0, 0)],
      junctions: [],
      wires: [],
      texts: [],
    };
    expect(nodeIndex(doc)).toBe(nodeIndex(doc));
    expect(nodeIndex(doc)({ wire: "nope" })).toBeNull();
    expect(nodeIndex(doc)({ comp: "R1", pin: "9" })).toBeNull();
    expect(nodeIndex(doc)({ comp: "R9", pin: "1" })).toBeNull();
  });
});
