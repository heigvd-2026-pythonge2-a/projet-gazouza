import { useMemo, useState } from "react";

import { UI } from "../store";
import { PlotToolbar, TranChart, type InteractionMode, type XRange } from "./TranChart";
import {
  CURSOR_COLORS,
  PLOT_TABLE_CELL,
  computeCursorReadout,
  type BodePlotData,
} from "./plotData";
import { formatSI, formatSignedSI } from "./siFormat";

interface BodeChartProps {
  bode: BodePlotData;
  visibleNames: ReadonlySet<string>;
}

/**
 * Linked Bode diagram for `.ac` analysis: Gain (dB) above Phase (°) on a logarithmic
 * frequency axis, sharing zoom and dual cursors across both charts.
 */
export function BodeChart({ bode, visibleNames }: BodeChartProps) {
  const pointCount = bode.gain.xValues.length;
  const defaultC1 = Math.floor(pointCount * 0.2);
  const defaultC2 = Math.max(defaultC1, Math.floor(pointCount * 0.75));

  const [showCursors, setShowCursors] = useState(true);
  const [mode, setMode] = useState<InteractionMode>("zoom");
  const [c1Index, setC1Index] = useState(defaultC1);
  const [c2Index, setC2Index] = useState(defaultC2);
  const [xRange, setXRange] = useState<XRange>({
    min: bode.gain.xMin,
    max: bode.gain.xMax,
  });

  const handleCursorChange = (which: "c1" | "c2", idx: number) => {
    if (which === "c1") setC1Index(idx);
    else setC2Index(idx);
  };

  const controlledCursors = useMemo(
    () => ({
      showCursors,
      mode,
      c1Index,
      c2Index,
      onCursorChange: handleCursorChange,
    }),
    [showCursors, mode, c1Index, c2Index],
  );

  const gainReadout = useMemo(
    () => computeCursorReadout(bode.gain, c1Index, c2Index, visibleNames),
    [bode.gain, c1Index, c2Index, visibleNames],
  );
  const phaseReadout = useMemo(
    () => computeCursorReadout(bode.phase, c1Index, c2Index, visibleNames),
    [bode.phase, c1Index, c2Index, visibleNames],
  );

  const resetZoom = () => {
    setXRange({ min: bode.gain.xMin, max: bode.gain.xMax });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <PlotToolbar
        mode={mode}
        showCursors={showCursors}
        onModeChange={setMode}
        onResetZoom={resetZoom}
        onToggleCursors={() =>
          setShowCursors((prev) => {
            if (prev) setMode("zoom");
            return !prev;
          })
        }
        resetTitle="Revenir à toute la plage de fréquences"
      />

      <TranChart
        plotData={bode.gain}
        visibleNames={visibleNames}
        height={175}
        showControls={false}
        showReadout={false}
        xRange={xRange}
        onXRangeChange={setXRange}
        controlledCursors={controlledCursors}
      />

      <TranChart
        plotData={bode.phase}
        visibleNames={visibleNames}
        height={175}
        showControls={false}
        showReadout={false}
        xRange={xRange}
        onXRangeChange={setXRange}
        controlledCursors={controlledCursors}
      />

      {showCursors && (
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
                <th style={{ ...PLOT_TABLE_CELL, textAlign: "left" }}>Grandeur</th>
                <th style={{ ...PLOT_TABLE_CELL, color: CURSOR_COLORS.c1 }}>Curseur 1</th>
                <th style={{ ...PLOT_TABLE_CELL, color: CURSOR_COLORS.c2 }}>Curseur 2</th>
                <th style={PLOT_TABLE_CELL}>Écart (Δ)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ ...PLOT_TABLE_CELL, textAlign: "left", fontWeight: 600 }}>
                  {bode.gain.xLabel}
                </td>
                <td style={{ ...PLOT_TABLE_CELL, textAlign: "left" }}>f</td>
                <td style={PLOT_TABLE_CELL}>{formatSI(gainReadout.x1, "Hz")}</td>
                <td style={PLOT_TABLE_CELL}>{formatSI(gainReadout.x2, "Hz")}</td>
                <td style={PLOT_TABLE_CELL}>{formatSignedSI(gainReadout.dx, "Hz")}</td>
              </tr>
              {gainReadout.traces.map((g, idx) => {
                const p = phaseReadout.traces[idx];
                return <BodeTraceRows key={g.name} gain={g} phase={p} />;
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BodeTraceRows({
  gain,
  phase,
}: {
  gain: BodePlotData["gain"] extends never
    ? never
    : ReturnType<typeof computeCursorReadout>["traces"][number];
  phase: ReturnType<typeof computeCursorReadout>["traces"][number] | undefined;
}) {
  return (
    <>
      <tr>
        <td style={{ ...PLOT_TABLE_CELL, textAlign: "left" }}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: gain.color,
              marginRight: 6,
            }}
          />
          {gain.name}
        </td>
        <td style={{ ...PLOT_TABLE_CELL, textAlign: "left", color: UI.muted }}>Gain</td>
        <td style={PLOT_TABLE_CELL}>{gain.v1 !== null ? formatSI(gain.v1, "dB") : "—"}</td>
        <td style={PLOT_TABLE_CELL}>{gain.v2 !== null ? formatSI(gain.v2, "dB") : "—"}</td>
        <td style={PLOT_TABLE_CELL}>
          {gain.delta !== null ? formatSignedSI(gain.delta, "dB") : "—"}
        </td>
      </tr>
      {phase && (
        <tr>
          <td style={{ ...PLOT_TABLE_CELL, textAlign: "left", color: UI.muted }} />
          <td style={{ ...PLOT_TABLE_CELL, textAlign: "left", color: UI.muted }}>Phase</td>
          <td style={PLOT_TABLE_CELL}>{phase.v1 !== null ? formatSI(phase.v1, "°") : "—"}</td>
          <td style={PLOT_TABLE_CELL}>{phase.v2 !== null ? formatSI(phase.v2, "°") : "—"}</td>
          <td style={PLOT_TABLE_CELL}>
            {phase.delta !== null ? formatSignedSI(phase.delta, "°") : "—"}
          </td>
        </tr>
      )}
    </>
  );
}
