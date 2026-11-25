import { describe, expect, it } from "vitest";

import rcTranResult from "../../../shared/fixtures/rc_tran/result.json";
import type { SimulationResult } from "../api/client";
import {
  buildTranPlotData,
  computeCursorReadout,
  computeZoomBounds,
  nearestIndex,
} from "./plotData";

const rcResult = rcTranResult as SimulationResult;

describe("buildTranPlotData", () => {
  it("builds aligned uPlot data from the rc_tran fixture", () => {
    const plot = buildTranPlotData(rcResult);
    expect(plot).not.toBeNull();
    expect(plot!.xLabel).toBe("Temps (s)");
    expect(plot!.xUnit).toBe("s");
    expect(plot!.xMin).toBe(0);
    expect(plot!.xMax).toBeCloseTo(0.005, 6);
    expect(plot!.hasVoltage).toBe(true);
    expect(plot!.hasCurrent).toBe(true);
    expect(plot!.series.map((s) => s.name)).toEqual(["v(in)", "v(out)", "i(V1)", "i(R1)", "i(C1)"]);
    // Data contains [x, ...5 series], all aligned to the same length.
    expect(plot!.data).toHaveLength(6);
    expect(plot!.data[0]).toHaveLength(plot!.xValues.length);
  });

  it("returns null when axis or traces are missing", () => {
    expect(buildTranPlotData({ analysis: "op", axis: null, traces: [] })).toBeNull();
    expect(
      buildTranPlotData({
        analysis: "tran",
        axis: { name: "time", unit: "s", values: [] },
        traces: [],
      }),
    ).toBeNull();
  });
});

describe("nearestIndex", () => {
  it("finds the closest sample index using binary search", () => {
    const xs = [0, 0.001, 0.002, 0.005];
    expect(nearestIndex(xs, -1)).toBe(0);
    expect(nearestIndex(xs, 0.0004)).toBe(0);
    expect(nearestIndex(xs, 0.0006)).toBe(1);
    expect(nearestIndex(xs, 0.0034)).toBe(2);
    expect(nearestIndex(xs, 0.0036)).toBe(3);
    expect(nearestIndex(xs, 1)).toBe(3);
  });
});

describe("computeCursorReadout", () => {
  it("computes cursor values and deltas for visible traces on rc_tran", () => {
    const plot = buildTranPlotData(rcResult)!;
    const i1 = nearestIndex(plot.xValues, 0.001); // ~tau = 1 ms
    const i2 = nearestIndex(plot.xValues, 0.005); // 5 ms
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
  it("zooms in around the anchor and clamps to data bounds", () => {
    const zoomedIn = computeZoomBounds(0, 10, 0, 10, 2, 0.5);
    expect(zoomedIn.min).toBeCloseTo(1, 6);
    expect(zoomedIn.max).toBeCloseTo(6, 6);

    const zoomedOut = computeZoomBounds(1, 6, 0, 10, 5, 4);
    expect(zoomedOut.min).toBe(0);
    expect(zoomedOut.max).toBe(10);
  });
});
