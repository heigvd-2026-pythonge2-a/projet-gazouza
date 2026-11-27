import { describe, expect, it } from "vitest";

import type { SimulationResult } from "../api/client";
import netlist from "../../../shared/fixtures/divider_op/netlist.json";
import { componentBox, partPath, pinPosition } from "./document";
import { diagnosticMarks, namesNets, wireMiddle } from "./diagnostics";
import { fixtureDoc } from "./testFixtures";

const failed = (
  errors: NonNullable<SimulationResult["errors"]>,
  warnings: NonNullable<SimulationResult["warnings"]> = [],
): SimulationResult => ({ analysis: "op", traces: [], errors, warnings }) as SimulationResult;

const floating = (net: string) => ({
  code: "SINGULAR_MATRIX" as const,
  message: `Matrice singulière : le nœud « ${net} » est flottant.`,
  targets: [{ net }],
});

describe("namesNets", () => {
  it("is true only when an error or a warning points at a node", () => {
    expect(namesNets(failed([floating("out")]))).toBe(true);
    expect(namesNets(failed([], [floating("out")]))).toBe(true);
    expect(
      namesNets(failed([{ code: "VOLTAGE_SOURCE_LOOP", message: "x", targets: [{ comp: "c1" }] }])),
    ).toBe(false);
    expect(namesNets(failed([{ code: "SIMULATION_FAILED", message: "x" }]))).toBe(false);
  });
});

describe("diagnosticMarks", () => {
  const doc = fixtureDoc("divider_op");

  it("highlights the wires of a floating node, with a bubble on one of them", () => {
    const [mark, ...rest] = diagnosticMarks(doc, failed([floating("out")]), netlist.nets);
    expect(rest).toEqual([]);
    expect(mark).toMatchObject({
      level: "error",
      wires: ["w2", "w6", "w8"],
      components: [],
      pins: [],
    });
    expect(mark!.message).toMatch(/« out »/);
    // The bubble points just below the middle of the node's first wire.
    const middle = wireMiddle(doc, "w2")!;
    expect(mark!.anchor.x).toBe(middle.x);
    expect(mark!.anchor.y).toBeGreaterThan(middle.y);
    // Every wire of the node is inside the rectangle to show.
    for (const id of ["w2", "w6", "w8"]) {
      for (const p of partPath(
        doc,
        doc.wires.find((w) => w.id === id)!,
      )) {
        expect(p.x).toBeGreaterThanOrEqual(mark!.bounds.min.x);
        expect(p.x).toBeLessThanOrEqual(mark!.bounds.max.x);
        expect(p.y).toBeGreaterThanOrEqual(mark!.bounds.min.y);
        expect(p.y).toBeLessThanOrEqual(mark!.bounds.max.y);
      }
    }
  });

  it("highlights components, pins, wires and junctions, errors before warnings", () => {
    const docWithJunction = {
      ...doc,
      junctions: [...doc.junctions, { id: "j9", position: { x: 20, y: 20 } }],
    };
    const result = failed(
      [
        {
          code: "VOLTAGE_SOURCE_LOOP",
          message: "Boucle",
          targets: [{ comp: "c1" }, { comp: "c2" }],
        },
      ],
      [
        { code: "PIN_NOT_CONNECTED", message: "Broche", targets: [{ comp: "c3", pin: "1" }] },
        { code: "WIRE_DANGLING", message: "Fil", targets: [{ wire: "w1" }] },
        { code: "JUNCTION_DANGLING", message: "Jonction", targets: [{ junction: "j9" }] },
      ],
    );
    const marks = diagnosticMarks(docWithJunction, result, {});
    expect(marks.map((m) => [m.key, m.message])).toEqual([
      ["error:0", "Boucle"],
      ["warning:0", "Broche"],
      ["warning:1", "Fil"],
      ["warning:2", "Jonction"],
    ]);
    const [loop, pin, wire, junction] = marks;
    expect(loop!.components).toEqual(["c1", "c2"]);
    // Below the first component's symbol.
    const box = componentBox(doc.components[0]!);
    expect(loop!.anchor).toEqual({ x: (box.min.x + box.max.x) / 2, y: box.max.y + 0.4 });
    const p = pinPosition(
      doc.components.find((c) => c.id === "c3")!,
      "1",
    );
    expect(pin!.pins).toEqual([p]);
    expect(pin!.bounds).toEqual({ min: p, max: p });
    expect(wire!.wires).toEqual(["w1"]);
    expect(junction!.junctions).toEqual(["j9"]);
    expect(junction!.anchor).toEqual({ x: 20, y: 20.4 });
  });

  it("leaves out what points at nothing in the schematic", () => {
    const result = failed([
      // A node the netlist does not know, or one without wires.
      floating("n7"),
      floating("lonely"),
      { code: "SIMULATION_FAILED", message: "Échec" },
      {
        code: "NO_CONVERGENCE",
        message: "x",
        targets: [{ comp: "gone" }, { comp: "c1", pin: "nope" }, { wire: "w99" }],
      },
      { code: "JUNCTION_DANGLING", message: "x", targets: [{ junction: "j99" }] },
    ]);
    expect(diagnosticMarks(doc, result, { lonely: [] })).toEqual([]);
  });

  it("skips components whose wrong value is already shown next to them", () => {
    const wrong = {
      ...doc,
      components: doc.components.map((c) =>
        c.id === "c2" ? { ...c, params: { ...c.params, resistance: "1kk" } } : c,
      ),
    };
    const result = failed([
      { code: "BAD_VALUE", message: "R1 : valeur", targets: [{ comp: "c2" }] },
      { code: "PIN_NOT_CONNECTED", message: "Broche", targets: [{ comp: "c2", pin: "1" }] },
    ]);
    expect(diagnosticMarks(wrong, result, {}).map((m) => m.message)).toEqual(["Broche"]);
    // Not when the value is right.
    expect(diagnosticMarks(doc, result, {})).toHaveLength(2);
  });
});
