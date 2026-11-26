// Simulation group of the toolbar (#100): the analysis and its settings, the Simulate button; and
// the report of the last simulation shown in the results panel (errors, values).

import { useEffect, useMemo, type CSSProperties } from "react";

import {
  analysisSources,
  chosenSource,
  dcRangeFor,
  diagnosticMarks,
  freshSimulation,
  operatingPointTable,
  useEditorStore,
  type AnalysisKind,
  type AnalysisSettings,
  type AnalysisSource,
  type DiagnosticMark,
  type OperatingPointGroup,
} from "../store";
import { runSimulation } from "./simulationActions";
import { COLORS, UI } from "./theme";
import { showArea } from "./viewCommands";

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
  { kind: "ac", label: "Fréquentielle (.ac)" },
  { kind: "dc", label: "Balayage DC (.dc)" },
];

const LABEL: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 };

/** A setting of the analysis typed as text, with its caption and unit. */
function Field(props: {
  caption: string;
  label: string;
  title: string;
  unit?: string;
  setting: keyof Omit<AnalysisSettings, "kind">;
  placeholder?: string;
  width?: number;
}) {
  const value = useEditorStore((s) => s.analysis[props.setting]);
  const simulating = useEditorStore((s) => s.simulating);
  const setAnalysis = useEditorStore((s) => s.setAnalysis);
  return (
    <label style={LABEL}>
      {props.caption}
      <input
        aria-label={props.label}
        title={props.title}
        placeholder={props.placeholder}
        value={value}
        disabled={simulating}
        onChange={(e) => setAnalysis({ [props.setting]: e.target.value })}
        spellCheck={false}
        style={{ ...CONTROL, width: props.width ?? 56 }}
      />
      {props.unit}
    </label>
  );
}

