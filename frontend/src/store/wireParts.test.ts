import { describe, expect, it } from "vitest";

import {
  addComponent,
  addWire,
  deleteBend,
  deleteSegment,
  docBounds,
  emptyDoc,
  endPosition,
  itemsInRect,
  mirrorComponents,
  moveWirePart,
  nameProblem,
  netNameProblem,
  partPath,
  rectFrom,
  rotateComponents,
  unconnectedPins,
  wirePartAt,
  wirePartPoints,
  wirePath,
  type EditorDoc,
  type GridPoint,
} from "./document";

const p = (x: number, y: number): GridPoint => ({ x, y });

/** A free wire shaped like a step: (0,0) → (5,0) → (5,5) → (10,5). */
function stepWire(): { doc: EditorDoc; wire: string } {
  const added = addWire(emptyDoc(), [p(0, 0), p(5, 0), p(5, 5), p(10, 5)])!;
  return { doc: added.doc, wire: added.id };
}

const pathOf = (doc: EditorDoc, wire: string) =>
  partPath(
    doc,
    doc.wires.find((w) => w.id === wire)!,
  );

const orthogonal = (path: readonly GridPoint[]) =>
  path.every((q, i) => i === 0 || q.x === path[i - 1]!.x || q.y === path[i - 1]!.y);

/** The wire still starts and ends where it did, and has no diagonal segment. */
function expectSameEndsAndOrthogonal(before: EditorDoc, after: EditorDoc, wire: string) {
  const a = pathOf(before, wire);
  const b = pathOf(after, wire);
  expect(b[0]).toEqual(a[0]);
  expect(b.at(-1)).toEqual(a.at(-1));
  expect(orthogonal(b)).toBe(true);
}

describe("picking wire parts", () => {
  it("picks a bend near it, else the closest segment", () => {
    const { doc, wire } = stepWire();
    expect(wirePartAt(doc, wire, p(5.1, 0.2))).toEqual({ wire, kind: "bend", index: 1 });
    expect(wirePartAt(doc, wire, p(2.5, 0.3))).toEqual({ wire, kind: "segment", index: 0 });
    expect(wirePartAt(doc, wire, p(5.4, 2.5))).toEqual({ wire, kind: "segment", index: 1 });
    expect(wirePartAt(doc, "nope", p(0, 0))).toBeNull();
  });

  it("gives the points of a part, or null if it does not exist", () => {
    const { doc, wire } = stepWire();
    expect(wirePartPoints(doc, { wire, kind: "bend", index: 2 })).toEqual([p(5, 5)]);
    expect(wirePartPoints(doc, { wire, kind: "segment", index: 1 })).toEqual([p(5, 0), p(5, 5)]);
    // The ends of a wire are not bends.
    expect(wirePartPoints(doc, { wire, kind: "bend", index: 0 })).toBeNull();
    expect(wirePartPoints(doc, { wire, kind: "segment", index: 3 })).toBeNull();
  });
});

describe("moveWirePart", () => {
  it("moves a segment across its direction only", () => {
    const { doc, wire } = stepWire();
    const after = moveWirePart(doc, { wire, kind: "segment", index: 1 }, p(7, 99));
    expect(pathOf(after, wire)).toEqual([p(0, 0), p(7, 0), p(7, 5), p(10, 5)]);
  });

  it("adds a corner when a segment touching a wire end moves", () => {
    const { doc, wire } = stepWire();
    const after = moveWirePart(doc, { wire, kind: "segment", index: 0 }, p(3, 2));
    expect(pathOf(after, wire)).toEqual([p(0, 0), p(0, 2), p(5, 2), p(5, 5), p(10, 5)]);
  });

  it("moves a bend through the target, keeping the wire orthogonal", () => {
    const { doc, wire } = stepWire();
    const target = p(7, -3);
    const after = moveWirePart(doc, { wire, kind: "bend", index: 1 }, target);
    expectSameEndsAndOrthogonal(doc, after, wire);
    expect(pathOf(after, wire)).toContainEqual(target);
  });

  it("returns the same document for a part that does not exist", () => {
    const { doc, wire } = stepWire();
    expect(moveWirePart(doc, { wire, kind: "bend", index: 9 }, p(0, 0))).toBe(doc);
  });
});

