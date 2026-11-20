import { describe, expect, it } from "vitest";

import { addComponent, addWire, emptyDoc, pinPosition } from "./document";
import { FileFormatError, parseDoc, serializeDoc } from "./fileFormat";
import { fixtureDoc, fixtureNames } from "./testFixtures";

/** A file content with `doc` replaced by `patch` applied to a valid document. */
const fileWith = (patch: (doc: Record<string, unknown>) => unknown, top = {}) => {
  const doc = JSON.parse(JSON.stringify(fixtureDoc("divider_op"))) as Record<string, unknown>;
  return JSON.stringify({ format: "psice-schematic", version: 1, doc: patch(doc), ...top });
};

const expectInvalid = (text: string, detail: RegExp) => {
  expect(() => parseDoc(text)).toThrow(FileFormatError);
  expect(() => parseDoc(text)).toThrow(detail);
};

describe("serializeDoc / parseDoc", () => {
  it.each(fixtureNames())("round-trips the %s fixture", (name) => {
    const doc = fixtureDoc(name);
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it("round-trips a document built by the editor", () => {
    let doc = emptyDoc();
    const r = addComponent(doc, {
      type: "resistor",
      position: { x: 0, y: 0 },
      rotation: 90,
      mirror: true,
    });
    doc = r.doc;
    const c = doc.components[0]!;
    doc = addWire(doc, [pinPosition(c, "1"), { x: 5, y: 0 }, { x: 5, y: 5 }])!.doc;
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it("writes readable JSON ending with a newline", () => {
    const text = serializeDoc(emptyDoc());
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('\n  "format": "psice-schematic"');
  });
});

describe("parseDoc rejects invalid files", () => {
  it("not JSON", () => expectInvalid("{ oops", /pas du JSON/));

  it("another format or version", () => {
    expectInvalid(
      JSON.stringify({ format: "other", version: 1, doc: emptyDoc() }),
      /format inconnu/,
    );
    expectInvalid(
      fileWith((d) => d, { version: 99 }),
      /version 99/,
    );
  });

  it("missing lists", () => {
    expectInvalid(
      fileWith((d) => ({ ...d, wires: undefined })),
      /incomplet/,
    );
  });

  it("unknown component type", () => {
    expectInvalid(
      fileWith((d) => ({
        ...d,
        components: [...(d.components as object[]), { id: "x", type: "bogus", rotation: 0 }],
      })),
      /inconnu « bogus »/,
    );
  });

  it("invalid rotation or position", () => {
    const patchFirst = (patch: object) =>
      fileWith((d) => {
        const [first, ...rest] = d.components as object[];
        return { ...d, components: [{ ...first, ...patch }, ...rest] };
      });
    expectInvalid(patchFirst({ rotation: 45 }), /rotation invalide/);
    expectInvalid(patchFirst({ position: { x: 0.5, y: 0 } }), /position invalide/);
    expectInvalid(patchFirst({ params: { dc: 10 } }), /paramètre dc invalide/);
  });

  it("wires pointing to nothing", () => {
    const withWireEnd = (from: object) =>
      fileWith((d) => {
        const [first, ...rest] = d.wires as object[];
        return { ...d, wires: [{ ...first, from }, ...rest] };
      });
    expectInvalid(withWireEnd({ comp: "nope", pin: "1" }), /composant absent/);
    expectInvalid(withWireEnd({ comp: "c2", pin: "9" }), /broche inconnue/);
    expectInvalid(withWireEnd({ junction: "nope" }), /jonction absente/);
  });

  it("duplicate ids", () => {
    expectInvalid(
      // A free wire that reuses the id of component c1.
      fileWith((d) => ({
        ...d,
        wires: [
          ...(d.wires as object[]),
          { id: "c1", from: { x: 20, y: 0 }, to: { x: 25, y: 0 }, points: [] },
        ],
      })),
      /en double/,
    );
  });
});
