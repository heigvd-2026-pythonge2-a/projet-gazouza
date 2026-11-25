import { useMemo, useState } from "react";

import type { SimulationResult } from "../api/client";
import { COLORS, UI, useEditorStore } from "../store";
import { TranChart } from "./TranChart";
import { buildTranPlotData, type TranPlotData } from "./plotData";
import { formatSI } from "./siFormat";

function DiagnosticsList({ result }: { result: SimulationResult }) {
  const errors = result.errors ?? [];
  const warnings = result.warnings ?? [];
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
      {errors.map((err, idx) => (
        <div
          key={`err-${idx}`}
          role="alert"
          style={{
            padding: "6px 8px",
            borderRadius: 4,
            border: `1px solid ${UI.error}`,
            background: UI.errorBackground,
            color: UI.error,
          }}
        >
          <strong>Erreur :</strong> {err.message}
        </div>
      ))}
      {warnings.map((warn, idx) => (
        <div
          key={`warn-${idx}`}
          style={{
            padding: "6px 8px",
            borderRadius: 4,
            border: `1px solid ${UI.warning}`,
            background: UI.warningBackground,
            color: UI.warning,
          }}
        >
          <strong>Avertissement :</strong> {warn.message}
        </div>
      ))}
    </div>
  );
}

function OperatingPointTable({ result }: { result: SimulationResult }) {
  const traces = result.traces ?? [];
  if (traces.length === 0) {
    return <p style={{ color: UI.muted }}>Aucun point de fonctionnement calculé.</p>;
  }
  return (
    <table
      aria-label="Point de fonctionnement"
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 12,
        background: UI.panel,
        border: `1px solid ${UI.border}`,
      }}
    >
      <thead>
        <tr style={{ color: UI.muted }}>
          <th
            style={{
              padding: "4px 8px",
              textAlign: "left",
              borderBottom: `1px solid ${UI.border}`,
            }}
          >
            Grandeur
          </th>
          <th
            style={{
              padding: "4px 8px",
              textAlign: "right",
              borderBottom: `1px solid ${UI.border}`,
            }}
          >
            Valeur
          </th>
        </tr>
      </thead>
      <tbody>
        {traces.map((trace) => {
          const val = trace.values[0];
          return (
            <tr key={trace.name}>
              <td style={{ padding: "4px 8px", borderBottom: `1px solid ${UI.border}` }}>
                {trace.name}
              </td>
              <td
                style={{
                  padding: "4px 8px",
                  textAlign: "right",
                  borderBottom: `1px solid ${UI.border}`,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {typeof val === "number" ? formatSI(val, trace.unit) : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TranPlotSection({ plotData }: { plotData: TranPlotData }) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const visibleNames = new Set(
    plotData.series.map((s) => s.name).filter((name) => !hidden.has(name)),
  );

  const toggleTrace = (name: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <>
      <div
        role="group"
        aria-label="Traces affichées"
        style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 12 }}
      >
        {plotData.series.map((s) => {
          const checked = visibleNames.has(s.name);
          return (
            <label
              key={s.name}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 8px",
                borderRadius: 999,
                border: `1px solid ${checked ? s.color : UI.border}`,
                background: checked ? UI.surface : UI.panel,
                color: checked ? COLORS.text : UI.muted,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleTrace(s.name)}
                style={{ margin: 0, accentColor: s.color }}
              />
              <span
                style={{
                  width: 10,
                  height: 3,
                  borderRadius: 2,
                  background: s.color,
                  opacity: checked ? 1 : 0.35,
                }}
              />
              <span>{s.name}</span>
            </label>
          );
        })}
      </div>
      <TranChart
        key={`${plotData.xValues.length}:${plotData.xMin}:${plotData.xMax}`}
        plotData={plotData}
        visibleNames={visibleNames}
      />
    </>
  );
}

/**
 * Main Results panel content: displays simulation waveforms, trace legend, cursors and diagnostics.
 */
export function PlotPanel() {
  const simulation = useEditorStore((s) => s.simulation);
  const doc = useEditorStore((s) => s.doc);

  const result = simulation?.result ?? null;
  const isStale = simulation !== null && simulation.doc !== doc;

  const plotData = useMemo(() => (result ? buildTranPlotData(result) : null), [result]);
  const traceKey = plotData?.series.map((s) => s.name).join("\0") ?? "";

  if (!result) {
    return <p style={{ color: UI.muted }}>Les courbes s'afficheront ici après une simulation.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      {isStale && (
        <div
          style={{
            padding: "4px 8px",
            borderRadius: 4,
            border: `1px solid ${UI.border}`,
            background: UI.panel,
            color: UI.muted,
            fontSize: 12,
          }}
        >
          Le schéma a été modifié depuis cette simulation.
        </div>
      )}

      <DiagnosticsList result={result} />

      {result.analysis === "op" && <OperatingPointTable result={result} />}

      {result.analysis === "tran" && plotData && (
        <TranPlotSection key={traceKey} plotData={plotData} />
      )}

      {result.analysis === "tran" && !plotData && (result.errors ?? []).length === 0 && (
        <p style={{ color: UI.muted }}>Aucune courbe à afficher.</p>
      )}

      {result.analysis !== "op" && result.analysis !== "tran" && (
        <p style={{ color: UI.muted }}>
          L'affichage des courbes d'analyse .{result.analysis} est à venir.
        </p>
      )}
    </div>
  );
}
