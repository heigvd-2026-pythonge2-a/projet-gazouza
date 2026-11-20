import { useId, type CSSProperties } from "react";

import {
  getDef,
  nameProblem,
  netNameProblem,
  useEditorStore,
  visibleParams,
  type ParamOption,
  type PlacedComponent,
} from "../store";
import { COLORS, UI } from "./theme";

const controlStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "5px 8px",
  border: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  outline: "none",
};

function Field(props: {
  label: string;
  value: string;
  unit?: string;
  /** For a "choice" parameter: a drop-down list instead of a text field. */
  options?: ParamOption[];
  problem?: string | null;
  onChange: (value: string) => void;
}) {
  const { label, value, unit, options, problem, onChange } = props;
  const id = useId();
  return (
    <div style={{ marginBottom: 10 }}>
      <label
        htmlFor={id}
        style={{ display: "block", fontSize: 12, color: "#4b5563", marginBottom: 3 }}
      >
        {label}
      </label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          border: `1px solid ${problem ? UI.error : "#d1d5db"}`,
          borderRadius: 4,
          background: "#ffffff",
        }}
      >
        {options ? (
          <select
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={controlStyle}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            aria-invalid={problem ? true : undefined}
            style={controlStyle}
          />
        )}
        {unit && <span style={{ padding: "0 8px", color: "#9ca3af" }}>{unit}</span>}
      </div>
      {problem && <p style={{ margin: "3px 0 0", fontSize: 12, color: UI.error }}>{problem}</p>}
    </div>
  );
}

function ComponentProperties({ component: c }: { component: PlacedComponent }) {
  const doc = useEditorStore((s) => s.doc);
  const renameComponent = useEditorStore((s) => s.renameComponent);
  const setParam = useEditorStore((s) => s.setParam);
  const def = getDef(c.type);
  const params = visibleParams(def, c.params);
  const hasValues = params.some((p) => p.kind === "value");

  return (
    <>
      <h3 style={UI.heading}>
        {def.label}
        {c.name && <span style={{ textTransform: "none" }}> — {c.name}</span>}
      </h3>
      {def.prefix !== null && (
        <Field
          label="Nom"
          value={c.name ?? ""}
          problem={nameProblem(doc, c, def.prefix)}
          onChange={(name) => renameComponent(c.id, name)}
        />
      )}
      {params.map((p) => {
        const value = c.params[p.name] ?? "";
        return (
          <Field
            key={p.name}
            label={p.label}
            value={value}
            unit={p.unit}
            options={p.kind === "choice" ? p.options : undefined}
            problem={c.type === "label" && p.name === "net" ? netNameProblem(value) : null}
            onChange={(v) => setParam(c.id, p.name, v)}
          />
        );
      })}
      {def.params.length === 0 && (
        <p style={{ fontSize: 12, color: UI.muted }}>Ce composant n'a pas de paramètre.</p>
      )}
      {hasValues && (
        <p style={{ fontSize: 12, color: UI.muted, lineHeight: 1.5 }}>
          Suffixes : p, n, u (micro), m (milli), k, Meg (méga), G.
          <br />
          Attention : « M » veut dire milli, pas méga.
        </p>
      )}
    </>
  );
}

/** Properties of the selected component, editable. */
export function Inspector() {
  const doc = useEditorStore((s) => s.doc);
  const selection = useEditorStore((s) => s.selection);

  const selected =
    selection.length === 1 ? doc.components.find((c) => c.id === selection[0]) : null;

  let content;
  if (selected) content = <ComponentProperties component={selected} />;
  else {
    const text =
      selection.length > 1
        ? `${selection.length} éléments sélectionnés.`
        : selection.length === 1
          ? "Un fil n'a pas de propriétés."
          : "Sélectionne un composant pour voir et modifier ses propriétés.";
    content = (
      <>
        <h3 style={UI.heading}>Propriétés</h3>
        <p style={{ fontSize: 13, color: UI.muted }}>{text}</p>
      </>
    );
  }

  return (
    <section
      aria-label="Propriétés"
      style={{
        padding: 10,
        background: UI.panel,
        color: COLORS.symbol,
        // Sized by the app shell (resizable split with the results).
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
      }}
    >
      {content}
    </section>
  );
}
