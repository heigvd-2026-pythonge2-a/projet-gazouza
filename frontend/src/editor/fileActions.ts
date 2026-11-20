// File > New / Open / Save, shared by the toolbar buttons and Ctrl+N / Ctrl+O / Ctrl+S.

import {
  DEFAULT_FILE_NAME,
  FileFormatError,
  isUnsaved,
  parseDoc,
  serializeDoc,
  useEditorStore,
} from "../store";

/** Asks before dropping unsaved changes. True if there are none, or the user accepts. */
function canDiscardChanges(): boolean {
  if (!isUnsaved(useEditorStore.getState())) return true;
  return window.confirm(
    "Le schéma contient des modifications non enregistrées. Les abandonner et continuer ?",
  );
}

/** Starts an empty schematic. */
export function newFile() {
  if (canDiscardChanges()) useEditorStore.getState().newDocument();
}

/** Lets the user pick a schematic file and opens it. */
export function openFile() {
  if (!canDiscardChanges()) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    file
      .text()
      .then((text) => useEditorStore.getState().openDocument(parseDoc(text)))
      .catch((error: unknown) => {
        window.alert(
          error instanceof FileFormatError ? error.message : "Impossible de lire ce fichier.",
        );
      });
  });
  input.click();
}

/** Saves the schematic as a file (downloaded under `DEFAULT_FILE_NAME`). */
export function saveFile() {
  const s = useEditorStore.getState();
  const url = URL.createObjectURL(new Blob([serializeDoc(s.doc)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = DEFAULT_FILE_NAME;
  link.click();
  // Give the browser time to start the download before freeing the file.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  s.markSaved();
}