/** Choice of the source that `.ac` excites or `.dc` sweeps. */
function SourceSelect(props: {
  caption: string;
  label: string;
  title: string;
  sources: AnalysisSource[];
  setting: "acSource" | "dcSource";
}) {
  const value = useEditorStore((s) => s.analysis[props.setting]);
  const simulating = useEditorStore((s) => s.simulating);
  const setAnalysis = useEditorStore((s) => s.setAnalysis);
  const chosen = chosenSource(props.sources, value);
  return (
    <label style={LABEL}>
      {props.caption}
      <select
        aria-label={props.label}
        title={props.sources.length > 0 ? props.title : "Posez d'abord une source sur le schéma"}
        value={chosen?.id ?? ""}
        disabled={simulating || props.sources.length === 0}
        onChange={(e) => {
          const id = e.target.value;
          const unit = props.sources.find((s) => s.id === id)?.unit;
          // A swept source of another unit takes the default range of its unit.
          const range =
            props.setting === "dcSource" && unit
              ? dcRangeFor(useEditorStore.getState().analysis, unit)
              : {};
          setAnalysis({ [props.setting]: id, ...range });
        }}
        style={CONTROL}
      >
        {props.sources.length === 0 && <option value="">aucune source</option>}
        {props.sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Analysis, its settings and the Simulate / Stop button. */
export function SimulationControls() {
  const analysis = useEditorStore((s) => s.analysis);
  const simulating = useEditorStore((s) => s.simulating);
  const setAnalysis = useEditorStore((s) => s.setAnalysis);
  const doc = useEditorStore((s) => s.doc);
  const sources = useMemo(() => analysisSources(doc), [doc]);
  const dcUnit = chosenSource(sources, analysis.dcSource)?.unit ?? "V";

  return (
    <>
      <select
        aria-label="Analyse"
        title="Analyse à lancer"
        value={analysis.kind}
        disabled={simulating}
        onChange={(e) => {
          const kind = e.target.value as AnalysisKind;
          const unit = chosenSource(sources, analysis.dcSource)?.unit;
          // Sweeping a current source: start from milliamperes, not from volts as amperes.
          setAnalysis({ kind, ...(kind === "dc" && unit ? dcRangeFor(analysis, unit) : {}) });
        }}
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
          <Field
            caption="Durée"
            label="Durée de la simulation (s)"
            title="Fin de la simulation, en secondes (10m = 10 ms)"
            unit="s"
            setting="stopTime"
          />
          <Field
            caption="Pas max"
            label="Pas maximal (s)"
            title="Plus grand pas de calcul, en secondes ; vide : automatique"
            unit="s"
            setting="maxStep"
            placeholder="auto"
          />
        </>
      )}
      {analysis.kind === "ac" && (
        <>
          <SourceSelect
            caption="Entrée"
            label="Source d'entrée"
            title="Source qui excite le circuit ; son signal alternatif est réglé automatiquement"
            sources={sources}
            setting="acSource"
          />
          <Field
            caption="De"
            label="Fréquence de début (Hz)"
            title="Première fréquence, en hertz (1k = 1 kHz)"
            unit="Hz"
            setting="acStart"
          />
          <Field
            caption="à"
            label="Fréquence de fin (Hz)"
            title="Dernière fréquence, en hertz (100k = 100 kHz, 1Meg = 1 MHz)"
            unit="Hz"
            setting="acStop"
          />
          <Field
            caption="Points"
            label="Points par décade"
            title="Nombre de points calculés entre une fréquence et dix fois cette fréquence"
            unit="/ déc."
            setting="acPoints"
            width={36}
          />
        </>
      )}
      {analysis.kind === "dc" && (
        <>
          <SourceSelect
            caption="Source"
            label="Source balayée"
            title="Source dont la valeur continue varie pendant le balayage"
            sources={sources}
            setting="dcSource"
          />
          <Field
            caption="De"
            label={`Valeur de début (${dcUnit})`}
            title="Première valeur de la source"
            unit={dcUnit}
            setting="dcStart"
            width={44}
          />
          <Field
            caption="à"
            label={`Valeur de fin (${dcUnit})`}
            title="Dernière valeur de la source"
            unit={dcUnit}
            setting="dcStop"
            width={44}
          />
          <Field
            caption="Pas"
            label={`Pas du balayage (${dcUnit})`}
            title="Écart entre deux valeurs calculées (100m = 0,1)"
            unit={dcUnit}
            setting="dcStep"
            width={44}
          />
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

/**
 * One error or warning of the report. If it points at elements of the schematic (`mark`, #253),
 * it is a link: clicking it shows them on the canvas and selects them.
 */
function DiagnosticItem({ message, mark }: { message: string; mark: DiagnosticMark | undefined }) {
  const select = useEditorStore((s) => s.select);
  if (!mark) return <li>{message}</li>;
  return (
    <li>
      <button
        type="button"
        title="Montrer sur le schéma"
        onClick={() => {
          showArea(mark.bounds);
          select([...mark.components, ...mark.wires, ...mark.junctions]);
        }}
        style={{
          padding: 0,
          border: "none",
          background: "none",
          color: "inherit",
          font: "inherit",
          textAlign: "left",
          textDecoration: "underline dotted",
          textUnderlineOffset: 2,
          cursor: "pointer",
        }}
      >
        {message}
      </button>
    </li>
  );
}

/**
 * Values of an operating point, by group (#292). Hovering a line, or focusing it with the
 * keyboard, highlights its node or component on the schematic.
 */
function OperatingPointTable({ groups }: { groups: OperatingPointGroup[] }) {
  const setReportHighlight = useEditorStore((s) => s.setReportHighlight);
  return (
    <table style={{ borderCollapse: "collapse" }}>
      {groups.map((g) => (
        <tbody key={g.title}>
          <tr>
            <th
              colSpan={2}
              scope="colgroup"
              style={{ padding: "6px 0 2px", textAlign: "left", fontWeight: 600 }}
            >
              {g.title}
            </th>
          </tr>
          {g.rows.map((r) => (
            <tr
              key={r.key}
              tabIndex={r.highlight ? 0 : undefined}
              title={r.highlight ? "Survolez pour le voir sur le schéma" : undefined}
              onMouseEnter={() => setReportHighlight(r.highlight)}
              onMouseLeave={() => setReportHighlight(null)}
              onFocus={() => setReportHighlight(r.highlight)}
              onBlur={() => setReportHighlight(null)}
              style={{ cursor: r.highlight ? "default" : undefined }}
            >
              <td style={{ padding: "1px 12px 1px 0" }}>{r.label}</td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
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
  const nets = useEditorStore((s) => s.simulation?.nets);
  const marks = useMemo(
    () => new Map((result ? diagnosticMarks(doc, result, nets ?? {}) : []).map((m) => [m.key, m])),
    [doc, result, nets],
  );
  const table = useMemo(
    () => (result ? operatingPointTable(doc, result, nets ?? {}) : []),
    [doc, result, nets],
  );
  const setReportHighlight = useEditorStore((s) => s.setReportHighlight);
  // A line hovered when the table goes away (new simulation, edit) must not stay highlighted.
  useEffect(() => () => setReportHighlight(null), [table, setReportHighlight]);

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
  return (
    <div style={{ fontSize: 12 }}>
      {errors.length > 0 && (
        <>
          <p style={{ color: UI.error, fontWeight: 600 }}>La simulation n'a pas pu aboutir :</p>
          <ul style={{ color: UI.error, paddingLeft: 18 }}>
            {errors.map((d, i) => (
              <DiagnosticItem key={i} message={d.message} mark={marks.get(`error:${i}`)} />
            ))}
          </ul>
        </>
      )}
      {warnings.length > 0 && (
        <ul style={{ color: UI.warning, paddingLeft: 18 }}>
          {warnings.map((d, i) => (
            <DiagnosticItem key={i} message={d.message} mark={marks.get(`warning:${i}`)} />
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
          <OperatingPointTable groups={table} />
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
