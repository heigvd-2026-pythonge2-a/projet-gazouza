// File > New / Open / Save / Save as / Export, shared by the toolbar buttons and the shortcuts
// (Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S).
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
import { exampleContent } from "./examples";
import { exportImage as renderImage, type ImageOptions } from "./viewCommands";

/** A file type offered by the system file dialogs. */
export interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

/** File types of the schematic files. */
const PICKER_TYPES: PickerType[] = [
  { description: "Schéma Psice", accept: { "application/json": [".json"] } },
];

/** File type of an exported image. */
const PNG_TYPES: PickerType[] = [{ description: "Image PNG", accept: { "image/png": [".png"] } }];

/** Name proposed for an exported image. */
export const IMAGE_FILE_NAME = "schema.png";

/** The parts of the File System Access API used here (not in TypeScript's DOM types yet). */
interface FilePickers {
  showOpenFilePicker(options: {
    types: PickerType[];
    multiple?: boolean;
  }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options: {
    types: PickerType[];
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

/** Name of the file of the current document, null if it was never saved (kept by the recovery). */
export const currentFileName = (): string | null => currentFile?.name ?? null;

/**
 * Takes the name of the file a recovered schematic came from (#274): saving it proposes that name
 * again. The file itself cannot be written without asking where, its handle being lost.
 */
export function adoptFileName(name: string | null) {
  currentFile = name ? { name, handle: null } : null;
}

/** The save being written, if any (a second Ctrl+S then waits for it instead of saving again). */
let saving: Promise<boolean> | null = null;

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

/**
 * Opens an example circuit of the Examples menu (#226) with its analysis set in the toolbar. It is
 * not tied to a file: saving it asks where, so the example itself is never overwritten.
 */
export function openExample(name: string) {
  const example = exampleContent(name);
  if (!example || !canDiscardChanges()) return;
  const store = useEditorStore.getState();
  store.openDocument(example.doc);
  store.setAnalysis(example.analysis);
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
async function write(handle: FileSystemFileHandle, content: string | Blob) {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

/** Downloads `content` as a file named `name` (when the file dialogs are not available). */
function download(name: string, content: string | Blob) {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
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
 * Saves the schematic, even without changes (its file may have been deleted meanwhile, #94). The
 * first time, or with `askWhere` (Save as), asks where (system dialog); then writes to the same
 * file. If that file cannot be written any more, asks for another one.
 *
 * Resolves to true once the schematic is written, false if the user closed the file dialog or the
 * file could not be written (the user is told). A call during a save waits for that save.
 */
export function saveFile({ askWhere = false }: { askWhere?: boolean } = {}): Promise<boolean> {
  const s = useEditorStore.getState();
  if (saving) return saving;
  const doc = s.doc;
  const content = serializeDoc(doc);
  const api = pickers();
  if (!api) {
    const name = currentFile?.name ?? DEFAULT_FILE_NAME;
    download(name, content);
    currentFile = { name, handle: null };
    s.markSaved(doc);
    return Promise.resolve(true);
  }
  const pick = () =>
    api.showSaveFilePicker({
      types: PICKER_TYPES,
      suggestedName: currentFile?.name ?? DEFAULT_FILE_NAME,
    });
  saving = (async () => {
    try {
      let handle = askWhere ? null : (currentFile?.handle ?? null);
      if (handle) {
        try {
          await write(handle, content);
        } catch {
          // Deleted, moved or read-only: save elsewhere instead.
          handle = null;
        }
      }
      if (!handle) {
        handle = await pick();
        await write(handle, content);
      }
      currentFile = { name: handle.name, handle };
      useEditorStore.getState().markSaved(doc);
      return true;
    } catch (error: unknown) {
      if (!isCancel(error)) window.alert("Impossible d'enregistrer le schéma dans ce fichier.");
      return false;
    } finally {
      saving = null;
    }
  })();
  return saving;
}

/** Saves the schematic in a file chosen by the user (Ctrl+Shift+S). */
export const saveFileAs = () => saveFile({ askWhere: true });

/** Saves `content` in a new file, chosen with the system dialog or downloaded. */
export async function saveNewFile(name: string, content: Blob, types: PickerType[]) {
  const api = pickers();
  if (!api) {
    download(name, content);
    return;
  }
  try {
    const handle = await api.showSaveFilePicker({ types, suggestedName: name });
    await write(handle, content);
  } catch (error: unknown) {
    if (!isCancel(error)) window.alert("Impossible d'enregistrer ce fichier.");
  }
}

/** localStorage key of the last "transparent background" choice of the image export. */
export const TRANSPARENT_EXPORT_KEY = "psice.export.transparent";

/** Last "transparent background" choice of the image export (white by default). */
export function exportTransparent(): boolean {
  try {
    return window.localStorage.getItem(TRANSPARENT_EXPORT_KEY) === "true";
  } catch {
    return false;
  }
}

/** Remembers the "transparent background" choice for the next exports. */
export function setExportTransparent(transparent: boolean) {
  try {
    window.localStorage.setItem(TRANSPARENT_EXPORT_KEY, String(transparent));
  } catch {
    // Storage blocked: the choice is simply not kept.
  }
}

/**
 * Exports the schematic as a PNG image, to put in a report (#112): the whole circuit, without the
 * grid nor the selection, on a white background, or a transparent one if asked (#195).
 */
export async function exportImage(options: ImageOptions = { transparent: false }) {
  if (useEditorStore.getState().doc.components.length === 0) {
    window.alert("Le schéma est vide : il n'y a rien à exporter.");
    return;
  }
  const image = await renderImage(options);
  if (!image) {
    window.alert("Impossible de créer l'image du schéma.");
    return;
  }
  await saveNewFile(IMAGE_FILE_NAME, image, PNG_TYPES);
}
