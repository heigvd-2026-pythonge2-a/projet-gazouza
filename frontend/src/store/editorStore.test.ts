import { beforeEach, describe, expect, it } from "vitest";

import type { SimulationResult } from "../api/client";
import { emptyDoc, pinPosition, wirePath, type GridPoint } from "./document";
import { PASTE_OFFSET, freshSimulation, isUnsaved, useEditorStore } from "./editorStore";
import { fixtureDoc, fixtureResult } from "./testFixtures";

const store = () => useEditorStore.getState();

/** Places a resistor through the palette (drag and drop): it is then the selection. */
const dropResistor = (position: GridPoint) => {
  store().dropComponent("resistor", position);
  return store().doc.components.at(-1)!;
};

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
});

describe("placing components", () => {
  it("keeps placing with the place tool, rotated and mirrored as set", () => {
    store().startPlacing("capacitor");
    store().rotate();
    store().mirror();
    store().placeAt({ x: 0, y: 0 });
    store().placeAt({ x: 4, y: 0 });
    const comps = store().doc.components;
    expect(comps.map((c) => c.name)).toEqual(["C1", "C2"]);
    expect(comps.every((c) => c.rotation === 90 && c.mirror)).toBe(true);
    expect(store().tool.kind).toBe("place");
  });

  it("selects a dropped component and goes back to the select tool", () => {
    store().startWiring();
    const c = dropResistor({ x: 2, y: 2 });
    expect(store().selection).toEqual([c.id]);
    expect(store().tool).toEqual({ kind: "select" });
  });

  it("does nothing on placeAt without the place tool", () => {
    store().placeAt({ x: 0, y: 0 });
    expect(store().doc.components).toEqual([]);
  });
});

describe("undo / redo", () => {
  it("restores the document and drops selected items that no longer exist", () => {
    const c = dropResistor({ x: 0, y: 0 });
    expect(store().selection).toEqual([c.id]);
    store().undo();
    expect(store().doc.components).toEqual([]);
    expect(store().selection).toEqual([]);
    store().redo();
    expect(store().doc.components).toHaveLength(1);
  });

  it("makes typing in one field a single step", () => {
    const c = dropResistor({ x: 0, y: 0 });
    const before = store().doc;
    store().sealHistory();
    for (const v of ["2", "22", "22k"]) store().setParam(c.id, "resistance", v);
    expect(store().doc.components[0]!.params.resistance).toBe("22k");
    store().undo();
    expect(store().doc).toBe(before);
  });

  it("starts a new step once another item is selected", () => {
    const c = dropResistor({ x: 0, y: 0 });
    store().setParam(c.id, "resistance", "1");
    store().select([]);
    store().select([c.id]);
    store().setParam(c.id, "resistance", "2");
    store().undo();
    expect(store().doc.components[0]!.params.resistance).toBe("1");
  });

  it("merges a held arrow key into one step", () => {
    const c = dropResistor({ x: 0, y: 0 });
    store().moveSelection({ x: 1, y: 0 }, true);
    store().moveSelection({ x: 1, y: 0 }, true);
    expect(store().doc.components[0]!.position).toEqual({ x: 2, y: 0 });
    store().undo();
    expect(store().doc.components[0]!.position).toEqual(c.position);
  });

  it("records no step for a change that changes nothing", () => {
    const c = dropResistor({ x: 0, y: 0 });
    const steps = store().history.past.length;
    store().moveComponent(c.id, { x: 0, y: 0 });
    store().deleteSelection(); // deletes c: one step
    store().deleteSelection(); // nothing selected any more
    expect(store().history.past.length).toBe(steps + 1);
  });
});

