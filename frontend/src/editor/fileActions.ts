// File > New / Open / Save / Save as / Export, shared by the toolbar buttons and the shortcuts
// (Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S).
//
// Where the File System Access API exists (Chrome, Edge and WebView2, the engine of the pywebview
// window on Windows), Open and Save use the system file dialogs and Save writes back to the file
// that was opened or saved before, like a desktop app. Elsewhere (Firefox…) Open uses a file input
// and Save downloads the file.

import { ApiError, importAsc, type ImportResult } from "../api/client";
import {
  DEFAULT_FILE_NAME,
  FileFormatError,
  parseDoc,
  readDoc,
  serializeDoc,
  useEditorStore,
} from "../store";
import { analysisSettings, exampleContent } from "./examples";
import { askBeforeDroppingChanges } from "./unsavedDialog";
import { exportImage as renderImage, type ImageFormat, type ImageOptions } from "./viewCommands";

/** A file type offered by the system file dialogs. */
export interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

/** File types of the schematic files. */
const PICKER_TYPES: PickerType[] = [
  { description: "Schéma Psice", accept: { "application/json": [".json"] } },
];

/** File types of the LTspice schematics (#225). */
const ASC_TYPES: PickerType[] = [
  { description: "Schéma LTspice", accept: { "application/octet-stream": [".asc"] } },
];

/** File type of an exported image, by format. */
const IMAGE_TYPES: Record<ImageFormat, PickerType[]> = {
  png: [{ description: "Image PNG", accept: { "image/png": [".png"] } }],
  svg: [{ description: "Image SVG", accept: { "image/svg+xml": [".svg"] } }],
};

/** Name proposed for an exported image, by format. */
export const IMAGE_FILE_NAMES: Record<ImageFormat, string> = {
  png: "schema.png",
  svg: "schema.svg",
};

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

/** The save being written, if any (a second Ctrl+S then waits for it instead of saving again). */
let saving: Promise<boolean> | null = null;

/** The user closed a file dialog without choosing a file. */
const isCancel = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/** Starts an empty schematic, once unsaved changes are saved or given up. */
export async function newFile() {
  if (!(await askBeforeDroppingChanges("new"))) return;
  useEditorStore.getState().newDocument();
  currentFile = null;
}

/**
 * Opens an example circuit of the Examples menu (#226) with its analysis set in the toolbar. It is
 * not tied to a file: saving it asks where, so the example itself is never overwritten.
 */
export async function openExample(name: string) {
  const example = exampleContent(name);
  if (!example || !(await askBeforeDroppingChanges("example"))) return;
  const store = useEditorStore.getState();
  store.openDocument(example.doc);
  store.setAnalysis(example.analysis);
  currentFile = null;
}

/**
 * Opens the content of a schematic file, or tells the user why it cannot be opened. The question
 * about unsaved changes comes once the file is known to be readable.
 */
async function openContent(file: File, handle: FileSystemFileHandle | null) {
  let doc;
  try {
    doc = parseDoc(await file.text());
  } catch (error: unknown) {
    window.alert(
      error instanceof FileFormatError ? error.message : "Impossible de lire ce fichier.",
    );
    return;
  }
  if (!(await askBeforeDroppingChanges("open"))) return;
  useEditorStore.getState().openDocument(doc);
  currentFile = { name: file.name, handle };
}

/**
 * Lets the user pick a schematic file and opens it. The file is chosen before the question about
 * unsaved changes: the file dialogs need a click of the user each, and "Enregistrer et ouvrir"
 * may use its click for the save dialog (#332).
 */
