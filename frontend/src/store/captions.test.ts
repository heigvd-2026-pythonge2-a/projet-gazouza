// Name and value of a component on the schematic (#92): automatic placement, texts moved by
// hand, store actions and file format.

import { beforeEach, describe, expect, it } from "vitest";

import {
  CAPTION_MAX_DISTANCE,
  captionRect,
  captionTexts,
  layoutCaptions,
  moveCaption,
  releaseCoveredCaptions,
  resetCaptions,
  resolveCaptionDrop,
  symbolRect,
  toLocal,
  type Caption,
} from "./captions";
import {
  addComponent,
  emptyDoc,
  rotateComponents,
  toWorld,
  type EditorDoc,
  type GridPoint,
  type GridRect,
  type PlacedComponent,
  type Rotation,
} from "./document";
import { useEditorStore } from "./editorStore";
import { parseDoc, serializeDoc } from "./fileFormat";

const store = () => useEditorStore.getState();

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
});

/** A document with a vertical resistor R1 (1k) at the origin. */
function resistorDoc(): EditorDoc {
  return addComponent(emptyDoc(), {
    type: "resistor",
    position: { x: 0, y: 0 },
    rotation: 0,
    mirror: false,
  }).doc;
}

const r1 = (doc: EditorDoc): PlacedComponent => {
  const c = doc.components[0];
  if (!c) throw new Error("no component");
  return c;
};

function captionsOf(doc: EditorDoc, id = r1(doc).id): Caption[] {
  return layoutCaptions(doc).get(id) ?? [];
}

function caption(doc: EditorDoc, kind: "name" | "value", id = r1(doc).id): Caption {
  const c = captionsOf(doc, id).find((x) => x.kind === kind);
  if (!c) throw new Error(`no ${kind}`);
  return c;
}

/** Whether two boxes overlap (only touching does not count, rounding aside). */
const overlapping = (a: GridRect, b: GridRect, eps = 1e-9) =>
  a.min.x < b.max.x - eps &&
  b.min.x < a.max.x - eps &&
  a.min.y < b.max.y - eps &&
  b.min.y < a.max.y - eps;

/** A free wire between two points (no bend). */
function withWire(doc: EditorDoc, from: GridPoint, to: GridPoint): EditorDoc {
  return {
    ...doc,
    wires: [...doc.wires, { id: `w${doc.wires.length + 1}`, from, to, points: [] }],
  };
}

describe("captionTexts", () => {
  it("gives the name and the main value", () => {
    const texts = captionTexts(r1(resistorDoc()));
    expect(texts.map((t) => t.kind)).toEqual(["name", "value"]);
    expect(texts[0]?.text).toBe("R1");
    expect(texts[1]?.text).toMatch(/^1k/);
  });

  it("gives nothing for the ground and only the net name for a label", () => {
    const ground = addComponent(emptyDoc(), {
      type: "ground",
      position: { x: 0, y: 0 },
      rotation: 0,
      mirror: false,
    }).doc;
    expect(captionTexts(r1(ground))).toEqual([]);
    const label = addComponent(emptyDoc(), {
      type: "label",
      position: { x: 0, y: 0 },
      rotation: 0,
      mirror: false,
    }).doc;
    const c = { ...r1(label), params: { net: "out" } };
    expect(captionTexts(c)).toEqual([{ kind: "name", text: "out" }]);
  });

  it("leaves out an empty text", () => {
    const c = r1(resistorDoc());
    expect(captionTexts({ ...c, params: { ...c.params, resistance: "" } })).toEqual([
      { kind: "name", text: "R1" },
    ]);
  });
});

describe("toLocal", () => {
  it("is the inverse of toWorld for every rotation and mirror", () => {
    const local = { x: 1.5, y: -2 };
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      for (const mirror of [false, true]) {
        const c = { position: { x: 3, y: -4 }, rotation, mirror };
        expect(toLocal(toWorld(local, c), c)).toEqual(local);
      }
    }
  });
});

