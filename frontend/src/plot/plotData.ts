// Pure data transformation, cursor math, and zoom helpers for simulation plots (.tran, .ac, .dc).

import type uPlot from "uplot";

import type { SimulationResult } from "../api/client";

/** High-contrast color palette for traces on light and dark backgrounds. */
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

export type PlotUnit = "V" | "A" | "dB" | "°";

export interface PlotAxisMeta {
  scale: PlotUnit;
  label: string;
}

export interface PlotSeriesMeta {
  /** Index in `uPlot.AlignedData` (1-based, since index 0 is the X axis). */
  seriesIndex: number;
  name: string;
  kind: "voltage" | "current";
  unit: PlotUnit;
  color: string;
}

export interface TranPlotData {
  xLabel: string;
  xUnit: string;
  xLog: boolean;
  xValues: number[];
  leftAxis: PlotAxisMeta | null;
  rightAxis: PlotAxisMeta | null;
  series: PlotSeriesMeta[];
  data: uPlot.AlignedData;
  xMin: number;
  xMax: number;
  hasVoltage: boolean;
  hasCurrent: boolean;
}

export interface BodePlotData {
  gain: TranPlotData;
  phase: TranPlotData;
}

export interface CursorTraceDelta {
  name: string;
  unit: PlotUnit;
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
 * Align `(x, yArrays)` to a common length and reverse all arrays if `x` is descending
 * (e.g. a decreasing `.dc` sweep), since uPlot and binary search require ascending X.
 */
function normalizeOrderedArrays<T>(
  axisValues: readonly number[],
  yArrays: readonly (readonly T[])[],
): { xValues: number[]; yArrays: T[][] } | null {
  let pointCount = axisValues.length;
  for (const arr of yArrays) {
    pointCount = Math.min(pointCount, arr.length);
  }
  if (pointCount === 0) return null;

  const xValues = axisValues.slice(0, pointCount);
  const alignedY = yArrays.map((arr) => arr.slice(0, pointCount));

  if (pointCount >= 2 && (xValues[pointCount - 1] ?? 0) < (xValues[0] ?? 0)) {
    xValues.reverse();
    for (const arr of alignedY) arr.reverse();
  }
  return { xValues, yArrays: alignedY };
}

/**
 * Convert a `.tran` or `.dc` `SimulationResult` into aligned arrays and series metadata for uPlot.
 * Returns `null` when there is no axis or no plottable points.
 */
export function buildPlotData(result: SimulationResult): TranPlotData | null {
  const traces = result.traces ?? [];
  if (!result.axis || result.axis.values.length === 0 || traces.length === 0) {
    return null;
  }

  const normalized = normalizeOrderedArrays(
    result.axis.values,
    traces.map((t) => t.values),
  );
  if (!normalized) return null;

  const { xValues, yArrays } = normalized;
  const xMin = xValues[0] ?? 0;
  const xMax = xValues[xValues.length - 1] ?? xMin;

  const series: PlotSeriesMeta[] = [];
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
  });

  return {
    xLabel: axisLabelFor(result.axis.name, result.axis.unit),
    xUnit: result.axis.unit,
    xLog: false,
    xValues,
    leftAxis: hasVoltage ? { scale: "V", label: "Tension (V)" } : null,
    rightAxis: hasCurrent ? { scale: "A", label: "Courant (A)" } : null,
    series,
    data: [xValues, ...yArrays],
    xMin,
    xMax,
    hasVoltage,
    hasCurrent,
  };
}

/**
 * Convert an `.ac` `SimulationResult` into linked Gain (dB) and Phase (°) datasets
 * on a logarithmic frequency axis. Phase is unwrapped across adjacent frequencies.
 */
