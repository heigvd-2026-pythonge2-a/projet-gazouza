import { describe, expect, it } from "vitest";

import dcResultJson from "../../../shared/fixtures/loaded_divider_dc/result.json";
import acResultJson from "../../../shared/fixtures/lowpass_ac/result.json";
import rcTranResult from "../../../shared/fixtures/rc_tran/result.json";
import type { SimulationResult } from "../api/client";
import {
  buildBodePlotData,
  buildPlotData,
  computeCursorReadout,
  computeZoomBounds,
  nearestIndex,
} from "./plotData";

const rcResult = rcTranResult as SimulationResult;
const acResult = acResultJson as SimulationResult;
const dcResult = dcResultJson as SimulationResult;

describe("buildPlotData", () => {
  it("builds aligned uPlot data from the rc_tran fixture", () => {
    const plot = buildPlotData(rcResult);
    expect(plot).not.toBeNull();
    expect(plot!.xLabel).toBe("Temps (s)");
    expect(plot!.xUnit).toBe("s");
    expect(plot!.xLog).toBe(false);
    expect(plot!.xMin).toBe(0);
    expect(plot!.xMax).toBeCloseTo(0.005, 6);
    expect(plot!.hasVoltage).toBe(true);
    expect(plot!.hasCurrent).toBe(true);
    expect(plot!.series.map((s) => s.name)).toEqual(["v(in)", "v(out)", "i(V1)", "i(R1)", "i(C1)"]);
    expect(plot!.data).toHaveLength(6);
    expect(plot!.data[0]).toHaveLength(plot!.xValues.length);
  });

  it("builds X-Y data from loaded_divider_dc with swept source on X axis", () => {
    const plot = buildPlotData(dcResult);
    expect(plot).not.toBeNull();
    expect(plot!.xLabel).toBe("V1 (V)");
    expect(plot!.xUnit).toBe("V");
    expect(plot!.xLog).toBe(false);
    expect(plot!.xMin).toBe(0);
    expect(plot!.xMax).toBe(10);
    expect(plot!.series.map((s) => s.name)).toContain("v(n2)");
  });

  it("normalizes descending .dc sweeps to ascending X for uPlot and cursors", () => {
    const descending: SimulationResult = {
      analysis: "dc",
      axis: { name: "V1", unit: "V", values: [10, 5, 0] },
      traces: [{ name: "v(out)", kind: "voltage", unit: "V", net: "out", values: [5, 2.5, 0] }],
    };
    const plot = buildPlotData(descending)!;
    expect(plot.xValues).toEqual([0, 5, 10]);
    expect(plot.data[1]).toEqual([0, 2.5, 5]);
    expect(plot.xMin).toBe(0);
    expect(plot.xMax).toBe(10);
  });

  it("returns null when axis or traces are missing", () => {
    expect(buildPlotData({ analysis: "op", axis: null, traces: [] })).toBeNull();
    expect(
      buildPlotData({
        analysis: "tran",
        axis: { name: "time", unit: "s", values: [] },
        traces: [],
      }),
    ).toBeNull();
  });
});

