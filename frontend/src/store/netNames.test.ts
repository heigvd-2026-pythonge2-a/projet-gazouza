import { beforeEach, describe, expect, it } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { addComponent, emptyDoc, pinPosition, type EditorDoc, type GridPoint } from "./document";
import { describeNet, describeNode, GROUND_NAME, netItem } from "./netNames";
import { nodeIndex, type NodeItem } from "./nodes";

const p = (x: number, y: number): GridPoint => ({ x, y });

beforeEach(resetEditorStore);

/** Draws a wire with the wire tool through `points`. */
function wire(...points: GridPoint[]) {
  editorState().startWiring();
  for (const point of points) editorState().wireClick(point);
  editorState().setTool({ kind: "select" });
}

/** Name of the node of `item` in the current document. */
function nameOf(item: NodeItem): string | null {
  const doc = editorState().doc;
  const node = nodeIndex(doc)(item);
  return node && describeNode(doc, node);
}

describe("describeNode", () => {
  it("uses the name of a node label on the node", () => {
    const r1 = dropComponent("resistor", p(0, 0));
    const label = dropComponent("label", p(0, -2));
    editorState().setParam(label.id, "net", " out ");
    expect(nameOf({ comp: r1.id, pin: "1" })).toBe("out");
  });

  it("calls the ground node Masse", () => {
    const r1 = dropComponent("resistor", p(0, 0));
    dropComponent("ground", p(0, 2));
    expect(nameOf({ comp: r1.id, pin: "2" })).toBe(GROUND_NAME);
  });

  it("prefers a transistor pin, then a source terminal", () => {
    const q1 = dropComponent("npn", p(0, 0));
    const v1 = dropComponent("voltage_source", p(-8, 0));
    const base = pinPosition(
      editorState().doc.components.find((c) => c.id === q1.id)!,
      "B",
    );
    const plus = pinPosition(
      editorState().doc.components.find((c) => c.id === v1.id)!,
      "+",
    );
    wire(plus, p(plus.x, base.y), base);
    expect(nameOf({ comp: v1.id, pin: "+" })).toBe(`Base de ${q1.name}`);
    expect(nameOf({ comp: v1.id, pin: "-" })).toBe(`Borne − de ${v1.name}`);
  });

  it("names a node of passive components after the first two it joins", () => {
    const r1 = dropComponent("resistor", p(0, 0));
    const c1 = dropComponent("capacitor", p(4, 0));
    wire(p(0, 2), p(4, 2));
    expect(nameOf({ comp: c1.id, pin: "2" })).toBe(`Entre ${r1.name} et ${c1.name}`);
    expect(nameOf({ comp: r1.id, pin: "1" })).toBe(`Borne 1 de ${r1.name}`);
  });
});

describe("describeNet", () => {
  it("finds the node from the wires the netlist lists for it", () => {
    const r1 = dropComponent("resistor", p(0, 0));
    const c1 = dropComponent("capacitor", p(4, 0));
    wire(p(0, 2), p(4, 2));
    const w = editorState().doc.wires[0]!;
    expect(describeNet(editorState().doc, "n1", [w.id])).toEqual({
      name: `Entre ${r1.name} et ${c1.name}`,
      item: { wire: w.id },
    });
  });

  it("finds a node made only of a contact wire through its pins", () => {
    // Two resistors pin against pin, in a document not tidied yet (an opened file): the contact
    // wire joining them is only added when sending it.
    const place = (doc: EditorDoc, y: number) =>
      addComponent(doc, { type: "resistor", position: p(0, y), rotation: 0, mirror: false });
    const r1 = place(emptyDoc(), 0);
    const doc = place(r1.doc, 4).doc;
    const item = netItem(doc, ["w1"]);
    expect(item).toEqual({ comp: r1.id, pin: "2" });
    expect(describeNet(doc, "n2", ["w1"]).name).toBe("Entre R1 et R2");
  });

  it("falls back on the netlist name when the node is not found", () => {
    expect(describeNet(editorState().doc, "n7", ["w42"])).toEqual({ name: "Nœud n7", item: null });
    expect(describeNet(editorState().doc, "0").name).toBe(GROUND_NAME);
  });
});