describe("drawing wires", () => {
  it("adds bends on empty points and finishes on a pin", () => {
    const a = dropResistor({ x: 0, y: 0 });
    const b = dropResistor({ x: 6, y: 4 });
    store().startWiring();
    const start = pinPosition(a, "2");
    const end = pinPosition(b, "1");
    store().wireClick(start);
    store().wireClick({ x: 3, y: start.y });
    expect(store().draft?.points).toHaveLength(2);
    store().wireClick(end);

    expect(store().draft).toBeNull();
    const w = store().doc.wires[0]!;
    expect(w.from).toEqual({ comp: a.id, pin: "2" });
    expect(w.to).toEqual({ comp: b.id, pin: "1" });
    expect(store().tool.kind).toBe("wire");
  });

  it("finishes with a free end on a double click", () => {
    store().startWiring();
    store().wireClick({ x: 0, y: 0 });
    store().wireClick({ x: 5, y: 0 });
    store().wireClick({ x: 5, y: 0 });
    expect(wirePath(store().doc, store().doc.wires[0]!)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
  });

  it("goes back to the select tool after a wire started from a pin", () => {
    const a = dropResistor({ x: 0, y: 0 });
    store().startWireFrom(pinPosition(a, "1"));
    store().wireClick({ x: 4, y: -2 });
    store().wireClick({ x: 4, y: -2 });
    expect(store().doc.wires).toHaveLength(1);
    expect(store().tool).toEqual({ kind: "select" });
  });

  it("Escape removes the last bend, then the wire, then leaves the tool", () => {
    store().startWiring();
    store().wireClick({ x: 0, y: 0 });
    store().wireClick({ x: 3, y: 0 });
    store().cancel();
    expect(store().draft?.points).toEqual([{ x: 0, y: 0 }]);
    store().cancel();
    expect(store().draft).toBeNull();
    expect(store().tool.kind).toBe("wire");
    store().cancel();
    expect(store().tool.kind).toBe("select");
    expect(store().doc.wires).toEqual([]);
  });
});

describe("selection, clipboard and deletion", () => {
  it("selects everything and toggles items", () => {
    store().openDocument(fixtureDoc("divider_op"));
    store().selectAll();
    const all = store().selection;
    const doc = store().doc;
    expect(all).toHaveLength(
      doc.components.length + doc.wires.length + doc.junctions.length + doc.texts.length,
    );
    expect(doc.texts.length).toBeGreaterThan(0);
    store().toggleSelected(all[0]!);
    expect(store().selection).toHaveLength(all.length - 1);
    store().toggleSelected(all[0]!);
    expect(store().selection).toHaveLength(all.length);
  });

  it("pastes further each time and selects what was pasted", () => {
    const c = dropResistor({ x: 0, y: 0 });
    store().copy();
    store().paste();
    store().paste();
    const comps = store().doc.components;
    expect(comps.map((x) => x.position)).toEqual([
      c.position,
      { x: PASTE_OFFSET.x, y: PASTE_OFFSET.y },
      { x: 2 * PASTE_OFFSET.x, y: 2 * PASTE_OFFSET.y },
    ]);
    expect(store().selection).toEqual([comps[2]!.id]);
    expect(comps.map((x) => x.name)).toEqual(["R1", "R2", "R3"]);
  });

  it("duplicates without touching the clipboard", () => {
    dropResistor({ x: 0, y: 0 });
    store().duplicate();
    expect(store().doc.components).toHaveLength(2);
    expect(store().clipboard).toBeNull();
  });

  it("deletes a bend selected on its own", () => {
    store().startWiring();
    for (const p of [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: 5 },
    ])
      store().wireClick(p);
    store().setTool({ kind: "select" });
    const wire = store().doc.wires[0]!.id;
    store().selectWirePart({ wire, kind: "bend", index: 1 });
    store().deleteSelection();
    expect(store().wirePart).toBeNull();
    expect(store().doc.wires[0]!.points).toHaveLength(1);
  });
});

describe("files and simulation", () => {
  it("tracks unsaved changes", () => {
    expect(isUnsaved(store())).toBe(false);
    dropResistor({ x: 0, y: 0 });
    expect(isUnsaved(store())).toBe(true);
    store().markSaved(store().doc);
    expect(isUnsaved(store())).toBe(false);
  });

  it("starts the history over on New and Open", () => {
    dropResistor({ x: 0, y: 0 });
    store().newDocument();
    expect(store().doc).toEqual(emptyDoc());
    expect(store().history.past).toEqual([]);
    store().openDocument(fixtureDoc("rc_tran"));
    expect(store().history.past).toEqual([]);
    expect(isUnsaved(store())).toBe(false);
  });

  it("only shows a result while the document it was run on is shown", () => {
    store().openDocument(fixtureDoc("divider_op"));
    const result: SimulationResult = fixtureResult("divider_op");
    store().setAnimation({ on: true });
    store().setSimulation(result);
    expect(freshSimulation(store())).toBe(result);
    expect(store().animation.on).toBe(false);

    store().selectAll();
    store().moveSelection({ x: 1, y: 0 });
    expect(freshSimulation(store())).toBeNull();
    store().undo();
    expect(freshSimulation(store())).toBe(result);
  });
});