describe("buildBodePlotData", () => {
  it("computes gain (dB) and phase (°) on lowpass_ac with -3 dB and -45° near 1 kHz", () => {
    const bode = buildBodePlotData(acResult);
    expect(bode).not.toBeNull();
    expect(bode!.gain.xLog).toBe(true);
    expect(bode!.phase.xLog).toBe(true);
    expect(bode!.gain.leftAxis).toEqual({ scale: "dB", label: "Gain (dB)" });
    expect(bode!.phase.leftAxis).toEqual({ scale: "°", label: "Phase (°)" });

    const fcIdx = nearestIndex(bode!.gain.xValues, 1000, true);
    expect(bode!.gain.xValues[fcIdx]).toBeCloseTo(1000, 3);

    const visible = new Set(["v(out)"]);
    const gainReadout = computeCursorReadout(bode!.gain, fcIdx, fcIdx, visible);
    const phaseReadout = computeCursorReadout(bode!.phase, fcIdx, fcIdx, visible);

    expect(gainReadout.traces[0]!.v1).toBeCloseTo(-3.01, 1);
    expect(phaseReadout.traces[0]!.v1).toBeCloseTo(-45, 1);
  });

  it("unwraps phase smoothly across -180°/+180°", () => {
    const acWrap: SimulationResult = {
      analysis: "ac",
      axis: { name: "frequency", unit: "Hz", values: [10, 100, 1000] },
      traces: [
        {
          name: "v(out)",
          kind: "voltage",
          unit: "V",
          net: "out",
          // Angles: -170° -> +170° (wrapped) should unwrap to -190°, then +150° -> -210°.
          values: [
            Math.cos((-170 * Math.PI) / 180),
            Math.cos((170 * Math.PI) / 180),
            Math.cos((150 * Math.PI) / 180),
          ],
          imag: [
            Math.sin((-170 * Math.PI) / 180),
            Math.sin((170 * Math.PI) / 180),
            Math.sin((150 * Math.PI) / 180),
          ],
        },
      ],
    };
    const bode = buildBodePlotData(acWrap)!;
    const phases = bode.phase.data[1] as number[];
    expect(phases[0]).toBeCloseTo(-170, 5);
    expect(phases[1]).toBeCloseTo(-190, 5);
    expect(phases[2]).toBeCloseTo(-210, 5);
  });
});

describe("nearestIndex", () => {
  it("finds the closest sample index using binary search in linear and log space", () => {
    const xs = [0, 0.001, 0.002, 0.005];
    expect(nearestIndex(xs, -1)).toBe(0);
    expect(nearestIndex(xs, 0.0004)).toBe(0);
    expect(nearestIndex(xs, 0.0006)).toBe(1);
    expect(nearestIndex(xs, 0.0034)).toBe(2);
    expect(nearestIndex(xs, 0.0036)).toBe(3);
    expect(nearestIndex(xs, 1)).toBe(3);

    // Geometric midpoint of 10 and 1000 is 100; 90 Hz is closer to 100 in log10 space than linear.
    const freqs = [10, 100, 1000];
    expect(nearestIndex(freqs, 90, true)).toBe(1);
  });
});

describe("computeCursorReadout", () => {
  it("computes cursor values and deltas for visible traces on rc_tran", () => {
    const plot = buildPlotData(rcResult)!;
    const i1 = nearestIndex(plot.xValues, 0.001);
    const i2 = nearestIndex(plot.xValues, 0.005);
    const visible = new Set(["v(in)", "v(out)"]);

    const readout = computeCursorReadout(plot, i1, i2, visible);
    expect(readout.x1).toBeCloseTo(0.001, 4);
    expect(readout.x2).toBeCloseTo(0.005, 4);
    expect(readout.dx).toBeCloseTo(0.004, 4);
    expect(readout.freqHz).toBeCloseTo(250, 0);
    expect(readout.traces.map((t) => t.name)).toEqual(["v(in)", "v(out)"]);

    const vOut = readout.traces.find((t) => t.name === "v(out)")!;
    expect(vOut.v1).toBeGreaterThan(3);
    expect(vOut.v2).toBeGreaterThan(4.9);
    expect(vOut.delta).toBeCloseTo(vOut.v2! - vOut.v1!, 8);
  });
});

describe("computeZoomBounds", () => {
  it("zooms in around the anchor in both linear and log space", () => {
    const zoomedIn = computeZoomBounds(0, 10, 0, 10, 2, 0.5);
    expect(zoomedIn.min).toBeCloseTo(1, 6);
    expect(zoomedIn.max).toBeCloseTo(6, 6);

    const zoomedOut = computeZoomBounds(1, 6, 0, 10, 5, 4);
    expect(zoomedOut.min).toBe(0);
    expect(zoomedOut.max).toBe(10);

    // Log zoom centered on geometric midpoint 1000 over [10, 100000] halves decade span [1, 5] -> [2, 4].
    const logZoom = computeZoomBounds(10, 100_000, 10, 100_000, 1000, 0.5, true);
    expect(logZoom.min).toBeCloseTo(100, 4);
    expect(logZoom.max).toBeCloseTo(10_000, 4);
  });
});