export function buildBodePlotData(result: SimulationResult): BodePlotData | null {
  const traces = result.traces ?? [];
  if (!result.axis || result.axis.values.length === 0 || traces.length === 0) {
    return null;
  }

  let pointCount = result.axis.values.length;
  for (const trace of traces) {
    pointCount = Math.min(pointCount, trace.values.length);
  }
  if (pointCount === 0) return null;

  // Keep only strictly positive frequencies because log10(f) requires f > 0.
  const rawX = result.axis.values.slice(0, pointCount);
  const indices: number[] = [];
  for (let i = 0; i < pointCount; i++) {
    const f = rawX[i];
    if (typeof f === "number" && Number.isFinite(f) && f > 0) indices.push(i);
  }
  if (indices.length === 0) return null;

  if (indices.length >= 2 && (rawX[indices[indices.length - 1]!] ?? 0) < (rawX[indices[0]!] ?? 0)) {
    indices.reverse();
  }

  const xValues = indices.map((i) => rawX[i]!);
  const xMin = xValues[0] ?? 1;
  const xMax = xValues[xValues.length - 1] ?? xMin;
  const xLabel = axisLabelFor(result.axis.name, result.axis.unit);

  const gainArrays: (number | null)[][] = [];
  const phaseArrays: (number | null)[][] = [];
  const gainSeries: PlotSeriesMeta[] = [];
  const phaseSeries: PlotSeriesMeta[] = [];

  traces.forEach((trace, idx) => {
    const color = TRACE_COLORS[idx % TRACE_COLORS.length] ?? "#2563eb";
    const imag = trace.imag ?? [];
    const gains: (number | null)[] = [];
    const phases: (number | null)[] = [];
    let prevPhase: number | null = null;

    for (const i of indices) {
      const re = trace.values[i] ?? 0;
      const im = imag[i] ?? 0;
      const mag = Math.hypot(re, im);
      if (mag <= 0 || !Number.isFinite(mag)) {
        gains.push(null);
        phases.push(null);
        continue;
      }
      gains.push(20 * Math.log10(mag));
      let deg = (Math.atan2(im, re) * 180) / Math.PI;
      if (prevPhase !== null) {
        while (deg - prevPhase > 180) deg -= 360;
        while (deg - prevPhase < -180) deg += 360;
      }
      prevPhase = deg;
      phases.push(deg);
    }

    gainArrays.push(gains);
    phaseArrays.push(phases);
    gainSeries.push({
      seriesIndex: idx + 1,
      name: trace.name,
      kind: trace.kind,
      unit: "dB",
      color,
    });
    phaseSeries.push({
      seriesIndex: idx + 1,
      name: trace.name,
      kind: trace.kind,
      unit: "°",
      color,
    });
  });

  return {
    gain: {
      xLabel,
      xUnit: result.axis.unit,
      xLog: true,
      xValues,
      leftAxis: { scale: "dB", label: "Gain (dB)" },
      rightAxis: null,
      series: gainSeries,
      data: [xValues, ...gainArrays],
      xMin,
      xMax,
      hasVoltage: true,
      hasCurrent: false,
    },
    phase: {
      xLabel,
      xUnit: result.axis.unit,
      xLog: true,
      xValues,
      leftAxis: { scale: "°", label: "Phase (°)" },
      rightAxis: null,
      series: phaseSeries,
      data: [xValues, ...phaseArrays],
      xMin,
      xMax,
      hasVoltage: true,
      hasCurrent: false,
    },
  };
}

/**
 * Return the index of the sample in sorted ascending `xValues` closest to `targetX`.
 * When `log` is true, distances are compared in log10 space (for Bode frequency axes).
 */
export function nearestIndex(xValues: readonly number[], targetX: number, log = false): number {
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
  const xLo = xValues[lo] ?? 0;
  const xHi = xValues[hi] ?? 0;
  if (log && targetX > 0 && xLo > 0 && xHi > 0) {
    const dLo = Math.abs(Math.log10(targetX) - Math.log10(xLo));
    const dHi = Math.abs(Math.log10(xHi) - Math.log10(targetX));
    return dLo <= dHi ? lo : hi;
  }
  return Math.abs(targetX - xLo) <= Math.abs(xHi - targetX) ? lo : hi;
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
 * around `anchorX`, clamped to `[dataMin, dataMax]`. Works in log10 space when `log` is true.
 */
export function computeZoomBounds(
  currentMin: number,
  currentMax: number,
  dataMin: number,
  dataMax: number,
  anchorX: number,
  factor: number,
  log = false,
): { min: number; max: number } {
  if (log && dataMin > 0 && currentMin > 0 && currentMax > 0 && anchorX > 0) {
    const lDataMin = Math.log10(dataMin);
    const lDataMax = Math.log10(dataMax);
    const lCurMin = Math.log10(currentMin);
    const lCurMax = Math.log10(currentMax);
    const lAnchor = Math.log10(anchorX);
    const res = computeZoomBounds(lCurMin, lCurMax, lDataMin, lDataMax, lAnchor, factor, false);
    return { min: 10 ** res.min, max: 10 ** res.max };
  }

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