export function openFile() {
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

/**
 * The text of an LTspice schematic. LTspice writes UTF-16 LE (with or without its byte order
 * mark) or 8-bit text, UTF-8 for recent versions and Windows-1252 for older ones.
 */
export async function decodeAsc(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  // No mark: an ASCII first character followed by a zero byte ("V\0e\0r\0…") is UTF-16 LE.
  if (bytes.length > 1 && bytes[0] !== 0 && bytes[1] === 0) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** The messages of a list of diagnostics, one per line, for a message box. */
const bulletList = (diagnostics: { message: string }[]) =>
  diagnostics.map((d) => `• ${d.message}`).join("\n");

/**
 * Opens what the backend made of an LTspice schematic: a new unsaved document (saving it asks
 * where, the `.asc` file is never overwritten), with the analysis of the file if it has one.
 * What was left out or adapted is listed to the user. The question about unsaved changes comes
 * once there is something to open.
 */
async function openImported(result: ImportResult) {
  const errors = result.errors ?? [];
  const warnings = result.warnings ?? [];
  if (!result.schematic) {
    window.alert(
      errors.length > 0
        ? `Ce fichier LTspice n'a pas pu être importé :\n${bulletList(errors)}`
        : "Ce fichier LTspice n'a pas pu être importé.",
    );
    return;
  }
  const { components = [], junctions = [], wires = [], texts = [] } = result.schematic;
  let doc;
  try {
    doc = readDoc({
      components,
      junctions,
      texts,
      wires: wires.map((w) => ({ ...w, points: w.points ?? [] })),
    });
  } catch (error: unknown) {
    window.alert(
      error instanceof FileFormatError
        ? `Le schéma importé ne peut pas être ouvert : ${error.message}`
        : "Le schéma importé ne peut pas être ouvert.",
    );
    return;
  }
  if (!(await askBeforeDroppingChanges("import"))) return;
  const store = useEditorStore.getState();
  store.openDocument(doc, true);
  if (result.analysis) store.setAnalysis(analysisSettings(result.analysis));
  currentFile = null;
  if (warnings.length > 0) {
    window.alert(`Schéma LTspice importé, avec ces remarques :\n${bulletList(warnings)}`);
  }
}

/** Sends an LTspice schematic to the backend and opens the result (#225). */
async function importContent(file: File) {
  let result: ImportResult;
  try {
    const title = file.name.replace(/\.asc$/i, "");
    result = await importAsc({ text: await decodeAsc(file), title });
  } catch (error: unknown) {
    window.alert(
      error instanceof ApiError
        ? `Impossible d'importer ce fichier LTspice : ${error.message}`
        : "Impossible de lire ce fichier.",
    );
    return;
  }
  await openImported(result);
}

/**
 * Lets the user pick an LTspice schematic (`.asc`) and imports it (#225). The file is chosen
 * before the question about unsaved changes, as for Open.
 */
export function importLtspice() {
  const api = pickers();
  if (api) {
    api
      .showOpenFilePicker({ types: ASC_TYPES })
      .then(async (handles) => {
        const handle = handles[0];
        if (handle) await importContent(await handle.getFile());
      })
      .catch((error: unknown) => {
        if (!isCancel(error)) window.alert("Impossible d'ouvrir ce fichier.");
      });
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".asc";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void importContent(file);
  });
  input.click();
}

/** What a dropped file is, by its name: a schematic, an LTspice schematic, or something else. */
export function droppedFileKind(name: string): "schematic" | "ltspice" | "other" {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return "schematic";
  if (lower.endsWith(".asc")) return "ltspice";
  return "other";
}

/**
 * Opens a file dropped on the window (#277), like Ctrl+O: the same question if there are unsaved
 * changes. With its `handle` (WebView2, Chrome), Ctrl+S then writes back to that file.
 * An LTspice `.asc` file is imported (#225); any other file is refused with a message.
 */
export async function openDroppedFile(file: File, handle: FileSystemFileHandle | null = null) {
  switch (droppedFileKind(file.name)) {
    case "ltspice":
      await importContent(file);
      return;
    case "other":
      window.alert(
        `« ${file.name} » n'est pas un schéma Psice. ` +
          "Déposez un fichier .psice.json, ou un schéma LTspice .asc, pour l'ouvrir.",
      );
      return;
    case "schematic":
      await openContent(file, handle);
  }
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

/** localStorage key of the last format chosen for the image export. */
export const EXPORT_FORMAT_KEY = "psice.export.format";

/** Last format chosen for the image export (PNG by default). */
export function exportFormat(): ImageFormat {
  try {
    return window.localStorage.getItem(EXPORT_FORMAT_KEY) === "svg" ? "svg" : "png";
  } catch {
    return "png";
  }
}

/** Remembers the image format for the next exports. */
export function setExportFormat(format: ImageFormat) {
  try {
    window.localStorage.setItem(EXPORT_FORMAT_KEY, format);
  } catch {
    // Storage blocked: the choice is simply not kept.
  }
}

/**
 * Exports the schematic as an image, to put in a report: the whole circuit, without the grid nor
 * the selection, on a white background, or a transparent one if asked (#195). PNG (#112) by
 * default, or SVG, which stays sharp at any size (#279).
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
  const format = options.format ?? "png";
  await saveNewFile(IMAGE_FILE_NAMES[format], image, IMAGE_TYPES[format]);
}
