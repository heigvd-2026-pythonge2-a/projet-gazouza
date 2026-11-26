// Selection rectangle: what lies inside it, wire sections included (#121), and what touches it
// with Shift (#93).

import { beforeEach, describe, expect, it } from "vitest";

import {
  addComponent,
  addWire,
  deleteSegments,
  emptyDoc,
  itemsTouchingRect,
  rectFrom,
  segmentsInRect,
  wirePath,
  type GridPoint,
} from "./document";
import { useEditorStore } from "./editorStore";

const p = (x: number, y: number): GridPoint => ({ x, y });
const store = () => useEditorStore.getState();

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
});

/** A zigzag wire: (0,0) → (5,0) → (5,5) → (10,5) → (10,10) → (15,10). */
function zigzag() {
  const added = addWire(emptyDoc(), [p(0, 0), p(5, 0), p(5, 5), p(10, 5), p(10, 10), p(15, 10)])!;
  return { doc: added.doc, wire: added.id };
}

describe("wire sections in the rectangle (#121)", () => {
  it("takes the segments whose two ends are inside", () => {
    const { doc, wire } = zigzag();
    // Around the vertical segment (10,5)-(10,10) only.
    expect(segmentsInRect(doc, rectFrom(p(9, 4), p(11, 11)))).toEqual([
      { wire, kind: "segment", index: 3 },
    ]);
    // Two segments: (5,0)-(5,5) and (5,5)-(10,5).
    expect(segmentsInRect(doc, rectFrom(p(4, -1), p(11, 6))).map((s) => s.index)).toEqual([1, 2]);
  });

  it("ignores a segment with one end outside, and a wire entirely inside", () => {
    const { doc } = zigzag();
    expect(segmentsInRect(doc, rectFrom(p(9, 6), p(11, 11)))).toEqual([]);
    expect(segmentsInRect(doc, rectFrom(p(-1, -1), p(16, 11)))).toEqual([]);
  });

  it("deletes several segments of the same wire, cutting it around them", () => {
    const { doc, wire } = zigzag();
    const after = deleteSegments(doc, [
      { wire, kind: "segment", index: 1 },
      { wire, kind: "segment", index: 3 },
    ]);
    expect(after.wires.map((w) => wirePath(after, w))).toEqual([
      [p(0, 0), p(5, 0)],
      [p(5, 5), p(10, 5)],
      [p(10, 10), p(15, 10)],
    ]);
  });

  it("selects sections with components from the store, and deletes them together", () => {
    const { doc } = zigzag();
    const withR = addComponent(doc, {
      type: "resistor",
      position: p(20, 0),
      rotation: 0,
      mirror: false,
    });
    store().openDocument(withR.doc);
    store().selectInRect(rectFrom(p(9, -3), p(21, 11)), "inside");
    expect(store().selection).toEqual([withR.id]);
    expect(store().segments.map((s) => s.index)).toEqual([3, 4]);
    store().deleteSelection();
    expect(store().doc.components).toEqual([]);
    expect(store().doc.wires.map((w) => wirePath(store().doc, w))).toEqual([
      [p(0, 0), p(5, 0), p(5, 5), p(10, 5)],
    ]);
    expect(store().segments).toEqual([]);
    store().undo();
    expect(store().doc).toBe(withR.doc);
  });

  it("forgets the sections when the schematic changes, so Delete never removes another one", () => {
    // The wire leaves the resistor's pin 2 at (0,2), bends at (0,6) and ends at (12,6).
    let doc = addComponent(emptyDoc(), {
      type: "resistor",
      position: p(0, 0),
      rotation: 0,
      mirror: false,
    }).doc;
    doc = addWire(doc, [p(0, 2), p(0, 6), p(12, 6)])!.doc;
    store().openDocument(doc);
    store().selectInRect(rectFrom(p(-1, -3), p(5, 7)), "inside");
    expect(store().segments).toHaveLength(1);
    // Pin 2 comes down onto the bend: the selected segment (0,2)-(0,6) is gone, and index 0 is now
    // the segment (0,6)-(12,6), which was never selected.
    store().moveSelection(p(0, 4));
    expect(store().segments).toEqual([]);
    store().deleteSelection();
    expect(store().doc.wires).toHaveLength(1);
  });

  it("forgets the sections when the selection changes", () => {
    const { doc } = zigzag();
    store().openDocument(doc);
    store().selectInRect(rectFrom(p(9, 4), p(11, 11)), "inside");
    expect(store().segments).toHaveLength(1);
    store().select([]);
    expect(store().segments).toEqual([]);
  });
});

describe("what touches the rectangle (#93)", () => {
  it("takes components, wires and junctions touching it", () => {
    let doc = addComponent(emptyDoc(), {
      type: "resistor",
      position: p(0, 0),
      rotation: 0,
      mirror: false,
    }).doc;
    doc = addWire(doc, [p(5, -10), p(5, 10)])!.doc;
    const [r] = doc.components;
    const [w] = doc.wires;
    // A thin box crossing the resistor's body and the wire, without holding either whole.
    expect(itemsTouchingRect(doc, rectFrom(p(-1, 0), p(6, 0)))).toEqual([r!.id, w!.id]);
    expect(itemsTouchingRect(doc, rectFrom(p(1, 0), p(4, 0)))).toEqual([]);
  });

  it("adds what was not selected and removes what was", () => {
    let doc = addComponent(emptyDoc(), {
      type: "resistor",
      position: p(0, 0),
      rotation: 0,
      mirror: false,
    }).doc;
    doc = addComponent(doc, {
      type: "resistor",
      position: p(4, 0),
      rotation: 0,
      mirror: false,
    }).doc;
    const [a, b] = doc.components;
    store().openDocument(doc);
    store().select([a!.id]);
    store().selectInRect(rectFrom(p(-1, 0), p(5, 0)), "touching");
    expect(store().selection).toEqual([b!.id]);
  });
});
