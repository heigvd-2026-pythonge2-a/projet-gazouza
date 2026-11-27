// Direction of the node labels on "Automatique", from the circuit (#295).

import { beforeEach, describe, expect, it } from "vitest";

import { resetEditorStore } from "../test/editorStore";
import type { EditorDoc, EditorWire, PlacedComponent } from "./document";
import { autoLabelDirections } from "./labelDirections";
import { getDef, LABEL_FLAGS, symbolOf } from "./library";

beforeEach(resetEditorStore);

/** A component far from the others (its pins touch nothing), with the given parameters. */
function part(id: string, type: string, x: number, params: Record<string, string> = {}) {
  return {
    id,
    type,
    position: { x: x * 10, y: 0 },
    rotation: 0,
    mirror: false,
    params,
  } satisfies PlacedComponent;
}

/** A node label named `net`, automatic unless `direction` is given. */
const label = (id: string, x: number, net: string, direction = "auto") =>
  part(id, "label", x, { net, direction });

/** A wire between two pins, given as "component.pin". */
function wire(id: string, a: string, b: string): EditorWire {
  const end = (s: string) => {
    const [comp, pin] = s.split(".") as [string, string];
    return { comp, pin };
  };
  return { id, from: end(a), to: end(b), points: [] };
}

const doc = (components: PlacedComponent[], wires: EditorWire[]): EditorDoc => ({
  components,
  wires,
  junctions: [],
  texts: [],
});

/**
 * A generator V1 on label "in" (L1), and label `net` (L2) on a resistor to ground: the example of
 * the issue, generator -> in ... in -> filter.
 */
function generatorAndFilter(net = "in", l1 = label("L1", 1, "in"), l2 = label("L2", 2, net)) {
  return doc(
    [
      part("V1", "voltage_source", 0),
      part("G1", "ground", 3),
      l1,
      l2,
      part("R1", "resistor", 4),
      part("G2", "ground", 5),
    ],
    [
      wire("w1", "V1.+", "L1.1"),
      wire("w2", "V1.-", "G1.1"),
      wire("w3", "L2.1", "R1.1"),
      wire("w4", "R1.2", "G2.1"),
    ],
  );
}

describe("autoLabelDirections", () => {
  it("makes the label at the generator an output and the other one an input", () => {
    const directions = autoLabelDirections(generatorAndFilter());
    expect(directions.get("L1")).toBe("output");
    expect(directions.get("L2")).toBe("input");
  });

  it("compares names without case, as the backend does", () => {
    const directions = autoLabelDirections(generatorAndFilter(" IN "));
    expect(directions.get("L2")).toBe("input");
  });

  it("gives no direction to a label without a partner, or when nothing produces the signal", () => {
    const renamed = autoLabelDirections(generatorAndFilter("out"));
    expect(renamed.get("L1")).toBe("none");
    expect(renamed.get("L2")).toBe("none");

    const passive = doc(
      [part("R1", "resistor", 0), label("L1", 1, "x"), label("L2", 2, "x")],
      [wire("w1", "R1.1", "L1.1"), wire("w2", "R1.2", "L2.1")],
    );
    expect(autoLabelDirections(passive).get("L1")).toBe("none");
  });

  it("is bidirectional when two pieces of the same name produce the signal", () => {
    const twoSources = doc(
      [
        part("V1", "voltage_source", 0),
        part("V2", "voltage_source", 1),
        part("G1", "ground", 2),
        label("L1", 3, "bus"),
        label("L2", 4, "bus"),
        label("L3", 5, "bus"),
        part("R1", "resistor", 6),
      ],
      [
        wire("w1", "V1.+", "L1.1"),
        wire("w2", "V2.+", "L2.1"),
        wire("w3", "V1.-", "G1.1"),
        wire("w4", "V2.-", "G1.1"),
        wire("w5", "L3.1", "R1.1"),
      ],
    );
    const directions = autoLabelDirections(twoSources);
    expect(directions.get("L1")).toBe("bidir");
    expect(directions.get("L2")).toBe("bidir");
    expect(directions.get("L3")).toBe("input");
  });

  it("does not take the ground for a signal", () => {
    // Labels on the grounded terminal of the source: the ground produces nothing.
    const grounded = doc(
      [
        part("V1", "voltage_source", 0),
        part("G1", "ground", 1),
        label("L1", 2, "ref"),
        label("L2", 3, "ref"),
        part("R1", "resistor", 4),
      ],
      [wire("w1", "V1.-", "G1.1"), wire("w2", "V1.-", "L1.1"), wire("w3", "L2.1", "R1.1")],
    );
    expect(autoLabelDirections(grounded).get("L1")).toBe("none");
  });

  it("makes the output of an op-amp produce the signal", () => {
    // A follower drawn with labels: the output comes back to the inverting input.
    const follower = doc(
      [part("U1", "opamp", 0), label("L1", 1, "vout"), label("L2", 2, "vout")],
      [wire("w1", "U1.out", "L1.1"), wire("w2", "U1.-", "L2.1")],
    );
    expect(autoLabelDirections(follower).get("L1")).toBe("output");
    expect(autoLabelDirections(follower).get("L2")).toBe("input");
  });

  it("needs a partner on another piece: two labels on the same wire have no direction", () => {
    const same = doc(
      [part("V1", "voltage_source", 0), label("L1", 1, "a"), label("L2", 2, "a")],
      [wire("w1", "V1.+", "L1.1"), wire("w2", "L1.1", "L2.1")],
    );
    expect(autoLabelDirections(same).get("L1")).toBe("none");
  });

  it("never overrides a direction chosen by hand, which still counts as a partner", () => {
    const directions = autoLabelDirections(
      generatorAndFilter("in", label("L1", 1, "in", "input"), label("L2", 2, "in")),
    );
    expect(directions.has("L1")).toBe(false);
    expect(directions.get("L2")).toBe("input");
    // A file saved before directions existed has none: it keeps its drawing.
    const old = generatorAndFilter();
    const withoutDirection = {
      ...old,
      components: old.components.map((c) => (c.id === "L1" ? { ...c, params: { net: "in" } } : c)),
    };
    expect(autoLabelDirections(withoutDirection).has("L1")).toBe(false);
  });

  it("follows the circuit: a new document is worked out again", () => {
    const first = generatorAndFilter();
    const unplugged = { ...first, wires: first.wires.filter((w) => w.id !== "w1") };
    expect(autoLabelDirections(first).get("L2")).toBe("input");
    expect(autoLabelDirections(unplugged).get("L2")).toBe("none");
    expect(autoLabelDirections(first)).toBe(autoLabelDirections(first));
  });
});

describe("symbolOf for an automatic label", () => {
  it("draws the direction worked out, or no direction until there is one", () => {
    const def = getDef("label");
    expect(symbolOf(def, { net: "in", direction: "auto" }, "output")).toBe(LABEL_FLAGS.output);
    expect(symbolOf(def, { net: "in", direction: "auto" })).toBe(LABEL_FLAGS.none);
    expect(symbolOf(def, { net: "in", direction: "input" }, "output")).toBe(LABEL_FLAGS.input);
  });
});
