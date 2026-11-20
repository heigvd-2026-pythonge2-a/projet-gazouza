// File > New / Open / Save, shared by the toolbar buttons and Ctrl+N / Ctrl+O / Ctrl+S.
//
// Where the File System Access API exists (Chrome, Edge and WebView2, the engine of the pywebview
// window on Windows), Open and Save use the system file dialogs and Save writes back to the file
// that was opened or saved before, like a desktop app. Elsewhere (Firefox…) Open uses a file input
// and Save downloads the file.

import {
  DEFAULT_FILE_NAME,
  FileFormatError,
  isUnsaved,
  parseDoc,
  serializeDoc,
  useEditorStore,
} from "../store";

/** File types offered by the system file dialogs. */
const PICKER_TYPES = [{ description: "Schéma Psice", accept: { "application/json": [".json"] } }];

/** The parts of the File System Access API used here (not in TypeScript's DOM types yet). */
interface FilePickers {
  showOpenFilePicker(options: {
    types: typeof PICKER_TYPES;
    multiple?: boolean;
  }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options: {
    types: typeof PICKER_TYPES;
    suggestedName?: string;
  }): Promise<FileSystemFileHandle>;
}

const pickers = (): FilePickers | null =>
  "showSaveFilePicker" in window && "showOpenFilePicker" in window
    ? (window as unknown as FilePickers)
    : null;

/**
 * The file of the current document. `handle` is set when it can be written again directly, `name`
 * whenever the document was opened from or saved to a file (null: never saved).
 */
let currentFile: { name: string; handle: FileSystemFileHandle | null } | null = null;

/** True while a save is being written (a second Ctrl+S then does nothing). */
let saving = false;

/** The user closed a file dialog without choosing a file. */
const isCancel = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/** Asks before dropping unsaved changes. True if there are none, or the user accepts. */
function canDiscardChanges(): boolean {
  if (!isUnsaved(useEditorStore.getState())) return true;
  return window.confirm(
    "Le schéma contient des modifications non enregistrées. Les abandonner et continuer ?",
  );
}

/** Starts an empty schematic. */
export function newFile() {
  if (!canDiscardChanges()) return;
  useEditorStore.getState().newDocument();
  currentFile = null;
}

/** Opens the content of a schematic file, or tells the user why it cannot be opened. */
async function openContent(file: File, handle: FileSystemFileHandle | null) {
  try {
    const doc = parseDoc(await file.text());
    useEditorStore.getState().openDocument(doc);
    currentFile = { name: file.name, handle };
  } catch (error: unknown) {
    window.alert(
      error instanceof FileFormatError ? error.message : "Impossible de lire ce fichier.",
    );
  }
}

/** Lets the user pick a schematic file and opens it. */
export function openFile() {
  if (!canDiscardChanges()) return;
  const api = pickers();
  if (api) {
    api
      .showOpenFilePicker({ types: PICKER_TYPES })
      .then(async (handles) => {
        const handle = handles[0];
        if (handle) await openContent(await handle.getFile(), handle);
      })
      .catch((error: unknown) => {
        if (!isCancel(error)) window.alert("Impossible d'ouvrir ce fichier.");
      });
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void openContent(file, null);
  });
  input.click();
}

/** Writes `content` into the file of `handle`, replacing what it held. */
async function write(handle: FileSystemFileHandle, content: string) {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

/** Downloads `content` as a file named `name` (when the file dialogs are not available). */
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Give the browser time to start the download before freeing the file.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Name proposed for a rescue copy, so it does not replace the schematic's own file. */
const RESCUE_FILE_NAME = "schema-recupere.psice.json";

/**
 * Saves a copy of the schematic in a new file, after an error in the interface: it always asks
 * where, never overwrites the current file, and does not mark the document as saved.
 */
export function saveRescueCopy() {
  const content = serializeDoc(useEditorStore.getState().doc);
  const api = pickers();
  if (!api) {
    download(RESCUE_FILE_NAME, content);
    return;
  }
  void (async () => {
    try {
      const handle = await api.showSaveFilePicker({
        types: PICKER_TYPES,
        suggestedName: RESCUE_FILE_NAME,
      });
      await write(handle, content);
    } catch (error: unknown) {
      if (isCancel(error)) return;
      // Last resort: the download still gets the work out.
      download(RESCUE_FILE_NAME, content);
    }
  })();
}

/**
 * Saves the schematic. The first time, asks where (system dialog); then writes to the same file.
 * Does nothing if the document is already saved in a file.
 */
export function saveFile() {
  const s = useEditorStore.getState();
  if (saving || (currentFile && !isUnsaved(s))) return;
  const doc = s.doc;
  const content = serializeDoc(doc);
  const api = pickers();
  if (!api) {
    const name = currentFile?.name ?? DEFAULT_FILE_NAME;
    download(name, content);
    currentFile = { name, handle: null };
    s.markSaved(doc);
    return;
  }
  saving = true;
  void (async () => {
    try {
      const handle =
        currentFile?.handle ??
        (await api.showSaveFilePicker({
          types: PICKER_TYPES,
          suggestedName: currentFile?.name ?? DEFAULT_FILE_NAME,
        }));
      await write(handle, content);
      currentFile = { name: handle.name, handle };
      useEditorStore.getState().markSaved(doc);
    } catch (error: unknown) {
      if (!isCancel(error)) window.alert("Impossible d'enregistrer le schéma dans ce fichier.");
    } finally {
      saving = false;
    }
  })();
}
