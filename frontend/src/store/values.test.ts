import { describe, expect, it } from "vitest";

import { addComponent, emptyDoc, renameComponent, setParam, type EditorDoc } from "./document";
import { getDef, paletteGroups } from "./library";
import { componentProblems, invalidValues, paramProblem, valueProblem } from "./values";

describe("valueProblem", () => {
  it("accepts SPICE numbers, with a suffix and a unit, in any case", () => {
    for (const v of [
      "1",
      "4.7k",
      "10u",
      ".5",
      "-3",
      "1e3",
      "2.2Meg",
      "1kOhm",
      "10uF",
      "5 ",
      "1MEG",
    ]) {
      expect(valueProblem(v), v).toBeNull();
    }
  });

  it("refuses an empty field, text, and a double suffix", () => {
    expect(valueProblem("")).toEqual({ level: "error", message: "La valeur est obligatoire." });
    for (const v of ["abc", "1kk", "10 ohms", "4k7", "k1"]) {
      expect(valueProblem(v)?.level, v).toBe("error");
      expect(valueProblem(v)?.message, v).toMatch(/1k, 10u, 2.2Meg/);
    }
  });

  it("suggests the decimal point for a comma", () => {
    expect(valueProblem("1,5k")).toEqual({
      level: "error",
      message: "Le séparateur décimal est le point, pas la virgule : écris « 1.5k ».",
    });
  });

  it("warns about M (milli) and about F (femto) for a capacitance", () => {
    expect(valueProblem("1M")).toEqual({
      level: "warning",
      message: "« M » veut dire milli en SPICE. Pour méga, écris « 1Meg ».",
    });
    expect(valueProblem("1m")).toBeNull();
    expect(valueProblem("1F", "F")?.level).toBe("warning");
    expect(valueProblem("1F", "Hz")).toBeNull();
    expect(valueProblem("10uF", "F")).toBeNull();
  });

  it("accepts the default value of every parameter of the library", () => {
    for (const group of paletteGroups()) {
      for (const def of group.defs) {
        for (const p of def.params) {
          if (p.kind === "value")
            expect(valueProblem(p.default, p.unit), `${def.type}.${p.name}`).toBeNull();
        }
      }
    }
  });
});

describe("invalidValues", () => {
  it("lists the errors of the document, not the warnings", () => {
    const added = addComponent(emptyDoc(), {
      type: "resistor",
      position: { x: 0, y: 0 },
      rotation: 0,
      mirror: false,
    });
    expect(invalidValues(added.doc)).toEqual([]);
    expect(invalidValues(setParam(added.doc, added.id, "resistance", "1M"))).toEqual([]);
    expect(invalidValues(setParam(added.doc, added.id, "resistance", "abc"))).toEqual([
      {
        comp: added.id,
        name: "R1",
        param: "resistance",
        label: "Résistance",
        message: expect.stringMatching(/non reconnue/),
      },
    ]);
  });
});

describe("componentProblems", () => {
  const place = (doc: EditorDoc, type: string) =>
    addComponent(doc, { type, position: { x: 0, y: 0 }, rotation: 0, mirror: false });

  it("finds nothing in a document with default values", () => {
    const r = place(emptyDoc(), "resistor");
    const g = place(r.doc, "ground");
    expect(componentProblems(place(g.doc, "label").doc)).toEqual([]);
  });

  it("gives one problem per component, errors before warnings", () => {
    const r = place(emptyDoc(), "resistor");
    const c = place(r.doc, "capacitor");
    let doc = setParam(c.doc, r.id, "resistance", "1M");
    doc = setParam(doc, c.id, "capacitance", "abc");
    expect(componentProblems(doc)).toEqual([
      {
        comp: r.id,
        param: "resistance",
        level: "warning",
        message: expect.stringMatching(/milli/),
      },
      {
        comp: c.id,
        param: "capacitance",
        level: "error",
        message: expect.stringMatching(/non reconnue/),
      },
    ]);
    // A wrong name comes before a warning on the value, and is reported with no parameter.
    expect(componentProblems(renameComponent(doc, r.id, "X1"))[0]).toEqual({
      comp: r.id,
      param: null,
      level: "error",
      message: "Le nom doit commencer par « R ».",
    });
  });

  it("checks the node name of a label", () => {
    const l = place(emptyDoc(), "label");
    expect(componentProblems(setParam(l.doc, l.id, "net", "n3"))).toEqual([
      { comp: l.id, param: "net", level: "error", message: expect.stringMatching(/réservé/) },
    ]);
  });
});

describe("paramProblem", () => {
  it("checks numbers, the node name of a label, and never a choice", () => {
    const [resistance] = getDef("resistor").params;
    const [net] = getDef("label").params;
    const waveform = getDef("voltage_source").params.find((p) => p.kind === "choice");
    expect(paramProblem("resistor", resistance!, "10l")?.level).toBe("error");
    expect(paramProblem("resistor", resistance!, "10k")).toBeNull();
    expect(paramProblem("label", net!, "n1")?.message).toMatch(/réservé/);
    expect(paramProblem("label", net!, "out")).toBeNull();
    expect(paramProblem("voltage_source", waveform!, "")).toBeNull();
  });
});
