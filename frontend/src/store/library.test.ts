import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryComponent } from "../api/client";
import {
  LABEL_FLAGS,
  choiceValue,
  getDef,
  isLibraryLoaded,
  loadLibrary,
  mainParam,
  paletteGroups,
  setLibrary,
  symbolBounds,
  symbolOf,
} from "./library";
import { fixtureLibrary } from "./testFixtures";

// The setup file loads the fixture library before each test file: put it back after each test.
afterEach(() => {
  setLibrary(fixtureLibrary());
  vi.restoreAllMocks();
});

describe("setLibrary", () => {
  it("merges the API answer with the editor's symbols and palette groups", () => {
    const resistor = getDef("resistor");
    expect(resistor.label).toBe("Résistance");
    expect(resistor.prefix).toBe("R");
    expect(resistor.pins.map((p) => p.name)).toEqual(["1", "2"]);
    expect(resistor.params[0]?.default).toBe("1k");
    expect(resistor.category).toBe("passive");
    expect(resistor.symbol.length).toBeGreaterThan(0);
  });

  it("keeps the palette order of the editor, not the alphabetical order of the API", () => {
    const groups = paletteGroups().map((g) => [g.id, g.defs.map((d) => d.type)]);
    expect(groups).toEqual([
      ["passive", ["resistor", "capacitor", "inductor"]],
      ["source", ["voltage_source", "current_source"]],
      ["connection", ["ground", "label"]],
      ["semiconductor", ["diode", "zener", "led", "npn", "pnp", "nmos"]],
      ["amplifier", ["opamp", "opamp_real"]],
    ]);
  });

  it("fills in the lists the API may leave out", () => {
    setLibrary([
      {
        type: "resistor",
        label: "Résistance",
        prefix: "R",
        pins: [{ name: "1", x: 0, y: -2 }],
        params: [
          { name: "resistance", label: "Résistance", unit: "Ω", default: "1k", kind: "value" },
        ],
      },
      { type: "ground", label: "Masse", prefix: null, pins: [{ name: "1", x: 0, y: 0 }] },
    ]);
    expect(getDef("resistor").params[0]).toMatchObject({ options: [], waveforms: [] });
    expect(getDef("ground").params).toEqual([]);
  });

  it("leaves out a type the editor cannot draw yet, and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const thyristor: LibraryComponent = {
      type: "thyristor",
      label: "Thyristor",
      prefix: "X",
      pins: [{ name: "A", x: 0, y: -2 }],
    };
    setLibrary([...fixtureLibrary(), thyristor]);
    expect(() => getDef("thyristor")).toThrow("Unknown component type: thyristor");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("thyristor"));
  });

  it("leaves out a symbol the backend does not serve", () => {
    setLibrary(fixtureLibrary().filter((c) => c.type !== "inductor"));
    expect(() => getDef("inductor")).toThrow();
    expect(paletteGroups()[0]?.defs.map((d) => d.type)).toEqual(["resistor", "capacitor"]);
  });
});

// Pins of the semiconductors and op-amps, as the backend library defines them
// (backend/app/netlist/library/*.json). The editor draws the symbols, the backend owns the pins:
// each pin must sit at the end of a lead of the symbol.
const SEMICONDUCTORS: LibraryComponent[] = [
  ...(["diode", "zener", "led"] as const).map((type): LibraryComponent => ({
    type,
    label: type,
    prefix: "D",
    pins: [
      { name: "A", x: 0, y: -2 },
      { name: "K", x: 0, y: 2 },
    ],
  })),
  {
    type: "npn",
    label: "NPN",
    prefix: "Q",
    pins: [
      { name: "C", x: 1, y: -2 },
      { name: "B", x: -2, y: 0 },
      { name: "E", x: 1, y: 2 },
    ],
  },
  {
    type: "pnp",
    label: "PNP",
    prefix: "Q",
    pins: [
      { name: "C", x: 1, y: 2 },
      { name: "B", x: -2, y: 0 },
      { name: "E", x: 1, y: -2 },
    ],
  },
  {
    type: "nmos",
    label: "NMOS",
    prefix: "M",
    pins: [
      { name: "D", x: 1, y: -2 },
      { name: "G", x: -2, y: 0 },
      { name: "S", x: 1, y: 2 },
    ],
  },
  {
    type: "opamp",
    label: "Ampli-op",
    prefix: "X",
    pins: [
      { name: "+", x: -2, y: 1 },
      { name: "-", x: -2, y: -1 },
      { name: "out", x: 2, y: 0 },
    ],
  },
  {
    type: "opamp_real",
    label: "Ampli-op réel",
    prefix: "X",
    pins: [
      { name: "+", x: -2, y: 1 },
      { name: "-", x: -2, y: -1 },
      { name: "out", x: 2, y: 0 },
      { name: "V+", x: 0, y: -2 },
      { name: "V-", x: 0, y: 2 },
    ],
  },
];

