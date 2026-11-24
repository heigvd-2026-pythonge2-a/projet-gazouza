// Moving components: wires that follow (or not), direct pin-to-pin connections, pins landing on
// wires, and wires re-routed around the components (#88, #89, #91, #124, #125).

import { beforeEach, describe, expect, it } from "vitest";

import {
  addComponent,
  addWire,
  connectPinsOnWires,
  emptyDoc,
  moveItems,
  pinPosition,
  unconnectedPins,
  wirePath,
  type EditorDoc,
  type GridPoint,
} from "./document";
import { useEditorStore } from "./editorStore";
import { pathBlocked, routeAround } from "./routing";

const p = (x: number, y: number): GridPoint => ({ x, y });
const store = () => useEditorStore.getState();

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
});

/** Adds a component, returns the doc and its id. */
function put(doc: EditorDoc, type: string, position: GridPoint, rotation: 0 | 90 = 0) {
  return addComponent(doc, { type, position, rotation, mirror: false });
}

/** True if every segment of the path is horizontal or vertical. */
const orthogonal = (path: readonly GridPoint[]) =>
  path.every((q, i) => i === 0 || q.x === path[i - 1]!.x || q.y === path[i - 1]!.y);

describe("leaving a pin (#88)", () => {
  it("starts horizontally from the pin of a vertical source, as from a resistor", () => {
    for (const type of ["voltage_source", "current_source", "resistor"]) {
      const doc = put(emptyDoc(), type, p(0, 0)).doc;
      expect(routeAround(doc, p(0, 2), p(5, 2)), type).toEqual([p(5, 2)]);
      expect(routeAround(doc, p(0, -2), p(-5, -2)), type).toEqual([p(-5, -2)]);
    }
  });
});

describe("direct pin-to-pin connections (#124)", () => {
  /** Two vertical resistors, the second one's pin 1 on the first one's pin 2 at (0,2). */
  function stacked() {
    const a = put(emptyDoc(), "resistor", p(0, 0));
    const b = put(a.doc, "resistor", p(0, 4));
    return { doc: b.doc, a: a.id, b: b.id };
  }

  it("adds a wire that follows the moved component", () => {
    const { doc, a, b } = stacked();
    const moved = moveItems(doc, new Set([b]), p(3, 1));
    expect(moved.wires).toHaveLength(1);
    const w = moved.wires[0]!;
    expect(w.from).toEqual({ comp: b, pin: "1" });
    expect(w.to).toEqual({ comp: a, pin: "2" });
    expect(orthogonal(wirePath(moved, w))).toBe(true);
    expect(unconnectedPins(moved).filter((u) => u.position.y === 2)).toEqual([]);
  });

  it("adds nothing when both components move together, or with Ctrl", () => {
    const { doc, a, b } = stacked();
    expect(moveItems(doc, new Set([a, b]), p(3, 0)).wires).toEqual([]);
    expect(moveItems(doc, new Set([b]), p(3, 0), { detach: true }).wires).toEqual([]);
  });

  it("leaves no wire when the pins touch again, and undoes in one step", () => {
    const { doc, b } = stacked();
    store().openDocument(doc);
    store().select([b]);
    store().moveSelection(p(3, 0));
    expect(store().doc.wires).toHaveLength(1);
    store().moveSelection(p(-3, 0));
    expect(store().doc.wires).toEqual([]);
    store().undo();
    store().undo();
    expect(store().doc).toBe(doc);
  });
});

describe("moving without the wires (#91)", () => {
  it("leaves the wires in place, with free ends where the pins were", () => {
    let doc = put(emptyDoc(), "resistor", p(0, 0)).doc;
    const c = doc.components[0]!;
    doc = addWire(doc, [pinPosition(c, "2"), p(0, 6)])!.doc;
    const before = wirePath(doc, doc.wires[0]!);
    const moved = moveItems(doc, new Set([c.id]), p(5, 0), { detach: true });
    expect(moved.wires[0]!.from).toEqual(p(0, 2));
    expect(wirePath(moved, moved.wires[0]!)).toEqual(before);
  });

  it("is one undo step from the store", () => {
    let doc = put(emptyDoc(), "resistor", p(0, 0)).doc;
    const c = doc.components[0]!;
    doc = addWire(doc, [pinPosition(c, "2"), p(0, 6)])!.doc;
    store().openDocument(doc);
    store().select([c.id]);
    store().moveSelection(p(5, 0), { detach: true });
    expect(store().doc.wires[0]!.from).toEqual(p(0, 2));
    store().undo();
    expect(store().doc).toBe(doc);
  });
});

