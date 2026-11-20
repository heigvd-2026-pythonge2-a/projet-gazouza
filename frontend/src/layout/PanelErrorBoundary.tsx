import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  /** Panel name in the message, e.g. "le schéma". */
  panel: string;
  /** Saves a copy of the user's work; offered with the error so nothing is lost. */
  onRescue?: () => void;
  /** A one-line message, for a toolbar or a status bar (else it fills the panel). */
  compact?: boolean;
  children: ReactNode;
};

type State = { error: Error | null };

const BUTTON = {
  padding: "4px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 5,
  background: "#ffffff",
  color: "#374151",
  font: "inherit",
  fontSize: 12,
  cursor: "pointer",
} as const;

/**
 * Catches an error thrown while rendering a panel: the panel shows a message instead of the whole
 * window going blank, and the other panels keep working.
 */
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Erreur dans ${this.props.panel} :`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { panel, onRescue, compact = false } = this.props;
    const buttons = (
      <>
        <button type="button" style={BUTTON} onClick={() => this.setState({ error: null })}>
          Réessayer
        </button>
        {onRescue && (
          <button type="button" style={BUTTON} onClick={onRescue}>
            Enregistrer une copie du schéma
          </button>
        )}
      </>
    );
    const box = {
      boxSizing: "border-box",
      background: "#fef2f2",
      color: "#7f1d1d",
      fontSize: 12,
    } as const;
    if (compact) {
      // A toolbar or a status bar: one line, so the panels around keep their room.
      return (
        <div
          role="alert"
          title={error.message}
          style={{ ...box, display: "flex", alignItems: "center", gap: 8, padding: "2px 8px" }}
        >
          <span style={{ fontWeight: 600 }}>Une erreur est survenue dans {panel}.</span>
          {buttons}
        </div>
      );
    }
    return (
      <div
        role="alert"
        style={{ ...box, width: "100%", height: "100%", padding: 12, overflow: "auto" }}
      >
        <p style={{ margin: "0 0 4px", fontWeight: 600 }}>Une erreur est survenue dans {panel}.</p>
        <p style={{ margin: "0 0 10px", color: "#991b1b" }}>{error.message}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{buttons}</div>
      </div>
    );
  }
}
