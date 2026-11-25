// What touches on the schematic is connected for the simulation (#255, #256): the backend only
// follows wire ends, so every point contact must become one.

import { beforeEach, describe, expect, it } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import {
  addComponent,
  emptyDoc,
  normalizeContacts,
  pinPosition,
  unconnectedPins,
  wirePath,
  type EditorDoc,
  type GridPoint,
} from "./document";
import { getDef } from "./library";
import { toSchematic } from "./simulation";

const p = (x: number, y: number): GridPoint => ({ x, y });

beforeEach(resetEditorStore);

/** Draws a wire with the wire tool through `points`; a repeated last point leaves it free. */
function wire(...points: [number, number][]) {
  editorState().startWiring();
  for (const [x, y] of points) editorState().wireClick(p(x, y));
  editorState().setTool({ kind: "select" });
}

/** Pins wired as the backend sees them: a wire end attached to them. */
function wiredPins(doc: EditorDoc): Set<string> {
  const schematic = toSchematic(doc);
  const wired = new Set<string>();
  for (const w of schematic.wires ?? []) {
    for (const end of [w.from, w.to]) if ("comp" in end) wired.add(`${end.comp}/${end.pin}`);
  }
  return wired;
}

/** Every pin of the document, as "comp/pin". */
const allPins = (doc: EditorDoc) =>
  doc.components.flatMap((c) => getDef(c.type).pins.map((pin) => `${c.id}/${pin.name}`));

/**
 * The free pins of the editor are exactly the pins with no wire end in what is sent to the
 * backend (`PIN_NOT_CONNECTED` there), and no point contact is left unconnected.
 */
function expectEditorAgreesWithBackend(doc: EditorDoc) {
  const wired = wiredPins(doc);
  const free = unconnectedPins(doc).map((u) => `${u.comp}/${u.pin}`);
  expect(free.sort()).toEqual(
    allPins(doc)
      .filter((pin) => !wired.has(pin))
      .sort(),
  );
  expect(normalizeContacts(doc)).toBe(doc);
}

describe("point contacts become connections (#256)", () => {
  /** R1 (0,0) and R2 (4,0), their pins 2 joined by a wire along y = 2. */
  function twoResistors() {
    const r1 = dropComponent("resistor", p(0, 0));
    const r2 = dropComponent("resistor", p(4, 0));
    wire([0, 2], [4, 2]);
    return { r1, r2 };
  }

  it("connects a pin dropped on a junction (#255)", () => {
    twoResistors();
    wire([2, 2], [2, 5], [2, 5]);
    const ground = dropComponent("ground", p(2, 2));
    const doc = editorState().doc;
    // The junction goes: its three wires are attached to the ground's pin instead.
    expect(doc.junctions).toEqual([]);
    const onGround = doc.wires.filter((w) =>
      [w.from, w.to].some((e) => "comp" in e && e.comp === ground.id),
    );
    expect(onGround).toHaveLength(3);
    expect(unconnectedPins(doc).map((u) => u.comp)).not.toContain(ground.id);
    expectEditorAgreesWithBackend(doc);
  });

  it("connects a ground or a label dropped against a pin", () => {
    const { r2 } = twoResistors();
    const ground = dropComponent("ground", p(4, 2));
    const r1 = editorState().doc.components[0]!;
    const label = dropComponent("label", pinPosition(r1, "1"));
    const doc = editorState().doc;
    const joins = (a: string, b: string) =>
      doc.wires.some((w) =>
        [w.from, w.to].every((e) => "comp" in e && (e.comp === a || e.comp === b)),
      );
    expect(joins(ground.id, r2.id)).toBe(true);
    expect(joins(label.id, r1.id)).toBe(true);
    expect(unconnectedPins(doc).map((u) => u.comp)).not.toContain(label.id);
    expectEditorAgreesWithBackend(doc);
  });

  it("keeps two components connected when moved until their pins touch", () => {
    twoResistors();
    const r3 = dropComponent("resistor", p(8, 4));
    wire([8, 2], [6, 2], [4, 2]);
    editorState().select([r3.id]);
    editorState().moveSelection(p(-4, 0));
    const doc = editorState().doc;
    expect(unconnectedPins(doc).map((u) => `${u.comp}/${u.pin}`)).not.toContain(`${r3.id}/1`);
    expectEditorAgreesWithBackend(doc);
  });

  it("attaches the wire end left on a pin when the component holding it is deleted", () => {
    const ra = dropComponent("resistor", p(0, 0));
    const rb = dropComponent("resistor", p(0, 4));
    wire([0, 2], [4, 2], [4, 2]);
    editorState().select([ra.id]);
    editorState().deleteSelection();
    const doc = editorState().doc;
    expect(doc.wires).toHaveLength(1);
    expect(doc.wires[0]!.from).toEqual({ comp: rb.id, pin: "1" });
    expectEditorAgreesWithBackend(doc);
  });

  it("connects labels against pins, without having to move them", () => {
    dropComponent("resistor", p(0, 0));
    dropComponent("resistor", p(6, 0));
    const l1 = dropComponent("label", p(0, -2));
    editorState().setParam(l1.id, "net", "out");
    const l2 = dropComponent("label", p(6, -2));
    editorState().setParam(l2.id, "net", "out");
    editorState().select([l2.id]);
    editorState().deleteSelection();
    const l3 = dropComponent("label", p(6, -2));
    editorState().setParam(l3.id, "net", "out");
    const doc = editorState().doc;
    expect(unconnectedPins(doc).map((u) => u.comp)).not.toContain(l1.id);
    expect(unconnectedPins(doc).map((u) => u.comp)).not.toContain(l3.id);
    expectEditorAgreesWithBackend(doc);
  });

  it("connects what touches in an opened file, without marking it changed", () => {
    let doc = addComponent(emptyDoc(), {
      type: "resistor",
      position: p(0, 0),
      rotation: 0,
      mirror: false,
    }).doc;
    doc = addComponent(doc, { type: "ground", position: p(0, 2), rotation: 0, mirror: false }).doc;
    editorState().openDocument(doc);
    const opened = editorState().doc;
    expect(opened.wires).toHaveLength(1);
    expect(editorState().savedDoc).toBe(opened);
    expectEditorAgreesWithBackend(opened);
  });
});

