// Pure data transformation, cursor math, and zoom helpers for simulation plots.

import type uPlot from "uplot";

import type { SimulationResult } from "../api/client";

/** High-contrast color palette for traces on a white background. */
export const TRACE_COLORS = [
  "#2563eb", // blue
  "#dc2626", // red
  "#16a34a", // green
  "#d97706", // amber
  "#9333ea", // purple
  "#0891b2", // cyan
  "#db2777", // pink
  "#4f46e5", // indigo
] as const;

export const CURSOR_COLORS = {
  c1: "#2563eb",
  c2: "#d97706",
} as const;

export interface PlotSeriesMeta {
  /** Index in `uPlot.AlignedData` (1-based, since index 0 is the X axis). */
  seriesIndex: number;
  name: string;
  kind: "voltage" | "current";
  unit: "V" | "A";
  color: string;
}

export interface TranPlotData {
  xLabel: string;
  xUnit: string;
  xValues: number[];
  series: PlotSeriesMeta[];
  data: uPlot.AlignedData;
  xMin: number;
  xMax: number;
  hasVoltage: boolean;
  hasCurrent: boolean;
}

export interface CursorTraceDelta {
  name: string;
  unit: "V" | "A";
  color: string;
  v1: number | null;
  v2: number | null;
  delta: number | null;
}

export interface CursorReadout {
  x1: number;
  x2: number;
  dx: number;
  freqHz: number | null;
  traces: CursorTraceDelta[];
}

function axisLabelFor(name: string, unit: string): string {
  const label = name === "time" ? "Temps" : name === "frequency" ? "Fréquence" : name;
  return unit ? `${label} (${unit})` : label;
}

/**
 * Convert a `SimulationResult` into aligned arrays and series metadata for uPlot.
 * Returns `null` when there is no axis or no plottable points.
 */
export function buildTranPlotData(result: SimulationResult): TranPlotData | null {
  const traces = result.traces ?? [];
  if (!result.axis || result.axis.values.length === 0 || traces.length === 0) {
    return null;
  }

  const axisValues = result.axis.values;
  let pointCount = axisValues.length;
  for (const trace of traces) {
    pointCount = Math.min(pointCount, trace.values.length);
  }
  if (pointCount === 0) return null;

  const xValues = axisValues.slice(0, pointCount);
  const xMin = xValues[0] ?? 0;
  const xMax = xValues[xValues.length - 1] ?? xMin;

  const series: PlotSeriesMeta[] = [];
  const yArrays: number[][] = [];
  let hasVoltage = false;
  let hasCurrent = false;

  traces.forEach((trace, idx) => {
    const unit = trace.unit;
    if (unit === "V") hasVoltage = true;
    if (unit === "A") hasCurrent = true;
    series.push({
      seriesIndex: idx + 1,
      name: trace.name,
      kind: trace.kind,
      unit,
      color: TRACE_COLORS[idx % TRACE_COLORS.length] ?? "#2563eb",
    });
    yArrays.push(trace.values.slice(0, pointCount));
  });

  return {
    xLabel: axisLabelFor(result.axis.name, result.axis.unit),
    xUnit: result.axis.unit,
    xValues,
    series,
    data: [xValues, ...yArrays],
    xMin,
    xMax,
    hasVoltage,
    hasCurrent,
  };
}

/**
 * Return the index of the sample in sorted ascending `xValues` closest to `targetX`.
 * Returns `0` for single-element or empty arrays.
 */
export function nearestIndex(xValues: readonly number[], targetX: number): number {
  const n = xValues.length;
  if (n <= 1) return 0;
  if (targetX <= (xValues[0] ?? 0)) return 0;
  if (targetX >= (xValues[n - 1] ?? 0)) return n - 1;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((xValues[mid] ?? 0) <= targetX) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const dLo = Math.abs(targetX - (xValues[lo] ?? 0));
  const dHi = Math.abs((xValues[hi] ?? 0) - targetX);
  return dLo <= dHi ? lo : hi;
}

/**
 * Compute cursor 1, cursor 2, and delta (`C2 - C1`) values for all currently visible traces.
 */
export function computeCursorReadout(
  plotData: TranPlotData,
  c1Index: number,
  c2Index: number,
  visibleNames: ReadonlySet<string>,
): CursorReadout {
  const last = Math.max(0, plotData.xValues.length - 1);
  const i1 = Math.min(Math.max(0, c1Index), last);
  const i2 = Math.min(Math.max(0, c2Index), last);

  const x1 = plotData.xValues[i1] ?? 0;
  const x2 = plotData.xValues[i2] ?? 0;
  const dx = x2 - x1;
  const freqHz = dx !== 0 && plotData.xUnit === "s" ? 1 / Math.abs(dx) : null;

  const traces: CursorTraceDelta[] = plotData.series
    .filter((s) => visibleNames.has(s.name))
    .map((s) => {
      const yArr = plotData.data[s.seriesIndex];
      const raw1 = yArr?.[i1];
      const raw2 = yArr?.[i2];
      const v1 = typeof raw1 === "number" && Number.isFinite(raw1) ? raw1 : null;
      const v2 = typeof raw2 === "number" && Number.isFinite(raw2) ? raw2 : null;
      const delta = v1 !== null && v2 !== null ? v2 - v1 : null;
      return {
        name: s.name,
        unit: s.unit,
        color: s.color,
        v1,
        v2,
        delta,
      };
    });

  return { x1, x2, dx, freqHz, traces };
}

/**
 * Compute new `[min, max]` X bounds when zooming by `factor` (< 1 zooms in, > 1 zooms out)
 * around `anchorX`, clamped to `[dataMin, dataMax]`.
 */
export function computeZoomBounds(
  currentMin: number,
  currentMax: number,
  dataMin: number,
  dataMax: number,
  anchorX: number,
  factor: number,
): { min: number; max: number } {
  const fullSpan = dataMax - dataMin;
  if (fullSpan <= 0) return { min: dataMin, max: dataMax };

  const curSpan = currentMax - currentMin;
  if (curSpan <= 0) return { min: dataMin, max: dataMax };

  const minSpan = fullSpan * 1e-6;
  const nextSpan = Math.min(fullSpan, Math.max(minSpan, curSpan * factor));
  const clampedAnchor = Math.min(Math.max(anchorX, currentMin), currentMax);
  const ratio = (clampedAnchor - currentMin) / curSpan;

  let min = clampedAnchor - ratio * nextSpan;
  let max = min + nextSpan;
  if (min < dataMin) {
    min = dataMin;
    max = Math.min(dataMax, min + nextSpan);
  }
  if (max > dataMax) {
    max = dataMax;
    min = Math.max(dataMin, max - nextSpan);
  }
  return { min, max };
}
