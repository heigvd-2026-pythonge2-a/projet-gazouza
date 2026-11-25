import { describe, expect, it } from "vitest";

import { formatAxisTick, formatSI, formatSignedSI } from "./siFormat";

describe("formatSI", () => {
  it("formats zero cleanly with unit", () => {
    expect(formatSI(0, "s")).toBe("0 s");
    expect(formatSI(0, "V")).toBe("0 V");
    expect(formatSI(0, "")).toBe("0");
  });

  it("picks appropriate SI prefixes across scales", () => {
    expect(formatSI(0.005, "s")).toBe("5 ms");
    expect(formatSI(1.5e-6, "s")).toBe(
      "1.5 µs".replace(".", formatSI(1.5, "").includes(",") ? "," : "."),
    );
    expect(formatSI(-0.0025, "A")).toMatch(/^-2[.,]5 mA$/);
    expect(formatSI(1000, "Hz")).toBe("1 kHz");
    expect(formatSI(2.5e6, "Hz")).toMatch(/^2[.,]5 MHz$/);
  });

  it("handles non-finite values", () => {
    expect(formatSI(Number.NaN, "V")).toBe("—");
    expect(formatSI(Number.POSITIVE_INFINITY, "V")).toBe("—");
  });
});

describe("formatSignedSI", () => {
  it("adds + sign only for strictly positive values", () => {
    expect(formatSignedSI(0.001, "s")).toBe("+1 ms");
    expect(formatSignedSI(-0.001, "s")).toBe("-1 ms");
    expect(formatSignedSI(0, "V")).toBe("0 V");
  });
});

describe("formatAxisTick", () => {
  it("uses compact precision for axis ticks", () => {
    expect(formatAxisTick(0.002346, "s")).toMatch(/^2[.,]35 ms$/);
  });
});
