import { useState, type CSSProperties, type ReactNode } from "react";

import { isEmptyDoc, useEditorStore } from "../store";
import { EXAMPLES } from "./examples";
import { openExample } from "./fileActions";
import { entryForKey } from "./paletteLayout";
import { COLORS, UI } from "./theme";

const Key = ({ children }: { children: ReactNode }) => (
  <kbd
    style={{
      padding: "0 5px",
      border: `1px solid ${UI.border}`,
      borderRadius: 3,
      background: UI.panel,
      font: "inherit",
      fontSize: 12,
    }}
  >
    {children}
  </kbd>
);

const buttonStyle: CSSProperties = {
  font: "inherit",
  padding: "4px 10px",
  border: `1px solid ${UI.border}`,
  borderRadius: 5,
  background: UI.surface,
  color: COLORS.text,
  cursor: "pointer",
  // The hint lets everything through, but its buttons take their clicks.
  pointerEvents: "auto",
};

/** What the first palette key picks, in words, for the hint. */
function firstKeyAction(): string | null {
  const entry = entryForKey("1");
  if (!entry) return null;
  return `choisir « ${entry.kind === "wire" ? "Fil" : entry.def.label} »`;
}

/**
 * First steps shown over an empty schematic (#275): how to place a component, draw a wire, open
 * an example or see the shortcuts. It goes as soon as the schematic holds something, and comes
 * back when everything is deleted. It lets clicks and drops from the palette through, except on
 * its own buttons.
 */
export function EmptyCanvasHint() {
  const empty = useEditorStore((s) => isEmptyDoc(s.doc));
  const [examplesOpen, setExamplesOpen] = useState(false);
  if (!empty) return null;
  const first = firstKeyAction();

  return (
    <div
      role="note"
      aria-label="Premiers pas"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: 380,
          padding: "14px 18px",
          border: `1px solid ${UI.border}`,
          borderRadius: 8,
          background: UI.surfaceTranslucent,
          color: COLORS.text,
          fontSize: 13,
          lineHeight: 1.6,
          userSelect: "none",
        }}
      >
        <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Le schéma est vide</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            Glissez un composant depuis la palette
            {first && (
              <>
                , ou appuyez sur <Key>1</Key> pour {first}
              </>
            )}
          </li>
          <li>
            Reliez les broches avec un fil (touche <Key>W</Key>)
          </li>
          <li>
            <Key>?</Key> pour voir tous les raccourcis
          </li>
        </ul>
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            aria-expanded={examplesOpen}
            style={buttonStyle}
            onClick={() => setExamplesOpen((o) => !o)}
          >
            Ouvrir un exemple
          </button>
          {examplesOpen && (
            <div
              role="group"
              aria-label="Exemples"
              style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}
            >
              {EXAMPLES.map((example) => (
                <button
                  key={example.name}
                  type="button"
                  title={example.description}
                  style={{ ...buttonStyle, textAlign: "left" }}
                  onClick={() => void openExample(example.name)}
                >
                  {example.title}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