describe("semiconductor and op-amp symbols", () => {
  it("are grouped after the basic tools, which keep their digit keys", () => {
    setLibrary([...fixtureLibrary(), ...SEMICONDUCTORS]);
    const groups = paletteGroups().map((g) => [g.id, g.defs.map((d) => d.type)]);
    expect(groups).toEqual([
      ["passive", ["resistor", "capacitor", "inductor"]],
      ["source", ["voltage_source", "current_source"]],
      ["connection", ["ground", "label"]],
      ["semiconductor", ["diode", "zener", "led", "npn", "pnp", "nmos"]],
      ["amplifier", ["opamp", "opamp_real"]],
    ]);
  });

  it.each([...fixtureLibrary(), ...SEMICONDUCTORS].map((c) => [c.type]))(
    "%s: every pin is the end of a line of the symbol",
    (type) => {
      setLibrary([...fixtureLibrary(), ...SEMICONDUCTORS]);
      const def = getDef(type);
      const ends = def.symbol.flatMap((s) =>
        s.kind === "line"
          ? [
              [s.points[0], s.points[1]],
              [s.points.at(-2), s.points.at(-1)],
            ]
          : [],
      );
      for (const pin of def.pins) {
        expect(ends, `${type}, pin ${pin.name}`).toContainEqual([pin.x, pin.y]);
      }
    },
  );
});

describe("label direction", () => {
  it("draws the flag of the label's direction, with no direction when absent or unknown", () => {
    setLibrary(fixtureLibrary());
    const label = getDef("label");
    expect(label.params.find((p) => p.name === "direction")?.default).toBe("auto");
    expect(symbolOf(label, { net: "out" })).toBe(LABEL_FLAGS.none);
    // Automatic is drawn without a direction until the editor works it out (#295).
    expect(symbolOf(label, { net: "out", direction: "auto" })).toBe(LABEL_FLAGS.none);
    expect(symbolOf(label, { net: "out", direction: "output" })).toBe(LABEL_FLAGS.output);
    expect(symbolOf(label, { net: "out", direction: "up" })).toBe(label.symbol);
    expect(symbolOf(getDef("resistor"), { direction: "output" })).toBe(getDef("resistor").symbol);
  });

  it("has a flag for every option, starting at the pin and in the same box", () => {
    setLibrary(fixtureLibrary());
    const label = getDef("label");
    const options = label.params.find((p) => p.name === "direction")?.options ?? [];
    expect(options.map((o) => o.value).sort()).toEqual(
      ["auto", ...Object.keys(LABEL_FLAGS)].sort(),
    );
    for (const { value } of options) {
      const symbol = symbolOf(label, { direction: value });
      expect(symbolBounds({ ...label, symbol }), value).toEqual(symbolBounds(label));
      const [first] = symbol;
      expect(first?.kind === "line" && first.points.slice(0, 2), value).toEqual([0, 0]);
    }
  });
});

describe("choiceValue", () => {
  it("is the value set, else none for an old label, else the default", () => {
    setLibrary(fixtureLibrary());
    const label = getDef("label");
    const direction = label.params.find((p) => p.name === "direction")!;
    expect(choiceValue(label, { direction: "output" }, direction)).toBe("output");
    expect(choiceValue(label, { net: "out" }, direction)).toBe("none");
    const diode = getDef("diode");
    const model = diode.params.find((p) => p.kind === "choice")!;
    expect(choiceValue(diode, {}, model)).toBe(model.default);
  });
});

describe("loadLibrary", () => {
  it("does not ask the backend again once the library is loaded", async () => {
    const fetchLibrary = vi.fn(async () => fixtureLibrary());
    await loadLibrary(fetchLibrary);
    expect(fetchLibrary).not.toHaveBeenCalled();
  });

  it("fetches the library once, and can be retried after a failure", async () => {
    setLibrary([]);
    expect(isLibraryLoaded()).toBe(false);

    const failing = vi.fn(async (): Promise<LibraryComponent[]> => {
      throw new Error("backend down");
    });
    await expect(loadLibrary(failing)).rejects.toThrow("backend down");
    expect(isLibraryLoaded()).toBe(false);

    const working = vi.fn(async () => fixtureLibrary());
    // Two callers at once (React StrictMode, demo) share one request.
    await Promise.all([loadLibrary(working), loadLibrary(working)]);
    expect(working).toHaveBeenCalledTimes(1);
    expect(isLibraryLoaded()).toBe(true);
    expect(getDef("capacitor").label).toBe("Condensateur");
  });
});

describe("mainParam", () => {
  it("is the main value, the node name of a label, or nothing", () => {
    expect(mainParam(getDef("resistor"), {})?.name).toBe("resistance");
    expect(mainParam(getDef("label"), { net: "out" })?.name).toBe("net");
    expect(mainParam(getDef("ground"), {})).toBeNull();
  });

  it("follows the waveform of a source", () => {
    const source = getDef("voltage_source");
    expect(mainParam(source, { waveform: "dc" })?.name).toBe("dc");
    expect(mainParam(source, { waveform: "pulse" })?.name).toBe("v1");
    // The first value of the sine (#165 gave it its own delay, after the frequency).
    expect(mainParam(source, { waveform: "sin" })?.name).toBe("offset");
  });
});
