import { LIBRARY, useEditorStore } from "../store";
import { COLORS } from "./theme";

const buttonStyle = (active: boolean) =>
  ({
    display: "block",
    width: "100%",
    padding: "6px 8px",
    marginBottom: 4,
    textAlign: "left",
    border: `1px solid ${active ? COLORS.selected : "#d1d5db"}`,
    borderRadius: 4,
    background: active ? "#eff6ff" : "#ffffff",
    color: active ? COLORS.selected : COLORS.symbol,
    cursor: "pointer",
    font: "inherit",
  }) as const;

/** Component palette and keyboard help. */
export function Palette() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const startPlacing = useEditorStore((s) => s.startPlacing);
  const startWiring = useEditorStore((s) => s.startWiring);

  return (
    <aside
      style={{
        width: 180,
        padding: 8,
        borderRight: "1px solid #e5e7eb",
        background: "#f9fafb",
        fontSize: 14,
        overflowY: "auto",
      }}
    >
      <button
        type="button"
        style={buttonStyle(tool.kind === "select")}
        onClick={() => setTool({ kind: "select" })}
      >
        Sélection
      </button>
      <button type="button" style={buttonStyle(tool.kind === "wire")} onClick={startWiring}>
        Fil
      </button>
      <hr style={{ border: 0, borderTop: "1px solid #e5e7eb" }} />
      {[...LIBRARY.values()].map((def) => (
        <button
          key={def.type}
          type="button"
          style={buttonStyle(tool.kind === "place" && tool.type === def.type)}
          onClick={() => startPlacing(def.type)}
        >
          {def.label}
        </button>
      ))}
      <p style={{ fontSize: 12, color: COLORS.text, lineHeight: 1.5 }}>
        W : fil (ou tirer depuis une broche)
        <br />
        Clic : coude, ou fin du fil sur une broche ou un fil
        <br />
        Double-clic : finir le fil dans le vide
        <br />
        Échap : enlever le dernier coude
        <br />
        Clic droit : abandonner le fil
        <br />
        R : tourner
        <br />
        M : miroir
        <br />
        Suppr : supprimer
        <br />
        Échap : quitter l'outil
        <br />
        Molette : zoom
        <br />
        Clic molette : déplacer la vue
        <br />
        Maj + clic : sélection multiple
      </p>
    </aside>
  );
}
