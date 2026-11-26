// Wires that connect nothing new: refused when drawn (#257), removed when an edit leaves them
// hidden under other wires (#259).

import { beforeEach, describe, expect, it } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import {
  addComponent,
  closesWireLoop,
  emptyDoc,
  normalizeContacts,
  removeHiddenWires,
  wirePath,
  type EditorDoc,
  type GridPoint,
} from "./document";
import { WIRE_LOOP_NOTICE } from "./editorStore";

const p = (x: number, y: number): GridPoint => ({ x, y });

beforeEach(resetEditorStore);

/** Draws a wire with the wire tool through `points`; a repeated last point leaves it free. */
function wire(...points: [number, number][]) {
  editorState().startWiring();
  for (const [x, y] of points) editorState().wireClick(p(x, y));
}

/** Each wire as its path, "x,y x,y ...". */
const paths = (doc: EditorDoc) =>
  doc.wires.map((w) =>
    wirePath(doc, w)
      .map((q) => `${q.x},${q.y}`)
      .join(" "),
  );

describe("drawing a wire that only closes a loop of wires (#257)", () => {
  /** R1 (0,0) and R2 (4,0), their pins 2 joined by a wire along y = 2. */
  function base() {
    dropComponent("resistor", p(0, 0));
    dropComponent("resistor", p(4, 0));
    wire([0, 2], [4, 2]);
    editorState().setTool({ kind: "select" });
    return editorState().doc;
  }

  const cases: [string, [number, number][][]][] = [
    [
      "a wire right over another one",
      [
        [
          [1, 2],
          [3, 2],
        ],
      ],
    ],
    [
      "a detour between two points of the same wire",
      [
        [
          [1, 2],
          [1, 4],
          [3, 4],
          [3, 2],
        ],
      ],
    ],
    [
      "a wire from a junction back to its own wire",
      [
        [
          [2, 2],
          [2, 5],
          [2, 5],
        ],
        [
          [2, 4],
          [3, 4],
          [3, 2],
        ],
      ],
    ],
    [
      "a wire from a pin back to its own wire",
      [
        [
          [0, 2],
          [0, 4],
          [2, 4],
          [2, 2],
        ],
      ],
    ],
  ];

  for (const [name, wires] of cases) {
    it(`refuses ${name}, and says why`, () => {
      base();
      for (const w of wires.slice(0, -1)) {
        wire(...w);
        editorState().setTool({ kind: "select" });
      }
      const before = editorState().doc;
      wire(...(wires.at(-1) as [number, number][]));
      expect(editorState().doc).toBe(before);
      expect(editorState().notice).toBe(WIRE_LOOP_NOTICE);
      expect(editorState().draft).toBeNull();
      // The next change clears the message.
      editorState().setTool({ kind: "select" });
      expect(editorState().notice).toBeNull();
    });
  }

  it("accepts a wire between the two pins of one component (a short, not a loop of wires)", () => {
    dropComponent("resistor", p(0, 0));
    wire([0, -2], [2, -2], [2, 2], [0, 2]);
    expect(editorState().doc.wires).toHaveLength(1);
    expect(editorState().notice).toBeNull();
  });
});

describe("sliding a component along a wire (#259)", () => {
  /** A free wire along y = 0, R1 below it at x = 2 and R2 above it at x = 5. */
  function slide() {
    wire([-4, 0], [10, 0], [10, 0]);
    editorState().setTool({ kind: "select" });
    const r1 = dropComponent("resistor", p(2, 2));
    dropComponent("resistor", p(5, -2));
    return r1;
  }

  it("keeps three straight wires, without duplicates, going past the other pin and back", () => {
    const r1 = slide();
    const before = paths(editorState().doc).sort();
    expect(before).toEqual(["-4,0 2,0", "2,0 5,0", "5,0 10,0"]);
    editorState().select([r1.id]);
    editorState().moveSelection(p(5, 0));
    expect(paths(editorState().doc).sort()).toEqual(["-4,0 5,0", "5,0 7,0", "7,0 10,0"]);
    editorState().moveSelection(p(-5, 0));
    expect(paths(editorState().doc).sort()).toEqual(before);
  });

  it("still goes round a pin of another node, without connecting it", () => {
    // R3's pin 2 lies on the line, but nothing joins it to the wire.
    wire([-4, 0], [2, 0], [2, 0]);
    editorState().setTool({ kind: "select" });
    const r1 = dropComponent("resistor", p(2, 2));
    const r3 = dropComponent("resistor", p(5, -2));
    editorState().select([r1.id]);
    editorState().moveSelection(p(5, 0));
    const doc = editorState().doc;
    const onR3 = doc.wires.filter((w) =>
      [w.from, w.to].some((e) => "comp" in e && e.comp === r3.id),
    );
    expect(onR3).toEqual([]);
    const [w] = doc.wires;
    expect(wirePath(doc, w!).some((q) => q.x === 5 && q.y === 0)).toBe(false);
  });
});

describe("removeHiddenWires", () => {
  const twoResistors = () => {
    const a = addComponent(emptyDoc(), {
      type: "resistor",
      position: p(0, 0),
      rotation: 0,
      mirror: false,
    });
    const b = addComponent(a.doc, {
      type: "resistor",
      position: p(4, 0),
      rotation: 0,
      mirror: false,
    });
    return { doc: b.doc, a: a.id, b: b.id };
  };

  it("removes a wire lying right under another one between the same points", () => {
    const { doc, a, b } = twoResistors();
    const twice: EditorDoc = {
      ...doc,
      wires: [
        { id: "w1", from: { comp: a, pin: "2" }, to: { comp: b, pin: "2" }, points: [] },
        { id: "w2", from: { comp: b, pin: "2" }, to: { comp: a, pin: "2" }, points: [] },
      ],
    };
    expect(removeHiddenWires(twice).wires.map((w) => w.id)).toEqual(["w1"]);
    const once = { ...doc, wires: twice.wires.slice(0, 1) };
    expect(removeHiddenWires(once)).toBe(once);
  });

  it("keeps a detour the user can see, even if it closes a loop of wires", () => {
    const { doc, a, b } = twoResistors();
    const loop: EditorDoc = {
      ...doc,
      wires: [
        { id: "w1", from: { comp: a, pin: "2" }, to: { comp: b, pin: "2" }, points: [] },
        {
          id: "w2",
          from: { comp: a, pin: "2" },
          to: { comp: b, pin: "2" },
          points: [p(0, 4), p(4, 4)],
        },
      ],
    };
    expect(removeHiddenWires(loop)).toBe(loop);
    expect(closesWireLoop(loop, "w2")).toBe(true);
    expect(closesWireLoop({ ...loop, wires: loop.wires.slice(0, 1) }, "w1")).toBe(false);
  });

  it("adds no contact wire between touching pins already joined by wires", () => {
    const a = addComponent(emptyDoc(), {
      type: "resistor",
      position: p(0, 0),
      rotation: 0,
      mirror: false,
    });
    const b = addComponent(a.doc, {
      type: "resistor",
      position: p(0, 4),
      rotation: 0,
      mirror: false,
    });
    // R1's pin 2 touches R2's pin 1 at (0,2), and a wire round the side joins them as well.
    const doc: EditorDoc = {
      ...b.doc,
      wires: [
        {
          id: "w1",
          from: { comp: a.id, pin: "2" },
          to: { comp: b.id, pin: "1" },
          points: [p(2, 2)],
        },
      ],
    };
    expect(normalizeContacts(doc)).toBe(doc);
  });
});
