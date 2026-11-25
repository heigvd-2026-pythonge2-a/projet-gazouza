import { COLORS, UI } from "../store";

type Props = {
  /** Whether this panel is the one shown in full screen. */
  maximized: boolean;
  /** Panel name in the tooltip, e.g. "les résultats". */
  panel: string;
  onClick: () => void;
};

/** Small ⛶ button in a panel's corner: shows the panel in full screen, or back to normal. */
export function MaximizeButton({ maximized, panel, onClick }: Props) {
  const label = maximized ? "Quitter le plein écran (Échap)" : `Afficher ${panel} en plein écran`;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={maximized}
      onClick={onClick}
      style={{
        display: "grid",
        placeItems: "center",
        width: 24,
        height: 24,
        padding: 0,
        border: `1px solid ${UI.border}`,
        borderRadius: 5,
        background: maximized ? UI.activeBackground : UI.surface,
        color: maximized ? COLORS.selected : UI.label,
        cursor: "pointer",
      }}
    >
      <svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke="currentColor" aria-hidden>
        {maximized ? (
          // Arrows pointing inwards.
          <path d="M5 1v4H1M9 1v4h4M5 13V9H1M9 13V9h4" strokeWidth={1.5} />
        ) : (
          // Arrows pointing outwards.
          <path d="M1 5V1h4M13 5V1H9M1 9v4h4M13 9v4H9" strokeWidth={1.5} />
        )}
      </svg>
    </button>
  );
}
