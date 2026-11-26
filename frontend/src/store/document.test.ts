import { describe, expect, it } from "vitest";

import {
  addComponent,
  addWire,
  anchorAt,
  connectionDots,
  copyItems,
  componentsOverlap,
  deleteItems,
  freeMove,
  emptyDoc,
  endPosition,
  moveItems,
  nextIndexed,
  pasteClip,
  pinPosition,
  simplifyPath,
  toWorld,
  turnClip,
  unconnectedPins,
  wirePath,
  type EditorDoc,
  type GridPoint,
} from "./document";
import { getDef } from "./library";
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

  it("merges a wire drawn from the free end of another one, keeping the new id (#245)", () => {
    const first = addWire(emptyDoc(), [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ])!.doc;
    const bent = addWire(first, [
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ])!;
    expect(bent.doc.junctions).toEqual([]);
    expect(bent.doc.wires.map((w) => w.id)).toEqual([bent.id]);
    expect(wirePath(bent.doc, bent.doc.wires[0]!)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ]);

    // In line with it, and between two free ends: one straight wire.
    const second = addWire(first, [
      { x: 10, y: 0 },
      { x: 15, y: 0 },
    ])!.doc;
    const bridged = addWire(second, [
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ])!;
    expect(bridged.doc.junctions).toEqual([]);
    expect(bridged.doc.wires.map((w) => w.id)).toEqual([bridged.id]);
    expect(wirePath(bridged.doc, bridged.doc.wires[0]!)).toEqual([
      { x: 0, y: 0 },
      { x: 15, y: 0 },
    ]);
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

describe("overlapping components", () => {
  const resistor = (x: number, y: number, rotation: 0 | 90 = 0) =>
    ({
      id: `r${x},${y}`,
      type: "resistor",
      position: { x, y },
      rotation,
      mirror: false,
      params: {},
    }) as const;

  it("overlap when stacked or partly covering each other", () => {
    expect(componentsOverlap(resistor(0, 0), resistor(0, 0))).toBe(true);
    expect(componentsOverlap(resistor(0, 0), resistor(0, 1))).toBe(true);
    expect(componentsOverlap(resistor(0, 0), resistor(0, 0, 90))).toBe(true);
  });

  it("do not overlap when apart, or touching by a single pin", () => {
    expect(componentsOverlap(resistor(0, 0), resistor(2, 0))).toBe(false);
    expect(componentsOverlap(resistor(0, 0), resistor(0, 4))).toBe(false);
    // An L: the vertical one's pin 2 at (0,2) is the horizontal one's pin at (0,2).
    expect(componentsOverlap(resistor(0, 0), resistor(2, 2, 90))).toBe(false);
  });

  it("moves to the nearest free place", () => {
    let doc = withResistor(emptyDoc(), { x: 0, y: 0 }).doc;
    const added = withResistor(doc, { x: 6, y: 0 });
    doc = added.doc;
    const moved = freeMove(doc, new Set([added.id]), { x: -6, y: 0 });
    const c = moved.components.find((x) => x.id === added.id)!;
    expect(Math.abs(c.position.x) + Math.abs(c.position.y)).toBe(1);
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

  it("does not copy a junction without the wires it joins (#245)", () => {
    let doc = addWire(emptyDoc(), [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ])!.doc;
    const branch = addWire(doc, [
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ])!;
    doc = branch.doc;
    const clip = copyItems(doc, new Set([doc.junctions[0]!.id, branch.id]));
    expect(clip.junctions).toEqual([]);
    expect(clip.wires).toEqual([
      { id: branch.id, from: { x: 5, y: 0 }, to: { x: 5, y: 5 }, points: [] },
    ]);
    expect(copyItems(doc, new Set([doc.junctions[0]!.id]))).toEqual(emptyDoc());
  });

  it("leaves out wires going outside the copy", () => {
    const doc = fixtureDoc("divider_op");
    const clip = copyItems(doc, new Set(["c3"]));
    expect(clip.components).toHaveLength(1);
    expect(clip.wires).toEqual([]);
  });

  it("turns a copy as a whole, pins and wires together (#260)", () => {
    const centre = { x: 3, y: -1 };
    const turns = {
      rotate: (p: GridPoint) => ({ x: centre.x - (p.y - centre.y), y: centre.y + p.x - centre.x }),
      mirror: (p: GridPoint) => ({ x: 2 * centre.x - p.x, y: p.y }),
    };
    const pins = (doc: EditorDoc) =>
      doc.components.map((c) => getDef(c.type).pins.map((pin) => pinPosition(c, pin.name)));
    let clip: EditorDoc = fixtureDoc("divider_op");
    // Turns mixed so that mirrored and rotated components are turned again.
    for (const turn of ["rotate", "mirror", "rotate", "rotate", "mirror", "rotate"] as const) {
      const move = turns[turn];
      const turned = turnClip(clip, centre, turn);
      expect(pins(turned)).toEqual(pins(clip).map((ps) => ps.map(move)));
      expect(turned.wires.map((w) => wirePath(turned, w))).toEqual(
        clip.wires.map((w) => wirePath(clip, w).map(move)),
      );
      expect(turned.junctions.map((j) => j.position)).toEqual(
        clip.junctions.map((j) => move(j.position)),
      );
      clip = turned;
    }
    // Four quarter turns and two flips: back where it started.
    expect(clip).toEqual(fixtureDoc("divider_op"));
  });

  it("keeps the texts of a turned copy upright, their middle turned with the rest", () => {
    // Box of 2 x 0.9 grid units: its middle, rounded to the grid, is (1, 0).
    const text = { id: "t1", position: { x: 0, y: 0 }, content: "abcde" };
    const clip = { ...emptyDoc(), texts: [text] };
    const centre = { x: 4, y: 0 };
    // Middle turned around (4, 0) to (4, -3): the box starts at (3, -3).
    expect(turnClip(clip, centre, "rotate").texts).toEqual([
      { id: "t1", position: { x: 3, y: -3 }, content: "abcde" },
    ]);
    // Middle flipped to (7, 0): the box starts at (6, 0) and still reads left to right.
    expect(turnClip(clip, centre, "mirror").texts).toEqual([
      { id: "t1", position: { x: 6, y: 0 }, content: "abcde" },
    ]);
  });
});

describe("connection dots (#245)", () => {
  /** Two horizontal resistors touching by a pin at (2, 0). */
  const touching = () => {
    let doc = addComponent(emptyDoc(), {
      type: "resistor",
      position: { x: 0, y: 0 },
      rotation: 90,
      mirror: false,
    }).doc;
    doc = addComponent(doc, {
      type: "resistor",
      position: { x: 4, y: 0 },
      rotation: 90,
      mirror: false,
    }).doc;
    expect(pinPosition(doc.components[0]!, "1")).toEqual({ x: 2, y: 0 });
    return doc;
  };
  const contact = { x: 2, y: 0 };

  it("draws a dot where three pins meet, none where two do", () => {
    const doc = touching();
    expect(connectionDots(doc)).toEqual([]);
    // A capacitor below, its pin on the contact.
    const probe = addComponent(emptyDoc(), {
      type: "capacitor",
      position: { x: 0, y: 0 },
      rotation: 0,
      mirror: false,
    }).doc.components[0]!;
    const top = pinPosition(probe, "1");
    const withCap = addComponent(doc, {
      type: "capacitor",
      position: { x: contact.x - top.x, y: contact.y - top.y },
      rotation: 0,
      mirror: false,
    }).doc;
    expect(connectionDots(withCap)).toEqual([{ id: "dot-2,0", position: contact }]);
  });

  it("counts the wires attached to a pin, not the free ends", () => {
    const doc = touching();
    const wired = addWire(doc, [contact, { x: 2, y: 5 }])!.doc;
    expect(connectionDots(wired)).toEqual([{ id: "dot-2,0", position: contact }]);

    // A resistor pin at (2, 0) and its wire: no dot. A free end lying there does not count.
    const r = withResistor(emptyDoc(), { x: 2, y: 2 }).doc;
    const pin = pinPosition(r.components[0]!, "1");
    expect(pin).toEqual(contact);
    const one = addWire(r, [pin, { x: 6, y: 0 }])!.doc;
    expect(connectionDots(one)).toEqual([]);
    const free = { id: "w9", from: { ...contact }, to: { x: -3, y: 0 }, points: [] };
    expect(connectionDots({ ...one, wires: [...one.wires, free] })).toEqual([]);
    // A second wire attached to the pin: three connections.
    const two = addWire(one, [pin, { x: -3, y: 0 }])!.doc;
    expect(connectionDots(two)).toEqual([{ id: "dot-2,0", position: contact }]);
  });

  it("draws a dot on a junction of three wires only", () => {
    let doc = addWire(emptyDoc(), [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ])!.doc;
    doc = addWire(doc, [
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ])!.doc;
    const j = doc.junctions[0]!;
    expect(connectionDots(doc)).toEqual([{ id: j.id, position: j.position, junction: j.id }]);
    // A junction of two wires (older files) gets no dot.
    const two = { ...doc, wires: doc.wires.slice(0, 2) };
    expect(connectionDots(two)).toEqual([]);
  });
});
