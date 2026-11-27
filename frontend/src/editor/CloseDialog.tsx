// Asks what to do with unsaved changes (#238, #332): cancel, go on without saving, or save and go
// on once the file is written. The question comes from unsavedDialog.ts: New, Open, Examples, the
// LTspice import, a dropped file, and the desktop window about to close. While it is not mounted
// (the schematic panel crashed), unsavedDialog.ts asks with the browser's own confirmation.
//
// The native confirmation of the desktop window only has two buttons, so the launcher can call
// `window.psiceRequestClose()` instead: it shows this dialog and resolves to true when the window
// may close (see unsavedGuard.ts for the other function the launcher reads).

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { saveFile } from "./fileActions";
import { COLORS, UI } from "./theme";
import {
  answerUnsavedQuestion,
  askBeforeDroppingChanges,
  registerUnsavedDialog,
  useUnsavedDialog,
} from "./unsavedDialog";

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

/**
 * Shows the question about unsaved changes when one is asked, and installs
 * `window.psiceRequestClose` for the desktop launcher.
 */
export function CloseDialog() {
  const pending = useUnsavedDialog((d) => d.pending);
  const [saving, setSaving] = useState(false);
  const open = pending !== null;

  const answer = useCallback((goOn: boolean) => {
    setSaving(false);
    answerUnsavedQuestion(goOn);
  }, []);

  useEffect(() => {
    const unregister = registerUnsavedDialog();
    window.psiceRequestClose = () => askBeforeDroppingChanges("close");
    return () => {
      unregister();
      delete window.psiceRequestClose;
      // The editor goes away: nothing is done rather than waiting for an answer forever.
      answerUnsavedQuestion(false);
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

  const saveAndGoOn = async () => {
    setSaving(true);
    // Cancelled file dialog or write error: the dialog stays, so the user can choose again.
    if (await saveFile()) answer(true);
    else setSaving(false);
  };

  if (!pending) return null;
  const { question } = pending;
  // In the page's body rather than in the schematic: the toolbar can ask while the schematic is
  // hidden (results shown full screen), and a dialog hidden with it would block the keyboard.
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.3)",
        // Outside the app's root, which sets it (App.tsx).
        fontFamily: '"Segoe UI", system-ui, sans-serif',
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
          {question.title}
        </h2>
        <p id="psice-close-message" style={{ margin: "0 0 16px" }}>
          Le schéma contient des modifications non enregistrées.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" style={BUTTON} disabled={saving} onClick={() => answer(false)}>
            Annuler
          </button>
          <button type="button" style={BUTTON} disabled={saving} onClick={() => answer(true)}>
            {question.discard}
          </button>
          <button
            type="button"
            style={MAIN_BUTTON}
            disabled={saving}
            autoFocus
            onClick={() => void saveAndGoOn()}
          >
            {question.save}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
