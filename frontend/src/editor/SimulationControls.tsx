// Simulation group of the toolbar (#100): the analysis and its settings, the Simulate button; and
// the report of the last simulation shown in the results panel (errors, values).

import type { CSSProperties } from "react";

import { formatSI, freshSimulation, useEditorStore, type AnalysisKind } from "../store";
import { runSimulation } from "./simulationActions";
import { COLORS, UI } from "./theme";

const CONTROL: CSSProperties = {
  padding: "4px 8px",
  border: `1px solid ${UI.border}`,
  borderRadius: 5,
  background: UI.surface,
  color: COLORS.text,
  font: "inherit",
  fontSize: 12,
};

const ANALYSES: { kind: AnalysisKind; label: string }[] = [
  { kind: "op", label: "Point de fonctionnement (.op)" },
  { kind: "tran", label: "Transitoire (.tran)" },
];

/** Analysis, its settings and the Simulate / Stop button. */
export function SimulationControls() {
  const analysis = useEditorStore((s) => s.analysis);
  const simulating = useEditorStore((s) => s.simulating);
  const setAnalysis = useEditorStore((s) => s.setAnalysis);

  return (
    <>
      <select
        aria-label="Analyse"
        title="Analyse à lancer"
        value={analysis.kind}
        disabled={simulating}
        onChange={(e) => setAnalysis({ kind: e.target.value as AnalysisKind })}
        style={CONTROL}
      >
        {ANALYSES.map((a) => (
          <option key={a.kind} value={a.kind}>
            Analyse : {a.label}
          </option>
        ))}
      </select>
      {analysis.kind === "tran" && (
        <>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
            Durée
            <input
              aria-label="Durée de la simulation (s)"
              title="Fin de la simulation, en secondes (10m = 10 ms)"
              value={analysis.stopTime}
              disabled={simulating}
              onChange={(e) => setAnalysis({ stopTime: e.target.value })}
              spellCheck={false}
              style={{ ...CONTROL, width: 56 }}
            />
            s
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
            Pas max
            <input
              aria-label="Pas maximal (s)"
              title="Plus grand pas de calcul, en secondes ; vide : automatique"
              placeholder="auto"
              value={analysis.maxStep}
              disabled={simulating}
              onChange={(e) => setAnalysis({ maxStep: e.target.value })}
              spellCheck={false}
              style={{ ...CONTROL, width: 56 }}
            />
            s
          </label>
        </>
      )}
      <button
        type="button"
        title={simulating ? "Arrêter la simulation en cours" : "Lancer la simulation"}
        onClick={() => void runSimulation()}
        style={{
          padding: "5px 12px",
          border: `1px solid ${simulating ? UI.danger : UI.success}`,
          borderRadius: 5,
          background: simulating ? UI.danger : UI.success,
          color: UI.onAccent,
          fontWeight: 600,
          font: "inherit",
          cursor: "pointer",
        }}
      >
        {simulating ? "■ Arrêter" : "▶ Simuler"}
      </button>
    </>
  );
}

/** Errors and warnings of the last simulation, and the values of an operating point. */
export function SimulationReport() {
  const simulating = useEditorStore((s) => s.simulating);
  const error = useEditorStore((s) => s.simulationError);
  const result = useEditorStore(freshSimulation);
  const stale = useEditorStore((s) => s.simulation !== null && freshSimulation(s) === null);
  const doc = useEditorStore((s) => s.doc);
  const showValues = useEditorStore((s) => s.showValues);
  const setShowValues = useEditorStore((s) => s.setShowValues);

  if (simulating) return <p style={{ color: UI.muted }}>Simulation en cours…</p>;
  if (error) return <p style={{ color: UI.error }}>{error}</p>;
  if (stale) {
    return (
      <p style={{ color: UI.muted }}>
        Le schéma a été modifié depuis la dernière simulation : relance-la pour voir les résultats.
      </p>
    );
  }
  if (!result) {
    return <p style={{ color: UI.muted }}>Les courbes s'afficheront ici après une simulation.</p>;
  }
  const errors = result.errors ?? [];
  const warnings = result.warnings ?? [];
  const name = (id: string | null | undefined) =>
    doc.components.find((c) => c.id === id)?.name ?? id ?? "";
  return (
    <div style={{ fontSize: 12 }}>
      {errors.length > 0 && (
        <>
          <p style={{ color: UI.error, fontWeight: 600 }}>La simulation n'a pas pu aboutir :</p>
          <ul style={{ color: UI.error, paddingLeft: 18 }}>
            {errors.map((d, i) => (
              <li key={i}>{d.message}</li>
            ))}
          </ul>
        </>
      )}
      {warnings.length > 0 && (
        <ul style={{ color: UI.warning, paddingLeft: 18 }}>
          {warnings.map((d, i) => (
            <li key={i}>{d.message}</li>
          ))}
        </ul>
      )}
      {errors.length === 0 && result.analysis === "op" && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 6, margin: "6px 0" }}>
            <input
              type="checkbox"
              checked={showValues}
              onChange={(e) => setShowValues(e.target.checked)}
            />
            Afficher les valeurs sur le schéma
          </label>
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {(result.traces ?? []).map((t) => (
                <tr key={t.name}>
                  <td style={{ padding: "1px 12px 1px 0" }}>
                    {t.kind === "voltage"
                      ? `Tension du nœud ${t.net ?? t.name}`
                      : `Courant dans ${name(t.component_id)}`}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {formatSI(t.values[0] ?? 0, t.unit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {errors.length === 0 && result.analysis !== "op" && (
        <p>
          Simulation terminée : {result.axis?.values.length ?? 0} points,{" "}
          {(result.traces ?? []).length} courbes (
          {(result.traces ?? []).map((t) => t.name).join(", ")}).
        </p>
      )}
    </div>
  );
}
