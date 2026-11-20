// Warns before the window closes with unsaved changes (New and Open already ask, see
// fileActions.ts).
//
// In a browser, `beforeunload` shows the browser's own confirmation. The pywebview window does not
// always honour it, so the launcher can also ask `window.psiceHasUnsavedChanges()` from its
// `closing` event and show its own confirmation.

import { useEffect } from "react";

import { isUnsaved, useEditorStore } from "../store";

declare global {
  interface Window {
    /** True if the schematic has changes that were not saved (read by the desktop launcher). */
    psiceHasUnsavedChanges?: () => boolean;
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
