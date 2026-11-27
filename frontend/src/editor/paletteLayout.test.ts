import { describe, expect, it } from "vitest";

import type { ComponentDef } from "../store";
import {
  entryForKey,
  foldText,
  paletteLayout,
  searchPalette,
  type PaletteGroup,
} from "./paletteLayout";

/** A library component with only what the search reads. */
const def = (type: string, label: string, prefix: string | null): ComponentDef => ({
  type,
  label,
  prefix,
  pins: [],
  params: [],
  category: "passive",
  symbol: [],
});

/** Palette groups of a library with diodes and transistors (the fixture has none). */
const GROUPS: PaletteGroup[] = [
  {
    id: "passive",
    label: "Passifs",
    entries: [{ kind: "place", def: def("resistor", "Résistance", "R") }],
  },
  {
    id: "connection",
    label: "Connexions",
    entries: [{ kind: "place", def: def("ground", "Masse", null) }, { kind: "wire" }],
  },
  {
    id: "semiconductor",
    label: "Semi-conducteurs",
    entries: [
      { kind: "place", def: def("diode", "Diode", "D") },
      { kind: "place", def: def("zener", "Diode Zener", "D") },
      { kind: "place", def: def("npn", "Transistor NPN", "Q") },
    ],
  },
];

const labels = (query: string) =>
  searchPalette(GROUPS, query).flatMap((g) =>
    g.entries.map(({ entry }) => (entry.kind === "wire" ? "Fil" : entry.def.label)),
  );

describe("foldText", () => {
  it("drops the case and the accents", () => {
    expect(foldText("Étiquette de NŒUD")).toBe("etiquette de nœud");
    expect(foldText("Résistance")).toBe("resistance");
  });
});

describe("searchPalette", () => {
  it("keeps everything for an empty query", () => {
    expect(labels("  ")).toHaveLength(6);
  });

  it("matches the name, case and accents ignored", () => {
    expect(labels("zen")).toEqual(["Diode Zener"]);
    expect(labels("resist")).toEqual(["Résistance"]);
    expect(labels("NPN")).toEqual(["Transistor NPN"]);
  });

  it("matches the designator, the category and the wire tool", () => {
    expect(labels("q")).toContain("Transistor NPN");
    expect(labels("semi")).toEqual(["Diode", "Diode Zener", "Transistor NPN"]);
    expect(labels("fil")).toEqual(["Fil"]);
  });

  it("needs every word of the query", () => {
    expect(labels("diode zen")).toEqual(["Diode Zener"]);
  });

  it("drops the groups left empty, and keeps the digit keys of the whole palette", () => {
    const shown = searchPalette(GROUPS, "npn");
    expect(shown.map((g) => g.id)).toEqual(["semiconductor"]);
    expect(shown[0]?.entries[0]?.shortcut).toBe("6");
    expect(searchPalette(GROUPS, "xyz")).toEqual([]);
  });

  it("puts the wire tool after the label, before the switches, so it keeps its digit key", () => {
    const connection = paletteLayout().find((g) => g.id === "connection");
    const kinds = connection?.entries.map((e) => (e.kind === "wire" ? "wire" : e.def.type));
    expect(kinds).toEqual(["ground", "label", "wire", "switch", "push_button"]);
    expect(entryForKey("8")).toEqual({ kind: "wire" });
  });

  it("numbers the real palette like the digit keys do", () => {
    const all = searchPalette(paletteLayout(), "").flatMap((g) => g.entries);
    for (const { entry, shortcut } of all) {
      if (shortcut) expect(entryForKey(shortcut)).toEqual(entry);
    }
  });
});
