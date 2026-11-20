import { describe, expect, it } from "vitest";

import {
  addComponent,
  addWire,
  anchorAt,
  copyItems,
  deleteItems,
  emptyDoc,
  endPosition,
  moveItems,
  nextIndexed,
  pasteClip,
  pinPosition,
  simplifyPath,
  toWorld,
  unconnectedPins,
  wirePath,
  type EditorDoc,
  type GridPoint,
} from "./document";
import { fixtureDoc } from "./testFixtures";

/** A resistor at `position` (pins 2 grid units above and below when not rotated). */
const withResistor = (doc: EditorDoc, position: GridPoint) =>
  addComponent(doc, { type: "resistor", position, rotation: 0, mirror: false });

/** True if every segment of the path is horizontal or vertical. */
const orthogonal = (path: readonly GridPoint[]) =>
  path.every((p, i) => i === 0 || p.x === path[i - 1]!.x || p.y === path[i - 1]!.y);

describe("geometry", () => {
  it("mirrors, then rotates clockwise, then translates", () => {
    const at = { position: { x: 10, y: 20 }, mirror: false } as const;
    expect(toWorld({ x: 0, y: -2 }, { ...at, rotation: 0 })).toEqual({ x: 10, y: 18 });
    expect(toWorld({ x: 0, y: -2 }, { ...at, rotation: 90 })).toEqual({ x: 12, y: 20 });
    expect(toWorld({ x: 0, y: -2 }, { ...at, rotation: 180 })).toEqual({ x: 10, y: 22 });
    expect(toWorld({ x: 0, y: -2 }, { ...at, rotation: 270 })).toEqual({ x: 8, y: 20 });
    expect(toWorld({ x: 1, y: 0 }, { ...at, rotation: 0, mirror: true })).toEqual({ x: 9, y: 20 });
  });

  it("never produces -0", () => {
    const p = toWorld({ x: 0, y: 0 }, { position: { x: 0, y: 0 }, rotation: 180, mirror: true });
    expect(Object.is(p.x, -0)).toBe(false);
    expect(Object.is(p.y, -0)).toBe(false);
  });

  it("simplifies paths: repeated points, aligned bends, U-turns", () => {
    const p = (x: number, y: number) => ({ x, y });
    expect(simplifyPath([p(0, 0), p(0, 0), p(2, 0), p(5, 0)])).toEqual([p(0, 0), p(5, 0)]);
    expect(simplifyPath([p(0, 0), p(5, 0), p(3, 0), p(3, 4)])).toEqual([p(0, 0), p(3, 0), p(3, 4)]);
    expect(simplifyPath([p(0, 0), p(4, 0), p(4, 4)])).toEqual([p(0, 0), p(4, 0), p(4, 4)]);
  });
});

describe("ids and names", () => {
  it("numbers one above the highest existing index, case-insensitively", () => {
    expect(nextIndexed("R", [])).toBe("R1");
    expect(nextIndexed("R", ["R1", "r7", "R3", "C9", "Rx"])).toBe("R8");
  });

  it("names each new component after its SPICE prefix", () => {
    let doc = emptyDoc();
    doc = withResistor(doc, { x: 0, y: 0 }).doc;
    doc = withResistor(doc, { x: 4, y: 0 }).doc;
    doc = addComponent(doc, {
      type: "ground",
      position: { x: 8, y: 0 },
      rotation: 0,
      mirror: false,
    }).doc;
    expect(doc.components.map((c) => c.name)).toEqual(["R1", "R2", undefined]);
    expect(new Set(doc.components.map((c) => c.id)).size).toBe(3);
  });
});

