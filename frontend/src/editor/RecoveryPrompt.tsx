// At startup, offers to restore the schematic left unsaved by a crash (#274, see recovery.ts).

import { useEffect, useState } from "react";

import { useEditorStore } from "../store";
import { adoptFileName } from "./fileActions";
import { clearRecovery, readRecovery, startRecovery } from "./recovery";
import { COLORS, UI } from "./theme";

const BUTTON = {
  padding: "5px 12px",
  border: `1px solid ${UI.inputBorder}`,
  borderRadius: 5,
  background: UI.surface,
  color: COLORS.text,
  font: "inherit",
  fontSize: 12,
  cursor: "pointer",
} as const;

const MAIN_BUTTON = {
  ...BUTTON,
  border: `1px solid ${COLORS.selected}`,
  background: COLORS.selected,
  color: UI.onAccent,
  fontWeight: 600,
} as const;

/** "le 26/11/2026 à 14:05", or nothing if the date is unknown. */
const when = (date: Date | null) =>
  date
    ? ` (${date.toLocaleDateString("fr-CH")} à ${date.toLocaleTimeString("fr-CH", {
        hour: "2-digit",
        minute: "2-digit",
      })})`
    : "";

/**
 * Asks whether to restore the copy found at startup, then keeps the copy of the schematic up to
 * date while the editor is shown. Restored, the schematic is marked as modified.
 */
export function RecoveryPrompt() {
  // Read once: the library is loaded (the editor shows after it), so the copy can be parsed.
  const [found, setFound] = useState(readRecovery);

  // The copies start once the question is answered, so the copy found is not replaced meanwhile.
  useEffect(() => (found ? undefined : startRecovery()), [found]);

  useEffect(() => {
    if (!found) return;
    // Keep the editor's shortcuts off while the question is shown. Tab, Enter and Space still
    // move between and press the buttons.
    const onKeyDown = (e: KeyboardEvent) => e.stopPropagation();
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [found]);

  if (!found) return null;

  const restore = () => {
    useEditorStore.getState().restoreDocument(found.doc);
    adoptFileName(found.fileName);
    setFound(null);
  };
  const ignore = () => {
    clearRecovery();
    setFound(null);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.3)",
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="psice-recovery-title"
        aria-describedby="psice-recovery-message"
        style={{
          width: 420,
          maxWidth: "calc(100vw - 32px)",
          padding: "16px 18px",
          background: UI.surface,
          border: `1px solid ${UI.border}`,
          borderRadius: 8,
          boxShadow: `0 8px 24px ${UI.shadow}`,
          fontSize: 13,
          color: COLORS.text,
        }}
      >
        <h2 id="psice-recovery-title" style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>
          Schéma non enregistré retrouvé
        </h2>
        <p id="psice-recovery-message" style={{ margin: "0 0 16px" }}>
          Psice ne s'est pas fermé normalement. Un schéma non enregistré a été retrouvé
          {found.fileName ? ` (« ${found.fileName} »)` : ""}
          {when(found.savedAt)}. Le restaurer ?
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" style={BUTTON} onClick={ignore}>
            Ignorer
          </button>
          <button type="button" style={MAIN_BUTTON} autoFocus onClick={restore}>
            Restaurer
          </button>
        </div>
      </div>
    </div>
  );
}
