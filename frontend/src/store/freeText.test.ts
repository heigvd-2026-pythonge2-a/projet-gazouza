// Free texts on the schematic (#123): document operations, store actions, file format.

import { beforeEach, describe, expect, it } from "vitest";

import {
  TEXT_MAX_LENGTH,
  addComponent,
  addText,
  copyItems,
  deleteItems,
  docBounds,
  emptyDoc,
  itemsInRect,
  moveItems,
  pasteClip,
  setTextContent,
  textBounds,
} from "./document";
import { NEW_TEXT, PASTE_OFFSET, useEditorStore } from "./editorStore";
import { FileFormatError, parseDoc, serializeDoc } from "./fileFormat";
import { fixtureDoc } from "./testFixtures";

const store = () => useEditorStore.getState();

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
});

/** A document with one resistor and one two-line text at (4, -3). */
function docWithText() {
  const r = addComponent(emptyDoc(), {
    type: "resistor",
    position: { x: 0, y: 0 },
    rotation: 0,
    mirror: false,
  });
  return addText(r.doc, { x: 4, y: -3 }, "Entrée\n10 V");
}

describe("document operations", () => {
  it("adds texts with their own ids, never taken by another item", () => {
    const { doc, id } = docWithText();
    expect(id).toBe("t1");
    expect(addText(doc, { x: 0, y: 0 }, "").id).toBe("t2");
    expect(doc.texts).toEqual([{ id: "t1", position: { x: 4, y: -3 }, content: "Entrée\n10 V" }]);
  });

  it("changes the content, cut to the longest text allowed", () => {
    const { doc, id } = docWithText();
    expect(setTextContent(doc, id, "Sortie").texts[0]?.content).toBe("Sortie");
    const long = setTextContent(doc, id, "x".repeat(TEXT_MAX_LENGTH + 10));
    expect(long.texts[0]?.content).toHaveLength(TEXT_MAX_LENGTH);
    // Nothing changes: the same document, so no undo step.
    expect(setTextContent(doc, id, "Entrée\n10 V")).toBe(doc);
    expect(setTextContent(doc, "t9", "x")).toBe(doc);
  });

  it("estimates the box of a text from its lines", () => {
    const box = textBounds({ id: "t1", position: { x: 4, y: -3 }, content: "ab\nabcd" });
    expect(box.min).toEqual({ x: 4, y: -3 });
    expect(box.max.x).toBeGreaterThan(4);
    expect(box.max.y).toBeGreaterThan(-3 + 1); // two lines
    // The longest line sets the width.
    const shorter = textBounds({ id: "t1", position: { x: 4, y: -3 }, content: "ab" });
    expect(shorter.max.x).toBeLessThan(box.max.x);
  });

  it("moves, copies, pastes and deletes texts like the other items", () => {
    const { doc, id } = docWithText();
    const moved = moveItems(doc, new Set([id]), { x: 1, y: 2 });
    expect(moved.texts[0]?.position).toEqual({ x: 5, y: -1 });
    expect(moved.components).toEqual(doc.components);

    const clip = copyItems(doc, new Set([id]));
    expect(clip.texts).toHaveLength(1);
    const pasted = pasteClip(doc, clip, { x: 2, y: 2 });
    expect(pasted.ids).toEqual(["t2"]);
    expect(pasted.doc.texts[1]).toEqual({
      id: "t2",
      position: { x: 6, y: -1 },
      content: "Entrée\n10 V",
    });

    expect(deleteItems(doc, new Set([id])).texts).toEqual([]);
  });

  it("takes texts into the selection rectangle and the view to fit", () => {
    const { doc, id } = docWithText();
    expect(itemsInRect(doc, { min: { x: 3, y: -4 }, max: { x: 10, y: 0 } })).toEqual([id]);
    // Only partly inside: not selected.
    expect(itemsInRect(doc, { min: { x: 3, y: -4 }, max: { x: 5, y: 0 } })).toEqual([]);
    expect(docBounds(doc)?.min.y).toBe(-3);
    expect(docBounds(addText(emptyDoc(), { x: 2, y: 1 }, "x").doc)?.min).toEqual({ x: 2, y: 1 });
  });
});

describe("store actions", () => {
  it("places a text with the text tool, selects it and goes back to selecting", () => {
    store().startText();
    expect(store().tool).toEqual({ kind: "text" });
    store().placeText({ x: 3, y: 1 });
    expect(store().doc.texts).toEqual([{ id: "t1", position: { x: 3, y: 1 }, content: NEW_TEXT }]);
    expect(store().selection).toEqual(["t1"]);
    expect(store().tool).toEqual({ kind: "select" });
    // Without the text tool, a click places nothing.
    store().placeText({ x: 0, y: 0 });
    expect(store().doc.texts).toHaveLength(1);
  });

  it("makes one undo step of a whole content edit", () => {
    store().startText();
    store().placeText({ x: 0, y: 0 });
    store().sealHistory();
    store().setTextContent("t1", "S");
    store().setTextContent("t1", "So");
    store().setTextContent("t1", "Sortie");
    store().undo();
    expect(store().doc.texts[0]?.content).toBe(NEW_TEXT);
    store().undo();
    expect(store().doc.texts).toEqual([]);
  });

  it("selects, copies, pastes and duplicates texts", () => {
    store().startText();
    store().placeText({ x: 0, y: 0 });
    store().selectAll();
    expect(store().selection).toEqual(["t1"]);

    store().copy();
    store().paste();
    expect(store().doc.texts[1]?.position).toEqual(PASTE_OFFSET);
    expect(store().selection).toEqual(["t2"]);

    store().duplicate();
    expect(store().doc.texts).toHaveLength(3);
    store().deleteSelection();
    expect(store().doc.texts.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("Escape leaves the text tool", () => {
    store().startText();
    store().cancel();
    expect(store().tool).toEqual({ kind: "select" });
  });
});

describe("file format", () => {
  it("saves and opens texts, line breaks included", () => {
    const { doc } = docWithText();
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it("opens a file saved before the free texts", () => {
    const old: Partial<ReturnType<typeof fixtureDoc>> = fixtureDoc("divider_op");
    delete old.texts;
    const file = JSON.stringify({ format: "psice-schematic", version: 1, doc: old });
    expect(parseDoc(file).texts).toEqual([]);
  });

  it.each([
    ["not a list", "x", /textes invalides/],
    ["no content", [{ id: "t1", position: { x: 0, y: 0 } }], /texte invalide/],
    ["off the grid", [{ id: "t1", position: { x: 0.5, y: 0 }, content: "" }], /position/],
    ["too long", [{ id: "t1", position: { x: 0, y: 0 }, content: "x".repeat(2001) }], /trop long/],
    ["same id as a component", [{ id: "c1", position: { x: 0, y: 0 }, content: "" }], /double/],
  ])("rejects texts %s", (_, texts, detail) => {
    const doc = { ...fixtureDoc("divider_op"), texts };
    const file = JSON.stringify({ format: "psice-schematic", version: 1, doc });
    expect(() => parseDoc(file)).toThrow(FileFormatError);
    expect(() => parseDoc(file)).toThrow(detail);
  });
});