describe("wires", () => {
  it("attaches the ends of a new wire to the pins under them", () => {
    let doc = withResistor(emptyDoc(), { x: 0, y: 0 }).doc;
    doc = withResistor(doc, { x: 6, y: 0 }).doc;
    const [a, b] = doc.components;
    const added = addWire(doc, [pinPosition(a!, "1"), { x: 6, y: -2 }])!;
    const w = added.doc.wires[0]!;
    expect(w.from).toEqual({ comp: a!.id, pin: "1" });
    expect(w.to).toEqual({ comp: b!.id, pin: "1" });
    expect(unconnectedPins(added.doc).map((p) => `${p.comp}.${p.pin}`)).toEqual([
      `${a!.id}.2`,
      `${b!.id}.2`,
    ]);
  });

  it("refuses an empty wire, or one that loops back to its start", () => {
    const doc = withResistor(emptyDoc(), { x: 0, y: 0 }).doc;
    const pin = pinPosition(doc.components[0]!, "1");
    expect(addWire(doc, [pin, pin])).toBeNull();
    expect(addWire(doc, [pin, { x: 3, y: -2 }, pin])).toBeNull();
  });

  it("splits a wire with a junction when another one ends on it", () => {
    let doc = addWire(emptyDoc(), [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ])!.doc;
    doc = addWire(doc, [
      { x: 5, y: 5 },
      { x: 5, y: 0 },
    ])!.doc;
    expect(doc.junctions).toEqual([{ id: expect.any(String), position: { x: 5, y: 0 } }]);
    expect(doc.wires).toHaveLength(3);
    expect(anchorAt(doc, { x: 5, y: 0 })).toEqual({
      kind: "junction",
      junction: doc.junctions[0]!.id,
    });
  });

  it("detaches wire ends, in place, from deleted items", () => {
    let doc = withResistor(emptyDoc(), { x: 0, y: 0 }).doc;
    const c = doc.components[0]!;
    const pin = pinPosition(c, "1");
    doc = addWire(doc, [pin, { x: 5, y: -2 }])!.doc;
    const after = deleteItems(doc, new Set([c.id]));
    expect(after.components).toEqual([]);
    expect(after.wires[0]!.from).toEqual(pin);
  });
});

describe("moving", () => {
  it("keeps wires attached and orthogonal when a component moves", () => {
    const doc = fixtureDoc("divider_op");
    const moved = moveItems(doc, new Set(["c3"]), { x: 3, y: 2 });
    expect(moved.components.find((c) => c.id === "c3")!.position).toEqual({ x: 11, y: 2 });
    for (const w of moved.wires) {
      const path = wirePath(moved, w);
      expect(orthogonal(path), `wire ${w.id}`).toBe(true);
      expect(path[0]).toEqual(endPosition(moved, w.from));
    }
  });

  it("does nothing for a zero move", () => {
    const doc = fixtureDoc("divider_op");
    expect(moveItems(doc, new Set(["c3"]), { x: 0, y: 0 })).toBe(doc);
  });

  it("never changes its input", () => {
    const doc = fixtureDoc("divider_op");
    const copy = structuredClone(doc);
    moveItems(doc, new Set(["c2", "c3"]), { x: 1, y: 1 });
    deleteItems(doc, new Set(["c2"]));
    expect(doc).toEqual(copy);
  });
});

describe("copy and paste", () => {
  it("pastes with new ids and new SPICE names, wires included", () => {
    const doc = fixtureDoc("divider_op");
    const wired = doc.wires.find((w) => "comp" in w.from && "comp" in w.to)!;
    const ends = [wired.from, wired.to].map((e) => ("comp" in e ? e.comp : ""));
    const clip = copyItems(doc, new Set(ends));
    expect(clip.wires.map((w) => w.id)).toContain(wired.id);

    const pasted = pasteClip(doc, clip, { x: 2, y: 2 });
    const all = [
      ...pasted.doc.components.map((c) => c.id),
      ...pasted.doc.wires.map((w) => w.id),
      ...pasted.doc.junctions.map((j) => j.id),
    ];
    expect(new Set(all).size).toBe(all.length);
    const names = pasted.doc.components.flatMap((c) => (c.name ? [c.name] : []));
    expect(new Set(names).size).toBe(names.length);
    // The pasted wire is attached to the pasted components, not the originals.
    const newWire = pasted.doc.wires.find((w) => pasted.ids.includes(w.id))!;
    for (const end of [newWire.from, newWire.to]) {
      expect("comp" in end && pasted.ids.includes(end.comp)).toBe(true);
    }
  });

  it("leaves out wires going outside the copy", () => {
    const doc = fixtureDoc("divider_op");
    const clip = copyItems(doc, new Set(["c3"]));
    expect(clip.components).toHaveLength(1);
    expect(clip.wires).toEqual([]);
  });
});