describe("deleteBend", () => {
  it("pulls the next bend into line", () => {
    const { doc, wire } = stepWire();
    const after = deleteBend(doc, { wire, kind: "bend", index: 1 });
    expect(pathOf(after, wire)).toEqual([p(0, 0), p(0, 5), p(10, 5)]);
  });

  it("pulls the previous bend when the next point is the wire end", () => {
    const { doc, wire } = stepWire();
    const after = deleteBend(doc, { wire, kind: "bend", index: 2 });
    expect(pathOf(after, wire)).toEqual([p(0, 0), p(10, 0), p(10, 5)]);
  });

  it("refuses to remove the only bend of an L", () => {
    const added = addWire(emptyDoc(), [p(0, 0), p(5, 0), p(5, 5)])!;
    expect(deleteBend(added.doc, { wire: added.id, kind: "bend", index: 1 })).toBe(added.doc);
  });
});

describe("deleteSegment", () => {
  it("cuts the wire in two pieces with free ends", () => {
    const { doc, wire } = stepWire();
    const after = deleteSegment(doc, { wire, kind: "segment", index: 1 });
    expect(after.wires).toHaveLength(2);
    expect(new Set(after.wires.map((w) => w.id)).size).toBe(2);
    expect(after.wires.map((w) => wirePath(after, w))).toEqual([
      [p(0, 0), p(5, 0)],
      [p(5, 5), p(10, 5)],
    ]);
  });

  it("removes a wire made of a single segment", () => {
    const added = addWire(emptyDoc(), [p(0, 0), p(5, 0)])!;
    const after = deleteSegment(added.doc, { wire: added.id, kind: "segment", index: 0 });
    expect(after.wires).toEqual([]);
  });
});

describe("rotate and mirror", () => {
  it("keep the wires attached and orthogonal", () => {
    let doc = addComponent(emptyDoc(), {
      type: "resistor",
      position: p(0, 0),
      rotation: 0,
      mirror: false,
    }).doc;
    const c = doc.components[0]!;
    doc = addWire(doc, [p(0, -2), p(0, -5), p(6, -5)])!.doc;
    const ids = new Set([c.id]);
    for (const after of [
      rotateComponents(doc, ids),
      mirrorComponents(rotateComponents(doc, ids), ids),
    ]) {
      const w = after.wires[0]!;
      const path = wirePath(after, w);
      expect(path[0]).toEqual(endPosition(after, w.from));
      expect(orthogonal(path)).toBe(true);
    }
  });
});

describe("selection rectangle and bounds", () => {
  it("only takes what lies entirely inside", () => {
    const { doc, wire } = stepWire();
    expect(itemsInRect(doc, rectFrom(p(10, 5), p(-1, -1)))).toEqual([wire]);
    expect(itemsInRect(doc, rectFrom(p(0, 0), p(6, 6)))).toEqual([]);
  });

  it("bounds the whole circuit, or nothing for an empty one", () => {
    const { doc } = stepWire();
    expect(docBounds(doc)).toEqual({ min: p(0, 0), max: p(10, 5) });
    expect(docBounds(emptyDoc())).toBeNull();
  });
});

describe("checks shown while editing", () => {
  it("unconnected pins: two pins at the same point connect each other", () => {
    let doc = addComponent(emptyDoc(), {
      type: "resistor",
      position: p(0, 0),
      rotation: 0,
      mirror: false,
    }).doc;
    doc = addComponent(doc, {
      type: "resistor",
      position: p(0, 4),
      rotation: 0,
      mirror: false,
    }).doc;
    expect(unconnectedPins(doc).map((u) => u.position)).toEqual([p(0, -2), p(0, 6)]);
  });

  it("SPICE names", () => {
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
    const [r1, r2] = doc.components;
    expect(nameProblem(doc, r1!, "R")).toBeNull();
    expect(nameProblem(doc, { ...r1!, name: "" }, "R")).toMatch(/obligatoire/);
    expect(nameProblem(doc, { ...r1!, name: "C1" }, "R")).toMatch(/commencer par « R »/);
    expect(nameProblem(doc, { ...r1!, name: "R-1" }, "R")).toMatch(/Lettres/);
    expect(nameProblem(doc, { ...r2!, name: "r1" }, "R")).toMatch(/déjà R1|déjà r1/);
  });

  it("node names", () => {
    expect(netNameProblem("out")).toBeNull();
    expect(netNameProblem("")).toMatch(/obligatoire/);
    expect(netNameProblem("1out")).toMatch(/Lettres/);
    expect(netNameProblem("n12")).toMatch(/réservé/);
  });
});
