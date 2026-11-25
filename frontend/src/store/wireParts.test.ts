import { describe, expect, it } from "vitest";

import {
  addComponent,
  addWire,
  cleanJunctions,
  deleteItems,
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

  it("slides a segment along its length, its neighbours following (#261)", () => {
    // A U between two steps: (0,0) → (4,0) → (4,5) → (8,5) → (8,0) → (12,0).
    const added = addWire(emptyDoc(), [p(0, 0), p(4, 0), p(4, 5), p(8, 5), p(8, 0), p(12, 0)])!;
    const segment = { wire: added.id, kind: "segment", index: 2 } as const;
    const after = moveWirePart(added.doc, segment, p(8, 5), p(6, 5));
    expect(pathOf(after, added.id)).toEqual([
      p(0, 0),
      p(6, 0),
      p(6, 5),
      p(10, 5),
      p(10, 0),
      p(12, 0),
    ]);
    // Along and across at once.
    const both = moveWirePart(added.doc, segment, p(5, 7), p(6, 5));
    expect(pathOf(both, added.id)).toEqual([p(0, 0), p(3, 0), p(3, 7), p(7, 7), p(7, 0), p(12, 0)]);
  });

  it("slides a vertical segment, adding corners next to the wire ends", () => {
    const { doc, wire } = stepWire();
    const after = moveWirePart(doc, { wire, kind: "segment", index: 1 }, p(5, 4), p(5, 2));
    expectSameEndsAndOrthogonal(doc, after, wire);
    expect(pathOf(after, wire)).toEqual([p(0, 0), p(0, 2), p(5, 2), p(5, 7), p(10, 7), p(10, 5)]);
  });

  it("keeps an end segment attached while it slides", () => {
    const { doc, wire } = stepWire();
    const after = moveWirePart(doc, { wire, kind: "segment", index: 0 }, p(4, 1), p(2, 0));
    expectSameEndsAndOrthogonal(doc, after, wire);
    expect(pathOf(after, wire)).toEqual([p(0, 0), p(2, 0), p(2, 1), p(7, 1), p(7, 5), p(10, 5)]);
  });

  it("keeps a wire between two pins attached and orthogonal while a segment slides", () => {
    let doc = addComponent(emptyDoc(), {
      type: "resistor",
      position: p(0, 0),
      rotation: 0,
      mirror: false,
    }).doc;
    doc = addComponent(doc, {
      type: "resistor",
      position: p(10, 0),
      rotation: 0,
      mirror: false,
    }).doc;
    // From the bottom pin of the first one (0,2) to the bottom pin of the second one (10,2).
    const added = addWire(doc, [p(0, 2), p(0, 6), p(10, 6), p(10, 2)])!;
    const after = moveWirePart(
      added.doc,
      { wire: added.id, kind: "segment", index: 1 },
      p(3, 8),
      p(5, 6),
    );
    expectSameEndsAndOrthogonal(added.doc, after, added.id);
    const w = after.wires[0]!;
    expect(w.from).toEqual({ comp: "c1", pin: "2" });
    expect(w.to).toEqual({ comp: "c2", pin: "2" });
    expect(pathOf(after, added.id)).toContainEqual(p(-2, 8));
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

describe("cleaning junctions after a deletion", () => {
  /** A horizontal wire (0,0)-(10,0) and a branch from (5,5) up to it: a junction at (5,0). */
  function tee() {
    let doc = addWire(emptyDoc(), [p(0, 0), p(10, 0)])!.doc;
    const branch = addWire(doc, [p(5, 5), p(5, 0)])!;
    doc = branch.doc;
    return { doc, branch: branch.id, junction: doc.junctions[0]!.id };
  }

  it("merges the two wires left on a junction when the third one is deleted", () => {
    const { doc, branch } = tee();
    expect(doc.wires).toHaveLength(3);
    const after = deleteItems(doc, new Set([branch]));
    expect(after.junctions).toEqual([]);
    expect(after.wires).toHaveLength(1);
    expect(wirePath(after, after.wires[0]!)).toEqual([p(0, 0), p(10, 0)]);
  });

  it("keeps a junction that still joins three wires", () => {
    let { doc } = tee();
    doc = addWire(doc, [p(5, -5), p(5, 0)])!.doc;
    const fourth = doc.wires.at(-1)!.id;
    const after = deleteItems(doc, new Set([fourth]));
    expect(after.junctions).toHaveLength(1);
    expect(after.wires).toHaveLength(3);
  });

  it("removes a junction left with one wire, whose end becomes free", () => {
    const { doc, junction } = tee();
    const onJunction = doc.wires.filter(
      (w) => "junction" in w.to && w.to.junction === junction && !("junction" in w.from),
    );
    // Delete two of the three wires: the last one keeps a free end at (5,0).
    const keep = onJunction[0]!.id;
    const others = doc.wires.filter((w) => w.id !== keep).map((w) => w.id);
    const after = deleteItems(doc, new Set(others));
    expect(after.junctions).toEqual([]);
    expect(after.wires).toHaveLength(1);
    expect(after.wires[0]!.to).toEqual(p(5, 0));
  });

  it("cleans the junction when deleting the segment of the branch that reaches it", () => {
    const { doc, branch } = tee();
    const after = deleteSegment(doc, { wire: branch, kind: "segment", index: 0 });
    expect(after.junctions).toEqual([]);
    expect(after.wires.map((w) => wirePath(after, w))).toEqual([[p(0, 0), p(10, 0)]]);
  });

  it("does not merge two wires into one looping back to the same pin", () => {
    let doc = addComponent(emptyDoc(), {
      type: "resistor",
      position: p(0, 0),
      rotation: 0,
      mirror: false,
    }).doc;
    // Pin 2 of the resistor is at (0,2): two wires from it meet at (4,4), and a third arrives.
    doc = addWire(doc, [p(0, 2), p(4, 2), p(4, 4)])!.doc;
    doc = addWire(doc, [p(0, 2), p(0, 4), p(4, 4)])!.doc;
    doc = addWire(doc, [p(8, 4), p(4, 4)])!.doc;
    expect(doc.junctions).toHaveLength(1);
    const third = doc.wires.at(-1)!.id;
    const after = deleteItems(doc, new Set([third]));
    expect(after.junctions).toHaveLength(1);
    expect(after.wires).toHaveLength(2);
  });

  it("ignores junctions it is not asked about", () => {
    const { doc, junction } = tee();
    expect(cleanJunctions(doc, new Set(["nope"]))).toBe(doc);
    expect(cleanJunctions(doc, new Set([junction]))).toBe(doc);
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