describe("layoutCaptions: automatic placement", () => {
  it("puts the name above the value, right of a vertical symbol", () => {
    const doc = resistorDoc();
    const symbol = symbolRect(r1(doc));
    const name = caption(doc, "name");
    const value = caption(doc, "value");
    expect(captionRect(name.text, name.centre).min.x).toBeGreaterThan(symbol.max.x);
    expect(name.centre.y).toBeLessThan(value.centre.y);
    expect(name.manual).toBe(false);
  });

  it("puts them above a horizontal symbol", () => {
    const doc = rotateComponents(resistorDoc(), new Set([r1(resistorDoc()).id]));
    const symbol = symbolRect(r1(doc));
    const value = caption(doc, "value");
    expect(captionRect(value.text, value.centre).max.y).toBeLessThan(symbol.min.y);
  });

  it("goes to another side when a wire runs where the texts would be", () => {
    const doc = withWire(resistorDoc(), { x: 1, y: -3 }, { x: 1, y: 3 });
    const symbol = symbolRect(r1(doc));
    for (const c of captionsOf(doc)) {
      expect(captionRect(c.text, c.centre).max.x).toBeLessThan(symbol.min.x);
    }
  });

  it("keeps the first side when every side is taken", () => {
    let doc = resistorDoc();
    doc = withWire(doc, { x: 1, y: -3 }, { x: 1, y: 3 });
    doc = withWire(doc, { x: -1, y: -3 }, { x: -1, y: 3 });
    doc = withWire(doc, { x: -3, y: -3 }, { x: 3, y: -3 });
    doc = withWire(doc, { x: -3, y: 3 }, { x: 3, y: 3 });
    expect(caption(doc, "name").centre).toEqual(caption(resistorDoc(), "name").centre);
  });

  it("does not put two components' texts on top of each other", () => {
    let doc = resistorDoc();
    doc = addComponent(doc, {
      type: "resistor",
      position: { x: 2, y: 0 },
      rotation: 0,
      mirror: false,
    }).doc;
    const [a, b] = doc.components;
    const boxes = [...captionsOf(doc, a?.id), ...captionsOf(doc, b?.id)].map((c) =>
      captionRect(c.text, c.centre),
    );
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlapping(boxes[i]!, boxes[j]!)).toBe(false);
      }
    }
  });
});

describe("texts moved by hand", () => {
  it("are stored in the component's frame and turn with it", () => {
    let doc = resistorDoc();
    const id = r1(doc).id;
    doc = moveCaption(doc, id, "name", { x: 2, y: 1 });
    expect(r1(doc).name_offset).toEqual({ x: 2, y: 1 });
    expect(caption(doc, "name")).toMatchObject({ centre: { x: 2, y: 1 }, manual: true });
    // A quarter turn clockwise: (2, 1) goes to (-1, 2).
    doc = rotateComponents(doc, new Set([id]));
    expect(caption(doc, "name").centre).toEqual({ x: -1, y: 2 });
    // The other text is still placed automatically.
    expect(caption(doc, "value").manual).toBe(false);
  });

  it("follow the component when it moves", () => {
    let doc = moveCaption(resistorDoc(), r1(resistorDoc()).id, "value", { x: -2, y: 0.5 });
    doc = { ...doc, components: [{ ...r1(doc), position: { x: 5, y: 5 } }] };
    expect(caption(doc, "value").centre).toEqual({ x: 3, y: 5.5 });
  });

  it("are flagged when something covers them, without moving", () => {
    let doc = moveCaption(resistorDoc(), r1(resistorDoc()).id, "name", { x: 2, y: 1 });
    expect(caption(doc, "name").overlapping).toBe(false);
    doc = withWire(doc, { x: 2, y: -3 }, { x: 2, y: 3 });
    expect(caption(doc, "name")).toMatchObject({ centre: { x: 2, y: 1 }, overlapping: true });
  });

  it("go back to their automatic place after a turn that makes them cover something", () => {
    const id = r1(resistorDoc()).id;
    let doc = moveCaption(resistorDoc(), id, "name", { x: 2, y: 1 });
    // After a quarter turn the name would be at (-1, 2): a wire runs there.
    doc = withWire(doc, { x: -3, y: 2 }, { x: 0, y: 2 });
    doc = releaseCoveredCaptions(rotateComponents(doc, new Set([id])), new Set([id]));
    expect(r1(doc).name_offset).toBeUndefined();
    // Nothing is covered: the text keeps its place.
    let free = moveCaption(resistorDoc(), id, "name", { x: 2, y: 1 });
    free = releaseCoveredCaptions(rotateComponents(free, new Set([id])), new Set([id]));
    expect(r1(free).name_offset).toEqual({ x: 2, y: 1 });
  });

  it("are put back by resetCaptions", () => {
    const id = r1(resistorDoc()).id;
    let doc = moveCaption(resistorDoc(), id, "name", { x: 2, y: 1 });
    doc = moveCaption(doc, id, "value", { x: 2, y: 2 });
    const reset = resetCaptions(doc, new Set([id]));
    expect(r1(reset).name_offset).toBeUndefined();
    expect(r1(reset).value_offset).toBeUndefined();
    expect(resetCaptions(reset, new Set([id]))).toBe(reset);
    expect(resetCaptions(doc, new Set(["other"]))).toBe(doc);
  });

  it("moveCaption returns the same document when nothing changes", () => {
    const doc = moveCaption(resistorDoc(), r1(resistorDoc()).id, "name", { x: 2, y: 1 });
    expect(moveCaption(doc, r1(doc).id, "name", { x: 2, y: 1 })).toBe(doc);
    expect(moveCaption(doc, "nope", "name", { x: 2, y: 1 })).toBe(doc);
  });
});

