import { useId, useRef, type CSSProperties, type KeyboardEvent } from "react";

import {
  TEXT_MAX_LENGTH,
  getDef,
  nameProblem,
  netNameProblem,
  useEditorStore,
  valueProblem,
  visibleParams,
  type EditorText,
  type ParamOption,
  type PlacedComponent,
  type ValueProblem,
} from "../store";
import { FIELD_ATTR, INSPECTOR_ID, NAME_FIELD, VALUE_FIELD_ATTR } from "./inspectorFocus";
import { COLORS, UI } from "./theme";

/** Colour of a warning (a value that works, but probably not as meant). */
const WARNING = UI.warning;

/** Components with at least this many fields show them on two columns, when there is room. */
const TWO_COLUMNS_FROM = 4;

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
  /** What is wrong with the value: a string is an error. */
  problem?: string | ValueProblem | null;
  /** Takes the whole width of a two-column layout. */
  wide?: boolean;
  /** The component's main value: the field a double-click on the component goes to. */
  valueField?: boolean;
  /** Names the field, for the error bubbles of the schematic (`FIELD_ATTR`). */
  field: string;
  onChange: (value: string) => void;
}) {
  const { label, value, unit, options, valueField, field, wide, onChange } = props;
  const problem: ValueProblem | null =
    typeof props.problem === "string"
      ? { level: "error", message: props.problem }
      : (props.problem ?? null);
  const problemColor = problem?.level === "warning" ? WARNING : UI.error;
  const id = useId();
  /** True once the text was changed since the field got the focus. */
  const edited = useRef(false);

  // Enter keeps what was typed, Escape takes it back; both give the keys back to the schematic.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    e.preventDefault();
    // Escape must not also reach the app (it would leave full screen or clear the selection).
    e.stopPropagation();
    if (e.key === "Escape" && edited.current) useEditorStore.getState().undo();
    edited.current = false;
    e.currentTarget.blur();
  };
  return (
    <div style={{ marginBottom: 8, minWidth: 0, ...(wide ? { gridColumn: "1 / -1" } : {}) }}>
      <label
        htmlFor={id}
        style={{ display: "block", fontSize: 12, color: UI.label, marginBottom: 3 }}
      >
        {label}
      </label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          border: `1px solid ${problem ? problemColor : UI.inputBorder}`,
          borderRadius: 4,
          background: UI.surface,
        }}
      >
        {options ? (
          <select
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            {...{ [FIELD_ATTR]: field }}
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
            onChange={(e) => {
              edited.current = true;
              onChange(e.target.value);
            }}
            onFocus={() => {
              edited.current = false;
              // The edits typed from now on are one undo step of their own, for Escape.
              useEditorStore.getState().sealHistory();
            }}
            onKeyDown={onKeyDown}
            {...(valueField ? { [VALUE_FIELD_ATTR]: "" } : {})}
            {...{ [FIELD_ATTR]: field }}
            spellCheck={false}
            aria-invalid={problem?.level === "error" ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
            style={controlStyle}
          />
        )}
        {unit && <span style={{ padding: "0 8px", color: UI.faint }}>{unit}</span>}
      </div>
      {problem && (
        <p id={`${id}-problem`} style={{ margin: "3px 0 0", fontSize: 12, color: problemColor }}>
          {problem.message}
        </p>
      )}
    </div>
  );
}