describe("pins on wires (#89)", () => {
  it("connects a wire laid over a pin", () => {
    // While drawing, the route goes around the pins: this happens when it falls back on an L,
    // or when a wire segment is dragged onto a pin.
    const doc = put(emptyDoc(), "resistor", p(0, 0)).doc;
    const c = doc.components[0]!;
    const added = addWire(doc, [p(-3, 2), p(3, 2)])!;
    const after = connectPinsOnWires(added.doc, { wires: new Set([added.id]) });
    const ends = after.wires.flatMap((w) => [w.from, w.to]);
    expect(after.wires).toHaveLength(2);
    expect(ends.filter((e) => "comp" in e && e.comp === c.id && e.pin === "2")).toHaveLength(2);
    expect(unconnectedPins(after).map((u) => u.pin)).toEqual(["1"]);
  });

  it("connects a wire segment dragged onto a pin", () => {
    let doc = put(emptyDoc(), "resistor", p(0, 0)).doc;
    doc = addWire(doc, [p(-3, 5), p(3, 5)])!.doc;
    store().openDocument(doc);
    const wire = store().doc.wires[0]!.id;
    store().selectWirePart({ wire, kind: "segment", index: 0 });
    store().moveWirePart(p(0, 2), null);
    expect(store().doc.wires).toHaveLength(2);
    expect(unconnectedPins(store().doc).map((u) => u.pin)).toEqual(["1"]);
  });

  it("connects a pin moved onto a wire", () => {
    let doc = addWire(emptyDoc(), [p(-5, 0), p(5, 0)])!.doc;
    doc = put(doc, "resistor", p(0, 5)).doc;
    const c = doc.components[0]!;
    store().openDocument(doc);
    store().select([c.id]);
    // Pin 1 of the resistor goes from (0,3) to (0,0), on the wire.
    store().moveSelection(p(0, -3));
    expect(store().doc.wires).toHaveLength(2);
    expect(unconnectedPins(store().doc).map((u) => u.pin)).toEqual(["2"]);
  });

  it("attaches a free wire end lying on a pin", () => {
    let doc = put(emptyDoc(), "resistor", p(0, 0)).doc;
    doc = addWire(doc, [p(5, 2), p(1, 2)])!.doc;
    doc = { ...doc, wires: doc.wires.map((w) => ({ ...w, to: p(0, 2) })) };
    const c = doc.components[0]!;
    const after = connectPinsOnWires(doc);
    expect(after.wires[0]!.to).toEqual({ comp: c.id, pin: "2" });
  });

  it("never shorts a component a wire is attached to", () => {
    let doc = put(emptyDoc(), "resistor", p(0, 0), 90).doc;
    const c = doc.components[0]!;
    // From pin 1 at (2,0), back across the resistor and its pin 2 at (-2,0).
    doc = addWire(doc, [pinPosition(c, "1"), p(-5, 0)])!.doc;
    expect(connectPinsOnWires(doc)).toBe(doc);
  });
});

describe("re-routing around components (#125)", () => {
  /** V1 and R2 side by side, joined top to top and bottom to bottom by horizontal wires. */
  function sideBySide() {
    const v = put(emptyDoc(), "voltage_source", p(0, 0));
    const r = put(v.doc, "resistor", p(6, 0));
    let doc = addWire(r.doc, [p(0, -2), p(6, -2)])!.doc;
    doc = addWire(doc, [p(0, 2), p(6, 2)])!.doc;
    return { doc, v: v.id, r: r.id };
  }

  it("keeps the wires out of the components when one moves", () => {
    const { doc, v, r } = sideBySide();
    for (const [id, delta] of [
      [r, p(0, -3)],
      [v, p(0, 3)],
    ] as const) {
      const moved = moveItems(doc, new Set([id]), delta);
      for (const w of moved.wires) {
        const path = wirePath(moved, w);
        expect(orthogonal(path), `${id} ${w.id}`).toBe(true);
        expect(pathBlocked(moved, path), `${id} ${w.id}`).toBe(false);
      }
    }
  });

  it("keeps the wires untouched when they stay clear", () => {
    const { doc, r } = sideBySide();
    const moved = moveItems(doc, new Set([r]), p(2, 0));
    expect(moved.wires.map((w) => w.points)).toEqual([[], []]);
  });
});