describe("resolveCaptionDrop", () => {
  const id = r1(resistorDoc()).id;

  it("snaps to half a grid step", () => {
    expect(resolveCaptionDrop(resistorDoc(), id, "name", { x: 2.27, y: 1.1 })).toEqual({
      x: 2.5,
      y: 1,
    });
  });

  it("moves off the symbol to the nearest free place", () => {
    const doc = resistorDoc();
    const at = resolveCaptionDrop(doc, id, "name", { x: 0, y: 0 });
    expect(at).not.toBeNull();
    const box = captionRect("R1", at!);
    expect(overlapping(box, symbolRect(r1(doc)))).toBe(false);
  });

  it("avoids the other text of the component", () => {
    const doc = resistorDoc();
    const value = caption(doc, "value");
    const at = resolveCaptionDrop(doc, id, "name", value.centre);
    expect(at).not.toBeNull();
    expect(overlapping(captionRect("R1", at!), captionRect(value.text, value.centre))).toBe(false);
  });

  it("does not go further than a few cells from the symbol", () => {
    const doc = resistorDoc();
    expect(resolveCaptionDrop(doc, id, "name", { x: 20, y: 0 })).toBeNull();
    const at = resolveCaptionDrop(doc, id, "name", { x: CAPTION_MAX_DISTANCE + 2, y: 0 });
    expect(at).not.toBeNull();
    expect(captionRect("R1", at!).min.x - symbolRect(r1(doc)).max.x).toBeLessThanOrEqual(
      CAPTION_MAX_DISTANCE,
    );
  });

  it("returns null for an unknown component or text", () => {
    expect(resolveCaptionDrop(resistorDoc(), "nope", "name", { x: 2, y: 0 })).toBeNull();
    const ground = addComponent(emptyDoc(), {
      type: "ground",
      position: { x: 0, y: 0 },
      rotation: 0,
      mirror: false,
    }).doc;
    expect(resolveCaptionDrop(ground, r1(ground).id, "name", { x: 2, y: 0 })).toBeNull();
  });
});

describe("store actions", () => {
  it("moveCaption is one undo step", () => {
    store().openDocument(resistorDoc());
    const id = r1(store().doc).id;
    store().moveCaption(id, "name", { x: 2, y: 1 });
    expect(r1(store().doc).name_offset).toEqual({ x: 2, y: 1 });
    store().undo();
    expect(r1(store().doc).name_offset).toBeUndefined();
    store().redo();
    expect(r1(store().doc).name_offset).toEqual({ x: 2, y: 1 });
  });

  it("resetCaptions applies to the selection", () => {
    store().openDocument(moveCaption(resistorDoc(), r1(resistorDoc()).id, "name", { x: 2, y: 1 }));
    store().resetCaptions();
    expect(r1(store().doc).name_offset).toEqual({ x: 2, y: 1 });
    store().select([r1(store().doc).id]);
    store().resetCaptions();
    expect(r1(store().doc).name_offset).toBeUndefined();
  });

  it("rotate and mirror release a text they make cover something", () => {
    const id = r1(resistorDoc()).id;
    let doc = moveCaption(resistorDoc(), id, "name", { x: 2, y: 1 });
    // Mirrored, the name would be at (-2, 1): a wire runs there.
    doc = withWire(doc, { x: -2, y: -3 }, { x: -2, y: 3 });
    store().openDocument(doc);
    store().select([id]);
    store().mirror();
    expect(r1(store().doc).name_offset).toBeUndefined();
    store().undo();
    store().select([id]);
    store().rotate();
    expect(r1(store().doc).name_offset).toEqual({ x: 2, y: 1 });
  });
});

describe("file format", () => {
  it("saves and reopens the texts moved by hand", () => {
    const doc = moveCaption(resistorDoc(), r1(resistorDoc()).id, "value", { x: -1.5, y: 0.5 });
    expect(r1(parseDoc(serializeDoc(doc))).value_offset).toEqual({ x: -1.5, y: 0.5 });
    expect(r1(parseDoc(serializeDoc(resistorDoc()))).value_offset).toBeUndefined();
  });

  it("ignores an unreadable offset (the text is then placed automatically)", () => {
    const file = JSON.parse(serializeDoc(resistorDoc())) as {
      doc: { components: Record<string, unknown>[] };
    };
    file.doc.components[0]!.name_offset = { x: "2", y: 1 };
    file.doc.components[0]!.value_offset = "left";
    const c = r1(parseDoc(JSON.stringify(file)));
    expect(c.name_offset).toBeUndefined();
    expect(c.value_offset).toBeUndefined();
  });
});
