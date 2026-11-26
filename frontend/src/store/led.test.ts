import { describe, expect, it } from "vitest";

import type { SimulationResult } from "../api/client";
import { addComponent, emptyDoc } from "./document";
import { ledColor, ledIntensities, ledIntensity } from "./led";

describe("ledColor", () => {
  it("follows the model, red by default", () => {
    expect(ledColor({ model: "D_LED_GREEN" })).toBe("#22c55e");
    expect(ledColor({ model: "D_LED_RED" })).toBe("#ef4444");
    expect(ledColor({})).toBe("#ef4444");
    expect(ledColor({ model: "unknown" })).toBe("#ef4444");
  });
});

describe("ledIntensity", () => {
  it("is off in reverse, without current and under 0.1 mA", () => {
    expect(ledIntensity(-5e-3)).toBe(0);
    expect(ledIntensity(0)).toBe(0);
    expect(ledIntensity(5e-5)).toBe(0);
    expect(ledIntensity(Number.NaN)).toBe(0);
  });

  it("grows on a logarithmic scale up to 20 mA", () => {
    expect(ledIntensity(20e-3)).toBe(1);
    expect(ledIntensity(50e-3)).toBe(1);
    // 2 mA is well lit on a log scale (it would look off on a linear one).
    expect(ledIntensity(2e-3)).toBeCloseTo(Math.log(20) / Math.log(200));
    expect(ledIntensity(2e-3)).toBeGreaterThan(0.5);
    expect(ledIntensity(1e-3)).toBeLessThan(ledIntensity(2e-3));
  });
});

describe("ledIntensities", () => {
  const doc = addComponent(emptyDoc(), {
    type: "led",
    position: { x: 0, y: 0 },
    rotation: 0,
    mirror: false,
  }).doc;
  const id = doc.components[0]!.id;
  const trace = (values: number[]) => ({
    name: "i(D1)",
    kind: "current" as const,
    unit: "A" as const,
    component_id: id,
    values,
  });

  it("gives the intensity of each LED of an operating point", () => {
    const result = { analysis: "op", traces: [trace([20e-3])] } as SimulationResult;
    expect(ledIntensities(doc, result)).toEqual(new Map([[id, 1]]));
  });

  it("follows the current in time in a transient result", () => {
    const result = {
      analysis: "tran",
      axis: { name: "time", unit: "s", values: [0, 1] },
      traces: [trace([0, 20e-3])],
    } as SimulationResult;
    expect(ledIntensities(doc, result, 0).get(id)).toBe(0);
    expect(ledIntensities(doc, result, 1).get(id)).toBe(1);
  });

  it("leaves out an LED without current in the result", () => {
    expect(ledIntensities(doc, { analysis: "op", traces: [] } as SimulationResult).size).toBe(0);
  });
});
