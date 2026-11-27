import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import { useElementSize } from "../layout";
import { COLORS, PALETTES, UI, useThemeStore } from "../store";
import {
  CURSOR_COLORS,
  computeCursorReadout,
  computeZoomBounds,
  nearestIndex,
  type CursorReadout,
  type TranPlotData,
} from "./plotData";
import { PLOT_TABLE_CELL } from "./plotStyles";
import { formatAxisTick, formatSI, formatSignedSI } from "./siFormat";

export type InteractionMode = "zoom" | "c1" | "c2";

export interface XRange {
  min: number;
  max: number;
}

const BTN: CSSProperties = {
  fontFamily: "inherit",
  fontWeight: 400,
  fontSize: 12,
  height: 24,
  padding: "0 8px",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: UI.border,
  borderRadius: 4,
  background: UI.surface,
  color: COLORS.text,
  cursor: "pointer",
};

const ACTIVE_BTN: CSSProperties = {
  ...BTN,
  borderColor: COLORS.selected,
  background: UI.activeBackground,
  color: COLORS.selected,
  fontWeight: 600,
};

/** Shared zoom / cursor toolbar used above single and Bode charts. */
export function PlotToolbar({
  mode,
  showCursors,
  onModeChange,
  onResetZoom,
  onToggleCursors,
  resetTitle = "Revenir à la vue complète",
}: {
  mode: InteractionMode;
  showCursors: boolean;
  onModeChange: (mode: InteractionMode) => void;
  onResetZoom: () => void;
  onToggleCursors: () => void;
  resetTitle?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
      }}
    >
      <button
        type="button"
        style={mode === "zoom" ? ACTIVE_BTN : BTN}
        onClick={() => onModeChange("zoom")}
        title="Glisser sur le graphe pour zoomer (ou glisser directement une ligne de curseur)"
      >
        Zoom (glisser)
      </button>
      {showCursors && (
        <>
          <button
            type="button"
            style={
              mode === "c1"
                ? { ...ACTIVE_BTN, borderColor: CURSOR_COLORS.c1, color: CURSOR_COLORS.c1 }
                : BTN
            }
            onClick={() => onModeChange(mode === "c1" ? "zoom" : "c1")}
            title="Cliquer sur le graphe pour placer le curseur 1"
          >
            Placer C1
          </button>
          <button
            type="button"
            style={
              mode === "c2"
                ? { ...ACTIVE_BTN, borderColor: CURSOR_COLORS.c2, color: CURSOR_COLORS.c2 }
                : BTN
            }
            onClick={() => onModeChange(mode === "c2" ? "zoom" : "c2")}
            title="Cliquer sur le graphe pour placer le curseur 2"
          >
            Placer C2
          </button>
        </>
      )}
      <button type="button" style={BTN} onClick={onResetZoom} title={resetTitle}>
        Réinitialiser le zoom
      </button>
      <button
        type="button"
        style={{ ...BTN, marginLeft: "auto" }}
        aria-pressed={showCursors}
        onClick={onToggleCursors}
      >
        {showCursors ? "Masquer les curseurs" : "Afficher les curseurs"}
      </button>
    </div>
  );
}

