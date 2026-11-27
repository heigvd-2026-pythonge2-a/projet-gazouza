// A wire that is neither horizontal nor vertical, in a file written by hand (#346).

import { beforeEach, describe, expect, it } from "vitest";

import { editorState, resetEditorStore } from "../test/editorStore";
import { removeHiddenWires, straightenWires, wirePath, type EditorDoc } from "./document";
import { parseDoc } from "./fileFormat";

beforeEach(resetEditorStore);

/** The file of the issue: one wire from R1 pin 2 at (0, 2) straight to R2 pin 1 at (4, -1). */
const FILE = JSON.stringify({
  format: "psice-schematic",
  version: 1,
  doc: {
    components: [
      {
        id: "c1",
        type: "resistor",
        name: "R1",
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: false,
        params: { resistance: "1k" },
      },
      {
        id: "c2",
        type: "resistor",
        name: "R2",
        position: { x: 4, y: 1 },
        rotation: 0,
        mirror: false,
        params: { resistance: "1k" },
      },
    ],
    junctions: [],
    wires: [{ id: "w1", from: { comp: "c1", pin: "2" }, to: { comp: "c2", pin: "1" }, points: [] }],
    texts: [],
  },
});

const orthogonal = (doc: EditorDoc) =>
  doc.wires.every((w) => {
    const path = wirePath(doc, w);
    return path.every((p, i) => i === 0 || p.x === path[i - 1]!.x || p.y === path[i - 1]!.y);
  });

describe("a diagonal wire (#346)", () => {
  it("opens without freezing, with a bend that makes the wire orthogonal", () => {
    editorState().openDocument(parseDoc(FILE));
    const doc = editorState().doc;
    expect(orthogonal(doc)).toBe(true);
    const wire = doc.wires.find((w) => w.id === "w1")!;
    expect(wirePath(doc, wire)).toEqual([
      { x: 0, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: -1 },
    ]);
  });

  it("straightens every diagonal segment, keeps the other bends, and leaves a clean doc alone", () => {
    const doc = parseDoc(FILE);
    const bent: EditorDoc = {
      ...doc,
      wires: [{ ...doc.wires[0]!, points: [{ x: 2, y: 3 }] }],
    };
    const straight = straightenWires(bent);
    expect(wirePath(straight, straight.wires[0]!)).toEqual([
      { x: 0, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 4, y: 3 },
      { x: 4, y: -1 },
    ]);
    expect(straightenWires(straight)).toBe(straight);
  });

  it("never loops on a diagonal segment when looking for hidden wires", () => {
    const doc = parseDoc(FILE);
    expect(removeHiddenWires(doc)).toBe(doc);
  });
});