function ComponentProperties({ component: c }: { component: PlacedComponent }) {
  const doc = useEditorStore((s) => s.doc);
  const renameComponent = useEditorStore((s) => s.renameComponent);
  const setParam = useEditorStore((s) => s.setParam);
  const def = getDef(c.type);
  const params = visibleParams(def, c.params);
  const mainValue = params.find((p) => p.kind === "value");
  const hasValues = mainValue !== undefined;
  const fields = params.length + (def.prefix !== null ? 1 : 0);
  // Two columns where there is room (a source in pulse mode has 9 fields); one when narrow.
  const layout: CSSProperties =
    fields >= TWO_COLUMNS_FROM
      ? {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
          columnGap: 10,
        }
      : {};

  return (
    <>
      <h3 style={UI.heading}>
        {def.label}
        {c.name && <span style={{ textTransform: "none" }}> — {c.name}</span>}
      </h3>
      <div style={layout}>
        {def.prefix !== null && (
          <Field
            label="Nom"
            field={NAME_FIELD}
            wide
            value={c.name ?? ""}
            problem={nameProblem(doc, c, def.prefix)}
            onChange={(name) => renameComponent(c.id, name)}
          />
        )}
        {params.map((p) => {
          // A choice missing from an older file (a label's direction) shows its default.
          const value = c.params[p.name] ?? (p.kind === "choice" ? p.default : "");
          return (
            <Field
              key={p.name}
              field={p.name}
              label={p.label}
              value={value}
              unit={p.unit}
              options={p.kind === "choice" ? p.options : undefined}
              valueField={p.name === mainValue?.name}
              wide={p.kind === "choice"}
              problem={
                c.type === "label" && p.name === "net"
                  ? netNameProblem(value)
                  : p.kind === "value"
                    ? valueProblem(value, p.unit)
                    : null
              }
              onChange={(v) => setParam(c.id, p.name, v)}
            />
          );
        })}
      </div>
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

/**
 * Content of the selected free text (#123), in a multiline field: Enter starts a new line,
 * Ctrl+Enter keeps what was typed, Escape takes it back.
 */
function TextProperties({ text }: { text: EditorText }) {
  const setTextContent = useEditorStore((s) => s.setTextContent);
  const id = useId();
  const edited = useRef(false);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const done = e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey));
    if (!done) return;
    e.preventDefault();
    // Escape must not also reach the app (it would leave full screen or clear the selection).
    e.stopPropagation();
    if (e.key === "Escape" && edited.current) useEditorStore.getState().undo();
    edited.current = false;
    e.currentTarget.blur();
  };
  return (
    <>
      <h3 style={UI.heading}>Texte</h3>
      <label
        htmlFor={id}
        style={{ display: "block", fontSize: 12, color: "#4b5563", marginBottom: 3 }}
      >
        Contenu
      </label>
      <textarea
        id={id}
        value={text.content}
        rows={4}
        maxLength={TEXT_MAX_LENGTH}
        onChange={(e) => {
          edited.current = true;
          setTextContent(text.id, e.target.value);
        }}
        onFocus={() => {
          edited.current = false;
          // The edits typed from now on are one undo step of their own, for Escape.
          useEditorStore.getState().sealHistory();
        }}
        onKeyDown={onKeyDown}
        style={{
          ...controlStyle,
          width: "100%",
          boxSizing: "border-box",
          resize: "vertical",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          background: "#ffffff",
        }}
      />
      <p style={{ fontSize: 12, color: UI.muted, lineHeight: 1.5 }}>
        Texte décoratif : il n'a aucun effet sur la simulation.
        <br />
        Entrée : nouvelle ligne · Ctrl+Entrée : valider · Échap : annuler.
      </p>
    </>
  );
}

/** Properties of the selected component or text, editable. */
export function Inspector() {
  const doc = useEditorStore((s) => s.doc);
  const selection = useEditorStore((s) => s.selection);

  const selected =
    selection.length === 1 ? doc.components.find((c) => c.id === selection[0]) : null;
  const selectedText = selection.length === 1 ? doc.texts.find((t) => t.id === selection[0]) : null;

  let content;
  if (selected) content = <ComponentProperties component={selected} />;
  else if (selectedText) content = <TextProperties text={selectedText} />;
  else {
    const text =
      selection.length > 1
        ? `${selection.length} éléments sélectionnés.`
        : selection.length === 1
          ? "Un fil n'a pas de propriétés."
          : "Sélectionnez un composant ou un texte pour voir et modifier ses propriétés.";
    content = (
      <>
        <h3 style={UI.heading}>Propriétés</h3>
        <p style={{ fontSize: 13, color: UI.muted }}>{text}</p>
      </>
    );
  }

  return (
    <section
      id={INSPECTOR_ID}
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