/** Cursor readout table for single-plot analyses (`.tran`, `.dc`). */
export function CursorReadoutTable({
  xLabel,
  xUnit,
  readout,
}: {
  xLabel: string;
  xUnit: string;
  readout: CursorReadout;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        aria-label="Mesures des curseurs"
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
          background: UI.panel,
          border: `1px solid ${UI.border}`,
          borderRadius: 6,
        }}
      >
        <thead>
          <tr style={{ color: UI.muted }}>
            <th style={{ ...PLOT_TABLE_CELL, textAlign: "left" }}>Signal</th>
            <th style={{ ...PLOT_TABLE_CELL, color: CURSOR_COLORS.c1 }}>Curseur 1</th>
            <th style={{ ...PLOT_TABLE_CELL, color: CURSOR_COLORS.c2 }}>Curseur 2</th>
            <th style={PLOT_TABLE_CELL}>Écart (Δ)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...PLOT_TABLE_CELL, textAlign: "left", fontWeight: 600 }}>{xLabel}</td>
            <td style={PLOT_TABLE_CELL}>{formatSI(readout.x1, xUnit)}</td>
            <td style={PLOT_TABLE_CELL}>{formatSI(readout.x2, xUnit)}</td>
            <td style={PLOT_TABLE_CELL}>
              {formatSignedSI(readout.dx, xUnit)}
              {readout.freqHz !== null ? ` (${formatSI(readout.freqHz, "Hz")})` : ""}
            </td>
          </tr>
          {readout.traces.map((t) => (
            <tr key={t.name}>
              <td style={{ ...PLOT_TABLE_CELL, textAlign: "left" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: t.color,
                    marginRight: 6,
                  }}
                />
                {t.name}
              </td>
              <td style={PLOT_TABLE_CELL}>{t.v1 !== null ? formatSI(t.v1, t.unit) : "—"}</td>
              <td style={PLOT_TABLE_CELL}>{t.v2 !== null ? formatSI(t.v2, t.unit) : "—"}</td>
              <td style={PLOT_TABLE_CELL}>
                {t.delta !== null ? formatSignedSI(t.delta, t.unit) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Draw both vertical cursor lines (`C1`, `C2`), sample dots, and badge labels onto uPlot's canvas.
 */
function drawCursors(
  u: uPlot,
  pxRatio: number,
  plotData: TranPlotData,
  c1Index: number,
  c2Index: number,
  visibleNames: ReadonlySet<string>,
) {
  const { ctx, bbox } = u;
  const x1Val = plotData.xValues[c1Index];
  const x2Val = plotData.xValues[c2Index];

  const drawOne = (xVal: number | undefined, idx: number, color: string, label: string) => {
    if (xVal === undefined) return;
    const xPos = u.valToPos(xVal, "x", true);
    if (xPos < bbox.left || xPos > bbox.left + bbox.width) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, Math.round(1.5 * pxRatio));
    ctx.setLineDash([4 * pxRatio, 3 * pxRatio]);
    ctx.beginPath();
    ctx.moveTo(xPos, bbox.top);
    ctx.lineTo(xPos, bbox.top + bbox.height);
    ctx.stroke();
    ctx.setLineDash([]);

    const fontSize = Math.round(11 * pxRatio);
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    const padX = 4 * pxRatio;
    const tagW = ctx.measureText(label).width + padX * 2;
    const tagH = Math.round(16 * pxRatio);
    const tagX = Math.min(Math.max(xPos - tagW / 2, bbox.left), bbox.left + bbox.width - tagW);
    const tagY = bbox.top + 2 * pxRatio;
    ctx.fillStyle = color;
    ctx.fillRect(tagX, tagY, tagW, tagH);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, tagX + padX, tagY + tagH / 2);

    for (const s of plotData.series) {
      if (!visibleNames.has(s.name)) continue;
      const yVal = plotData.data[s.seriesIndex]?.[idx];
      if (typeof yVal !== "number" || !Number.isFinite(yVal)) continue;
      const yPos = u.valToPos(yVal, s.unit, true);
      if (yPos < bbox.top || yPos > bbox.top + bbox.height) continue;
      ctx.beginPath();
      ctx.arc(xPos, yPos, 3.5 * pxRatio, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 2 * pxRatio;
      ctx.strokeStyle = s.color;
      ctx.stroke();
    }
    ctx.restore();
  };

  drawOne(x1Val, c1Index, CURSOR_COLORS.c1, "C1");
  drawOne(x2Val, c2Index, CURSOR_COLORS.c2, "C2");
}

interface TranChartProps {
  plotData: TranPlotData;
  visibleNames: ReadonlySet<string>;
  height?: number;
  showControls?: boolean;
  showReadout?: boolean;
  xRange?: XRange | null;
  onXRangeChange?: (range: XRange) => void;
  controlledCursors?: {
    showCursors: boolean;
    mode: InteractionMode;
    c1Index: number;
    c2Index: number;
    onCursorChange: (which: "c1" | "c2", idx: number) => void;
  };
}

/**
 * Interactive waveform viewer powered by uPlot with mouse zoom and dual cursors.
 * Supports `.tran`, `.dc`, and single Bode panes (with optional linked zoom and cursors).
 */
export function TranChart({
  plotData,
  visibleNames,
  height = 240,
  showControls = true,
  showReadout = true,
  xRange = null,
  onXRangeChange,
  controlledCursors,
}: TranChartProps) {
  const [boxRef, boxSize] = useElementSize<HTMLDivElement>();
  const chartHostRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const syncingScaleRef = useRef(false);
  const theme = useThemeStore((s) => s.theme);

  const pointCount = plotData.xValues.length;
  const defaultC1 = Math.floor(pointCount * 0.2);
  const defaultC2 = Math.max(defaultC1, Math.floor(pointCount * 0.75));

  const [localShowCursors, setLocalShowCursors] = useState(true);
  const [localMode, setLocalMode] = useState<InteractionMode>("zoom");
  const [localC1, setLocalC1] = useState(defaultC1);
  const [localC2, setLocalC2] = useState(defaultC2);

  const showCursors = controlledCursors ? controlledCursors.showCursors : localShowCursors;
  const mode = controlledCursors ? controlledCursors.mode : localMode;
  const c1Index = controlledCursors ? controlledCursors.c1Index : localC1;
  const c2Index = controlledCursors ? controlledCursors.c2Index : localC2;

  const leftScale = plotData.leftAxis?.scale;
  const rightScale = plotData.rightAxis?.scale;

  const hasVisibleLeft = useMemo(
    () =>
      leftScale !== undefined &&
      plotData.series.some((s) => s.unit === leftScale && visibleNames.has(s.name)),
    [plotData.series, visibleNames, leftScale],
  );
  const hasVisibleRight = useMemo(
    () =>
      rightScale !== undefined &&
      plotData.series.some((s) => s.unit === rightScale && visibleNames.has(s.name)),
    [plotData.series, visibleNames, rightScale],
  );

  // Keep latest interaction state in refs so uPlot hooks/listeners never go stale.
  const stateRef = useRef({
    plotData,
    visibleNames,
    showCursors,
    mode,
    c1Index,
    c2Index,
  });
  const callbacksRef = useRef({
    onXRangeChange,
    onCursorChange: controlledCursors?.onCursorChange,
  });
  useEffect(() => {
    stateRef.current = { plotData, visibleNames, showCursors, mode, c1Index, c2Index };
    callbacksRef.current = {
      onXRangeChange,
      onCursorChange: controlledCursors?.onCursorChange,
    };
  });

  useEffect(() => {
    const host = chartHostRef.current;
    if (!host) return;

    let cancelled = false;
    let teardown: (() => void) | undefined;

    import("uplot").then(({ default: UPlot }) => {
      if (cancelled) return;

      const palette = PALETTES[theme];
      const width = Math.max(260, Math.floor(boxSize.width || host.clientWidth || 480));

      const scales: Record<string, uPlot.Scale> = {
        x: plotData.xLog ? { time: false, distr: 3, log: 10 } : { time: false },
      };
      if (plotData.leftAxis) scales[plotData.leftAxis.scale] = { auto: true };
      if (plotData.rightAxis) scales[plotData.rightAxis.scale] = { auto: true };

      const makeYAxis = (
        meta: NonNullable<TranPlotData["leftAxis"]>,
        side: number,
        show: boolean,
        showGrid: boolean,
      ): uPlot.Axis => ({
        scale: meta.scale,
        side,
        show,
        label: meta.label,
        labelSize: 18,
        size: 62,
        font: "11px system-ui, sans-serif",
        labelFont: "600 11px system-ui, sans-serif",
        stroke: palette.text,
        grid: { show: showGrid, stroke: palette.border, width: 1 },
        ticks: { stroke: palette.inputBorder, width: 1 },
        values: (_u, splits) => splits.map((v) => formatAxisTick(v, meta.scale)),
      });

      // uPlot Axis.Side values (avoid ambient const enum under verbatimModuleSyntax): 1=Right, 2=Bottom, 3=Left.
      const axes: uPlot.Axis[] = [
        {
          scale: "x",
          side: 2,
          label: plotData.xLabel,
          labelSize: 18,
          size: 28,
          font: "11px system-ui, sans-serif",
          labelFont: "600 11px system-ui, sans-serif",
          stroke: palette.text,
          grid: { stroke: palette.border, width: 1 },
          ticks: { stroke: palette.inputBorder, width: 1 },
          values: (_u, splits) => splits.map((v) => formatAxisTick(v, plotData.xUnit)),
        },
      ];
      if (plotData.leftAxis) {
        axes.push(makeYAxis(plotData.leftAxis, 3, hasVisibleLeft, true));
      }
      if (plotData.rightAxis) {
        axes.push(
          makeYAxis(
            plotData.rightAxis,
            plotData.leftAxis ? 1 : 3,
            hasVisibleRight,
            !plotData.leftAxis,
          ),
        );
      }

      const opts: uPlot.Options = {
        width,
        height,
        legend: { show: false },
        padding: [10, 12, 0, 4],
        cursor: {
          x: true,
          y: false,
          drag: { setScale: true, x: true, y: false, dist: 6 },
        },
        scales,
        axes,
        series: [
          {},
          ...plotData.series.map((s) => ({
            label: s.name,
            scale: s.unit,
            stroke: s.color,
            width: 2,
            show: stateRef.current.visibleNames.has(s.name),
            points: { show: false },
          })),
        ],
        hooks: {
          setScale: [
            (u, scaleKey) => {
              if (scaleKey !== "x" || syncingScaleRef.current) return;
              const min = u.scales.x?.min;
              const max = u.scales.x?.max;
              if (min !== undefined && max !== undefined) {
                callbacksRef.current.onXRangeChange?.({ min, max });
              }
            },
          ],
          draw: [
            (u) => {
              const st = stateRef.current;
              if (!st.showCursors) return;
              drawCursors(u, UPlot.pxRatio, st.plotData, st.c1Index, st.c2Index, st.visibleNames);
            },
          ],
        },
      };

      const instance = new UPlot(opts, plotData.data, host);
      uplotRef.current = instance;

      if (xRange) {
        syncingScaleRef.current = true;
        try {
          instance.setScale("x", xRange);
        } finally {
          syncingScaleRef.current = false;
        }
      }

      const over = instance.over;
      let draggingCursor: "c1" | "c2" | null = null;

      const indexFromClientX = (clientX: number): number => {
        const rect = over.getBoundingClientRect();
        const left = Math.min(Math.max(0, clientX - rect.left), rect.width);
        const xVal = instance.posToVal(left, "x");
        return nearestIndex(
          stateRef.current.plotData.xValues,
          xVal,
          stateRef.current.plotData.xLog,
        );
      };

      const setCursorIndex = (which: "c1" | "c2", idx: number) => {
        if (callbacksRef.current.onCursorChange) {
          callbacksRef.current.onCursorChange(which, idx);
        } else if (which === "c1") {
          setLocalC1(idx);
        } else {
          setLocalC2(idx);
        }
      };

      const onMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        const st = stateRef.current;
        const rect = over.getBoundingClientRect();
        const leftCss = e.clientX - rect.left;

        if (st.showCursors && (st.mode === "c1" || st.mode === "c2")) {
          draggingCursor = st.mode;
          setCursorIndex(st.mode, indexFromClientX(e.clientX));
          // Stop immediate propagation so uPlot's own mousedown listener on `over` does not start a drag-zoom.
          e.stopImmediatePropagation();
          e.preventDefault();
          return;
        }

        if (st.showCursors) {
          const x1 = st.plotData.xValues[st.c1Index];
          const x2 = st.plotData.xValues[st.c2Index];
          const d1 = x1 !== undefined ? Math.abs(leftCss - instance.valToPos(x1, "x")) : Infinity;
          const d2 = x2 !== undefined ? Math.abs(leftCss - instance.valToPos(x2, "x")) : Infinity;
          const hitThresholdPx = 8;
          if (Math.min(d1, d2) <= hitThresholdPx) {
            draggingCursor = d1 <= d2 ? "c1" : "c2";
            e.stopImmediatePropagation();
            e.preventDefault();
          }
        }
      };

      const onMouseMove = (e: MouseEvent) => {
        if (!draggingCursor) return;
        setCursorIndex(draggingCursor, indexFromClientX(e.clientX));
      };

      const onMouseUp = () => {
        draggingCursor = null;
      };

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const curMin = instance.scales.x?.min;
        const curMax = instance.scales.x?.max;
        if (curMin === undefined || curMax === undefined) return;
        const rect = over.getBoundingClientRect();
        const leftCss = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
        const anchorX = instance.posToVal(leftCss, "x");
        const factor = e.deltaY < 0 ? 0.8 : 1.25;
        const next = computeZoomBounds(
          curMin,
          curMax,
          stateRef.current.plotData.xMin,
          stateRef.current.plotData.xMax,
          anchorX,
          factor,
          stateRef.current.plotData.xLog,
        );
        instance.setScale("x", next);
      };

      const onDblClick = () => {
        instance.setScale("x", {
          min: stateRef.current.plotData.xMin,
          max: stateRef.current.plotData.xMax,
        });
      };

      over.addEventListener("mousedown", onMouseDown, true);
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      over.addEventListener("wheel", onWheel, { passive: false });
      over.addEventListener("dblclick", onDblClick);

      teardown = () => {
        over.removeEventListener("mousedown", onMouseDown, true);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        over.removeEventListener("wheel", onWheel);
        over.removeEventListener("dblclick", onDblClick);
        instance.destroy();
        uplotRef.current = null;
      };
    });

    return () => {
      cancelled = true;
      teardown?.();
    };
    // Rebuild uPlot only when dataset, height, or theme changes so toggling traces preserves zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotData, height, theme]);

  // Synchronize external X zoom (used to link Bode Gain and Phase charts).
  useEffect(() => {
    const instance = uplotRef.current;
    if (!instance || !xRange) return;
    const curMin = instance.scales.x?.min;
    const curMax = instance.scales.x?.max;
    if (curMin === xRange.min && curMax === xRange.max) return;
    syncingScaleRef.current = true;
    try {
      instance.setScale("x", xRange);
    } finally {
      syncingScaleRef.current = false;
    }
  }, [xRange]);

  // Resize existing uPlot instance smoothly without losing zoom state.
  useEffect(() => {
    const instance = uplotRef.current;
    if (!instance || boxSize.width <= 0) return;
    instance.setSize({ width: Math.max(260, Math.floor(boxSize.width)), height });
  }, [boxSize.width, height]);

  // Toggle individual series and Y-axis visibility, and redraw cursors without losing zoom.
  useEffect(() => {
    const instance = uplotRef.current;
    if (!instance) return;
    if (plotData.leftAxis && instance.axes[1]) {
      instance.axes[1].show = hasVisibleLeft;
    }
    if (plotData.rightAxis) {
      const rightAxisIdx = plotData.leftAxis ? 2 : 1;
      if (instance.axes[rightAxisIdx]) {
        instance.axes[rightAxisIdx].show = hasVisibleRight;
      }
    }
    for (const s of plotData.series) {
      instance.setSeries(s.seriesIndex, { show: visibleNames.has(s.name) }, false);
    }
    instance.redraw(false, true);
  }, [plotData, visibleNames, hasVisibleLeft, hasVisibleRight, showCursors, c1Index, c2Index]);

  const readout = useMemo(
    () => computeCursorReadout(plotData, c1Index, c2Index, visibleNames),
    [plotData, c1Index, c2Index, visibleNames],
  );

  const resetZoom = () => {
    uplotRef.current?.setScale("x", { min: plotData.xMin, max: plotData.xMax });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {showControls && (
        <PlotToolbar
          mode={mode}
          showCursors={showCursors}
          onModeChange={setLocalMode}
          onResetZoom={resetZoom}
          onToggleCursors={() =>
            setLocalShowCursors((prev) => {
              if (prev) setLocalMode("zoom");
              return !prev;
            })
          }
        />
      )}

      <div
        ref={boxRef}
        style={{
          width: "100%",
          minHeight: height,
          border: `1px solid ${UI.border}`,
          borderRadius: 6,
          background: UI.surface,
          overflow: "hidden",
        }}
      >
        <div ref={chartHostRef} />
      </div>

      {showReadout && showCursors && (
        <CursorReadoutTable xLabel={plotData.xLabel} xUnit={plotData.xUnit} readout={readout} />
      )}
    </div>
  );
}
