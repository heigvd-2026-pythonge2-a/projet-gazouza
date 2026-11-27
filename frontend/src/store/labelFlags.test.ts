// The flag of a node label points away from what it is connected to (#295).

import { beforeEach, describe, expect, it } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import {
  addComponent,
  emptyDoc,
  orientLabels,
  toWorld,
  type EditorDoc,
  type GridPoint,
  type PlacedComponent,
  type Rotation,
} from "./document";

const p = (x: number, y: number): GridPoint => ({ x, y });

beforeEach(resetEditorStore);

/** Where the flag of a label points from its pin. */
function flag(c: PlacedComponent): GridPoint {
  const tip = toWorld({ x: 1, y: 0 }, c);
  return { x: tip.x - c.position.x, y: tip.y - c.position.y };
}

/** A label at the origin turned by `rotation`, with a wire from its pin to `to`. */
function labelWithWire(to: GridPoint, rotation: Rotation = 0, mirror = false): EditorDoc {
  const doc = addComponent(emptyDoc(), { type: "label", position: p(0, 0), rotation, mirror }).doc;
  const id = doc.components[0]!.id;
  return { ...doc, wires: [{ id: "w1", from: { comp: id, pin: "1" }, to, points: [] }] };
}

describe("orientLabels", () => {
  it("turns a flag lying on its wire to the other side, around its pin", () => {
    const out = orientLabels(labelWithWire(p(5, 0)));
    const label = out.components[0]!;
    expect(flag(label)).toEqual(p(-1, 0));
    expect(label.position).toEqual(p(0, 0));
  });

  it("works for a vertical wire and a mirrored label", () => {
    expect(flag(orientLabels(labelWithWire(p(0, -4), 270)).components[0]!)).toEqual(p(0, 1));
    expect(flag(orientLabels(labelWithWire(p(-5, 0), 0, true)).components[0]!)).toEqual(p(1, 0));
  });

  it("leaves a flag already clear of its wire, and a label connected to nothing", () => {
    const clear = labelWithWire(p(0, 4));
    expect(orientLabels(clear)).toBe(clear);
    const alone = addComponent(emptyDoc(), {
      type: "label",
      position: p(0, 0),
      rotation: 180,
      mirror: false,
    }).doc;
    expect(orientLabels(alone)).toBe(alone);
  });

  it("goes clockwise to a free side when the opposite one is taken too", () => {
    const doc = labelWithWire(p(5, 0));
    const id = doc.components[0]!.id;
    const wires = [
      ...doc.wires,
      { id: "w2", from: { comp: id, pin: "1" }, to: p(-5, 0), points: [] },
    ];
    expect(flag(orientLabels({ ...doc, wires }).components[0]!)).toEqual(p(0, 1));
  });
});

describe("node labels in the editor", () => {
  it("points away from a component whose pin it is dropped on", () => {
    // A horizontal resistor from (-2, 0) to (2, 0); a label on its right pin would point into it
    // once turned to the left.
    dropComponent("resistor", p(0, 0));
    editorState().rotate();
    const label = dropComponent("label", p(2, 0));
    expect(flag(editorState().doc.components.find((c) => c.id === label.id)!)).toEqual(p(1, 0));
    editorState().select([label.id]);
    // R goes round the free directions only: down, up, right, never left into the resistor.
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      editorState().rotate();
      const f = flag(editorState().doc.components.find((c) => c.id === label.id)!);
      seen.add(`${f.x},${f.y}`);
    }
    expect([...seen].sort()).toEqual(["0,-1", "0,1", "1,0"]);
  });

  it("turns back a flag mirrored onto its wire", () => {
    const label = dropComponent("label", p(0, 0));
    editorState().startWiring();
    editorState().wireClick(p(0, 0));
    editorState().wireClick(p(-5, 0));
    editorState().wireClick(p(-5, 0));
    editorState().setTool({ kind: "select" });
    editorState().select([label.id]);
    editorState().mirror();
    expect(flag(editorState().doc.components.find((c) => c.id === label.id)!)).toEqual(p(1, 0));
  });
});
