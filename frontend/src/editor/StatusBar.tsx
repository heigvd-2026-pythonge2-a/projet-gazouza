import { useEditorStore, type Tool } from "../store";
import { UI } from "./theme";

const HINTS: Record<Tool["kind"], string> = {
  select:
    "Clic : sélectionner · Maj + clic : sélection multiple · " +
    "Glisser dans le vide : sélection par zone · Clic droit sur un composant : menu · " +
    "Tirer depuis une broche : fil · " +
    "Clic sur un fil : coude ou tronçon, à glisser · Double-clic : fil entier · " +
    "Glisser : déplacer la sélection · Flèches : la déplacer d'un pas · " +
    "R : tourner · M : miroir · Suppr : supprimer · Ctrl+Z / Ctrl+Y : annuler / rétablir · " +
    "1 à 8 : outil de la palette · " +
    "Molette : zoom · Clic droit ou molette maintenu : déplacer la vue",
  place:
    "Clic : poser · R : tourner · M : miroir · Échap ou clic droit : arrêter de poser · " +
    "Clic droit maintenu : déplacer la vue",
  wire:
    "Clic : coude, ou fin du fil sur une broche ou un fil · Double-clic : finir dans le vide · " +
    "Échap : enlever le dernier coude · Clic droit : abandonner le fil · " +
    "Clic droit maintenu : déplacer la vue",
};

/** Bottom bar: shortcuts of the active tool, and what is selected. */
export function StatusBar() {
  const tool = useEditorStore((s) => s.tool);
  const doc = useEditorStore((s) => s.doc);
  const selection = useEditorStore((s) => s.selection);
  const wirePart = useEditorStore((s) => s.wirePart);

  let selected = "";
  if (wirePart) {
    selected = wirePart.kind === "bend" ? "Sélection : coude de fil" : "Sélection : tronçon de fil";
  } else if (selection.length === 1) {
    const c = doc.components.find((x) => x.id === selection[0]);
    selected = c ? `Sélection : ${c.name ?? c.params.net ?? "masse"}` : "Sélection : fil";
  } else if (selection.length > 1) {
    selected = `${selection.length} éléments sélectionnés`;
  }

  return (
    <footer
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        height: 24,
        flex: "none",
        padding: "0 10px",
        fontSize: 11,
        color: UI.muted,
        background: UI.panel,
        borderTop: `1px solid ${UI.border}`,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={HINTS[tool.kind]}>
        {HINTS[tool.kind]}
      </span>
      <span style={{ marginLeft: "auto" }}>{selected}</span>
    </footer>
  );
}
