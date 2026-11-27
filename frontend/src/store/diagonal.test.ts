// Components turned by 45 degrees, pins kept on the grid (#161).

import { beforeEach, describe, expect, it } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { symbolRect, toLocal } from "./captions";
import {
  addComponent,
  componentBox,
  emptyDoc,
  pinPosition,
  toWorld,
  type EditorDoc,
  type GridPoint,
  type PlacedComponent,
  type Rotation,
} from "./document";
import { DIAGONAL_NOTICE } from "./editorStore";
import { parseDoc, serializeDoc } from "./fileFormat";
import { toSchematic } from "./simulation";

beforeEach(resetEditorStore);

const at = (rotation: Rotation, mirror = false, position: GridPoint = { x: 0, y: 0 }) => ({
  position,
  rotation,
  mirror,
});

describe("toWorld on a diagonal (docs/format-schema.md)", () => {
  it("gives the pins of the contract's table", () => {
    const pins = (r: Rotation) => [toWorld({ x: 0, y: -2 }, at(r)), toWorld({ x: 0, y: 2 }, at(r))];
    expect(pins(45)).toEqual([
      { x: 2, y: -2 },
      { x: -2, y: 2 },
    ]);
    expect(pins(135)).toEqual([
      { x: 2, y: 2 },
      { x: -2, y: -2 },
    ]);
    expect(pins(225)).toEqual([
      { x: -2, y: 2 },
      { x: 2, y: -2 },
    ]);
    expect(pins(315)).toEqual([
      { x: -2, y: -2 },
      { x: 2, y: 2 },
    ]);
  });

  it("rounds each coordinate away from zero, and keeps an exact 0", () => {
    // The example of the contract: (2, 2) at 135 degrees is (-4/√2, 0), so (-3, 0).
    expect(toWorld({ x: 2, y: 2 }, at(135))).toEqual({ x: -3, y: 0 });
    expect(toWorld({ x: 0, y: 0 }, at(45, false, { x: 5, y: 7 }))).toEqual({ x: 5, y: 7 });
  });

  it("mirrors first, then turns", () => {
    expect(toWorld({ x: 2, y: 0 }, at(45, true))).toEqual({ x: -2, y: -2 });
  });

  it("toLocal turns back exactly, for the quarter turns as for the diagonals", () => {
    for (const r of [0, 45, 90, 135, 180, 225, 270, 315] as Rotation[]) {
      for (const mirror of [false, true]) {
        const c = at(r, mirror, { x: 3, y: -4 });
        const back = toLocal(toWorld({ x: 1, y: -2 }, c), c);
        if (r % 90 === 0) expect(back).toEqual({ x: 1, y: -2 });
        // On a diagonal the pin was moved out along its own direction from the centre.
        else expect(Math.abs(back.x * -2 - back.y * 1)).toBeLessThan(1e-9);
      }
    }
  });
});

/** A resistor at (10, 10) turned by `rotation`. */
function resistor(rotation: Rotation): PlacedComponent {
  const doc = addComponent(emptyDoc(), {
    type: "resistor",
    position: { x: 10, y: 10 },
    rotation,
    mirror: false,
  }).doc;
  return doc.components[0]!;
}

describe("boxes on a diagonal", () => {
  it("hold the turned symbol and the pins put back on the grid", () => {
    const box = componentBox(resistor(45));
    expect(box).toEqual({ min: { x: 8, y: 8 }, max: { x: 12, y: 12 } });
    expect(symbolRect(resistor(45))).toEqual(box);
    // Quarter turns: unchanged.
    expect(componentBox(resistor(90))).toEqual(symbolRect(resistor(90)));
  });
});

describe("Shift+R: turning by 45 degrees", () => {
  it("turns a two-pin component by 45 degrees, and its wire follows its pin", () => {
    const r = dropComponent("resistor", { x: 0, y: 0 });
    const s = editorState();
    s.startWiring();
    s.wireClick(pinPosition(r, "1"));
    s.wireClick({ x: 0, y: -6 });
    s.wireClick({ x: 0, y: -6 });
    s.setTool({ kind: "select" });
    s.select([r.id]);

    s.rotate(45);
    const turned = editorState().doc.components[0]!;
    expect(turned.rotation).toBe(45);
    const pin = pinPosition(turned, "1");
    expect(pin).toEqual({ x: 2, y: -2 });
    const wire = editorState().doc.wires[0]!;
    expect([wire.from, wire.to]).toContainEqual({ comp: r.id, pin: "1" });

    for (let i = 0; i < 7; i++) editorState().rotate(45);
    expect(editorState().doc.components[0]!.rotation).toBe(0);
  });

  it("goes on from a diagonal by quarter turns with R, and mirrors it with M", () => {
    const r = dropComponent("resistor");
    editorState().select([r.id]);
    editorState().rotate(45);
    editorState().rotate();
    expect(editorState().doc.components[0]!.rotation).toBe(135);
    editorState().mirror();
    expect(editorState().doc.components[0]).toMatchObject({ rotation: 135, mirror: true });
  });

  it("leaves the other components as they are, and says why when none can turn", () => {
    const amp = dropComponent("opamp");
    editorState().select([amp.id]);
    const before = editorState().doc;
    editorState().rotate(45);
    expect(editorState().doc).toBe(before);
    expect(editorState().notice).toBe(DIAGONAL_NOTICE);

    const r = dropComponent("resistor", { x: 20, y: 0 });
    editorState().select([amp.id, r.id]);
    editorState().rotate(45);
    const byId = (id: string) => editorState().doc.components.find((c) => c.id === id)!;
    expect(byId(r.id).rotation).toBe(45);
    expect(byId(amp.id).rotation).toBe(0);
  });

  it("turns the component about to be placed", () => {
    editorState().startPlacing("diode");
    editorState().rotate(45);
    expect(editorState().tool).toMatchObject({ kind: "place", rotation: 45 });
    editorState().placeAt({ x: 4, y: 4 });
    expect(editorState().doc.components[0]!.rotation).toBe(45);
  });
});

describe("a Graetz bridge (#161)", () => {
  /** Four diodes in a diamond, each pin on the next one's, as in a textbook. */
  function bridge(): EditorDoc {
    let doc = emptyDoc();
    const place = (x: number, y: number, rotation: Rotation) => {
      doc = addComponent(doc, { type: "diode", position: { x, y }, rotation, mirror: false }).doc;
    };
    // AC on the left (-4, 0) and right (4, 0) corners; the cathodes go to the top (0, -4), the
    // + of the output, the anodes come from the bottom (0, 4), its -.
    place(-2, -2, 225); // left -> top
    place(2, -2, 135); // right -> top
    place(-2, 2, 135); // bottom -> left
    place(2, 2, 225); // bottom -> right
    return doc;
  }

  it("has all its pins on the grid, on the corners of the diamond", () => {
    const pins = bridge().components.map((c) => [pinPosition(c, "A"), pinPosition(c, "K")]);
    expect(pins).toEqual([
      [
        { x: -4, y: 0 },
        { x: 0, y: -4 },
      ],
      [
        { x: 4, y: 0 },
        { x: 0, y: -4 },
      ],
      [
        { x: 0, y: 4 },
        { x: -4, y: 0 },
      ],
      [
        { x: 0, y: 4 },
        { x: 4, y: 0 },
      ],
    ]);
  });

  it("is saved and opened again with its orientations, and sent to the backend as is", () => {
    const doc = bridge();
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
    expect(toSchematic(doc).components?.map((c) => c.rotation)).toEqual([225, 135, 135, 225]);
  });
});