describe("normalizeContacts", () => {
  const resistor = (doc: EditorDoc, x: number, y: number) =>
    addComponent(doc, { type: "resistor", position: p(x, y), rotation: 0, mirror: false });

  it("returns the document itself when everything that touches is connected", () => {
    const a = resistor(emptyDoc(), 0, 0);
    const b = resistor(a.doc, 4, 0);
    const doc: EditorDoc = {
      ...b.doc,
      wires: [
        { id: "w1", from: { comp: a.id, pin: "2" }, to: { comp: b.id, pin: "2" }, points: [] },
      ],
    };
    expect(normalizeContacts(doc)).toBe(doc);
    // Once normalized, a document stays the same.
    const touching = resistor(a.doc, 0, 4).doc;
    const once = normalizeContacts(touching);
    expect(once).not.toBe(touching);
    expect(normalizeContacts(once)).toBe(once);
  });

  it("merges two junctions at the same point, and attaches free ends lying on one", () => {
    const a = resistor(emptyDoc(), 0, 0);
    const doc: EditorDoc = {
      ...a.doc,
      junctions: [
        { id: "j1", position: p(5, 2) },
        { id: "j2", position: p(5, 2) },
      ],
      wires: [
        { id: "w1", from: { comp: a.id, pin: "2" }, to: { junction: "j1" }, points: [] },
        { id: "w2", from: { junction: "j1" }, to: p(5, 6), points: [] },
        { id: "w3", from: { junction: "j2" }, to: p(9, 2), points: [] },
        { id: "w4", from: p(5, 2), to: p(5, -3), points: [] },
      ],
    };
    const out = normalizeContacts(doc);
    expect(out.junctions).toEqual([{ id: "j1", position: p(5, 2) }]);
    expect(out.wires.map((w) => [w.id, w.from])).toEqual([
      ["w1", { comp: a.id, pin: "2" }],
      ["w2", { junction: "j1" }],
      ["w3", { junction: "j1" }],
      ["w4", { junction: "j1" }],
    ]);
  });

  it("removes a wire of zero length left with a free end", () => {
    const a = resistor(emptyDoc(), 0, 0);
    const doc: EditorDoc = {
      ...a.doc,
      wires: [{ id: "w1", from: { comp: a.id, pin: "2" }, to: p(0, 2), points: [] }],
    };
    const out = normalizeContacts(doc);
    // Its free end lies on the pin it starts from: the wire joins the pin to itself.
    expect(out.wires).toEqual([]);
  });

  it("leaves a wire passing over a pin unconnected", () => {
    const a = resistor(emptyDoc(), 0, 0);
    const doc: EditorDoc = {
      ...a.doc,
      wires: [{ id: "w1", from: p(-3, 2), to: p(3, 2), points: [] }],
    };
    expect(normalizeContacts(doc)).toBe(doc);
    expect(wirePath(doc, doc.wires[0]!)).toEqual([p(-3, 2), p(3, 2)]);
  });
});
