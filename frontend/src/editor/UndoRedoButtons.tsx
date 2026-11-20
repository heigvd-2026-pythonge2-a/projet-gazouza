import { useEditorStore } from "../store";
import { UI } from "./theme";

function HistoryButton(props: {
  label: string;
  icon: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const { label, icon, disabled, onClick } = props;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 28,
        height: 26,
        padding: 0,
        border: `1px solid ${UI.border}`,
        borderRadius: 5,
        background: "#ffffff",
        color: "#374151",
        font: "inherit",
        fontSize: 15,
        lineHeight: 1,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {icon}
    </button>
  );
}

/** Undo / redo buttons for the toolbar. Same actions as Ctrl+Z / Ctrl+Y. */
export function UndoRedoButtons() {
  const canUndo = useEditorStore((s) => s.history.past.length > 0);
  const canRedo = useEditorStore((s) => s.history.future.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  return (
    <>
      <HistoryButton label="Annuler (Ctrl+Z)" icon="↶" disabled={!canUndo} onClick={undo} />
      <HistoryButton label="Rétablir (Ctrl+Y)" icon="↷" disabled={!canRedo} onClick={redo} />
    </>
  );
}
