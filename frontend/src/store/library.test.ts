import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryComponent } from "../api/client";
import { getDef, isLibraryLoaded, loadLibrary, paletteGroups, setLibrary } from "./library";
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
    const diode: LibraryComponent = {
      type: "diode",
      label: "Diode",
      prefix: "D",
      pins: [{ name: "A", x: 0, y: -2 }],
    };
    setLibrary([...fixtureLibrary(), diode]);
    expect(() => getDef("diode")).toThrow("Unknown component type: diode");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("diode"));
  });

  it("leaves out a symbol the backend does not serve", () => {
    setLibrary(fixtureLibrary().filter((c) => c.type !== "inductor"));
    expect(() => getDef("inductor")).toThrow();
    expect(paletteGroups()[0]?.defs.map((d) => d.type)).toEqual(["resistor", "capacitor"]);
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
