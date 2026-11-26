// Warns before the window closes with unsaved changes (New and Open already ask, see
// fileActions.ts).
//
// In a browser, `beforeunload` shows the browser's own confirmation. The pywebview window does not
// always honour it, so the launcher can also ask `window.psiceHasUnsavedChanges()` from its
// `closing` event and show its own confirmation, or call `window.psiceRequestClose()` to show the
// editor's dialog, which can also save before closing (CloseDialog.tsx).

import { useEffect } from "react";

import { isUnsaved, useEditorStore } from "../store";

declare global {
  interface Window {
    /** True if the schematic has changes that were not saved (read by the desktop launcher). */
    psiceHasUnsavedChanges?: () => boolean;
    /**
     * Asks the user what to do with unsaved changes before the window closes (CloseDialog.tsx,
     * #238). Resolves to true when the window may close: nothing to save, "Fermer sans
     * enregistrer", or the schematic was saved. False: the user cancelled, or the save did not
     * happen. Called by the desktop launcher.
     */
    psiceRequestClose?: () => Promise<boolean>;
  }
}

const hasUnsavedChanges = () => isUnsaved(useEditorStore.getState());

/** Installs the warning while the editor is shown. */
export function useUnsavedChangesGuard() {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      // Both are needed for the confirmation to show in every browser.
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.psiceHasUnsavedChanges = hasUnsavedChanges;
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      delete window.psiceHasUnsavedChanges;
    };
  }, []);
}
