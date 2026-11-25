// Asks what to do with unsaved changes when the window is about to close (#238): cancel, close
// without saving, or save and close once the file is written.
//
// The native confirmation of the desktop window only has two buttons, so the launcher can call
// `window.psiceRequestClose()` instead: it shows this dialog and resolves to true when the window
// may close (see unsavedGuard.ts for the other function the launcher reads).

import { useCallback, useEffect, useRef, useState } from "react";

import { isUnsaved, useEditorStore } from "../store";
import { saveFile } from "./fileActions";
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

/** Installs `window.psiceRequestClose` and shows the dialog when it is called with changes. */
export function CloseDialog() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // The request being answered: a second request while the dialog is shown gets the same answer.
  const request = useRef<{ promise: Promise<boolean>; resolve: (close: boolean) => void } | null>(
    null,
  );

  const answer = useCallback((close: boolean) => {
    request.current?.resolve(close);
    request.current = null;
    setOpen(false);
    setSaving(false);
  }, []);

  useEffect(() => {
    window.psiceRequestClose = () => {
      if (!isUnsaved(useEditorStore.getState())) return Promise.resolve(true);
      if (!request.current) {
        let resolve: (close: boolean) => void = () => {};
        const promise = new Promise<boolean>((r) => (resolve = r));
        request.current = { promise, resolve };
        setOpen(true);
      }
      return request.current.promise;
    };
    return () => {
      delete window.psiceRequestClose;
      // The editor goes away: the window stays open rather than waiting for an answer forever.
      request.current?.resolve(false);
      request.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Keep the editor's shortcuts (Delete, Ctrl+Z…) off while the dialog is shown. Tab, Enter
      // and Space still move between and press the buttons: those are default actions.
      e.stopPropagation();
      if (e.key === "Escape" && !saving) answer(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, saving, answer]);

  const saveAndClose = async () => {
    setSaving(true);
    // Cancelled file dialog or write error: the dialog stays, so the user can choose again.
    if (await saveFile()) answer(true);
    else setSaving(false);
  };

  if (!open) return null;
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
        aria-labelledby="psice-close-title"
        aria-describedby="psice-close-message"
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
        <h2 id="psice-close-title" style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>
          Fermer Psice
        </h2>
        <p id="psice-close-message" style={{ margin: "0 0 16px" }}>
          Le schéma contient des modifications non enregistrées.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" style={BUTTON} disabled={saving} onClick={() => answer(false)}>
            Annuler
          </button>
          <button type="button" style={BUTTON} disabled={saving} onClick={() => answer(true)}>
            Fermer sans enregistrer
          </button>
          <button
            type="button"
            style={MAIN_BUTTON}
            disabled={saving}
            autoFocus
            onClick={() => void saveAndClose()}
          >
            Enregistrer et fermer
          </button>
        </div>
      </div>
    </div>
  );
}
