import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import rcAnalysis from "../../../shared/fixtures/rc_tran/analysis.json";
import rcSchematic from "../../../shared/fixtures/rc_tran/schematic.json";
import { fixtureDoc, fixtureLibrary } from "../store/testFixtures";

// fileActions remembers the current file in its module: each test loads it (and the store it
// uses) afresh.
async function load() {
  vi.resetModules();
  const actions = await import("./fileActions");
  const store = await import("../store");
  store.setLibrary(fixtureLibrary()); // the fresh store has an empty library
  return { ...actions, ...store, state: () => store.useEditorStore.getState() };
}

/** A file handle of the File System Access API that keeps what is written to it. */
function fakeHandle(name: string, content = "") {
  const handle = {
    name,
    written: [] as string[],
    getFile: async () => new File([content], name),
    createWritable: async () => ({
      write: async (text: string) => void handle.written.push(text),
      close: async () => {},
    }),
  };
  return handle;
}

function stubPickers(save: ReturnType<typeof fakeHandle>, open?: ReturnType<typeof fakeHandle>) {
  const showSaveFilePicker = vi.fn(async () => save);
  const showOpenFilePicker = vi.fn(async () => (open ? [open] : []));
  vi.stubGlobal("showSaveFilePicker", showSaveFilePicker);
  vi.stubGlobal("showOpenFilePicker", showOpenFilePicker);
  return { showSaveFilePicker, showOpenFilePicker };
}

const abort = () => new DOMException("The user aborted a request.", "AbortError");

let alert: ReturnType<typeof vi.fn>;
beforeEach(() => {
  alert = vi.fn();
  vi.stubGlobal("alert", alert);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("saving with the system file dialogs", () => {
  it("asks where the first time, then writes to the same file", async () => {
    const f = await load();
    const handle = fakeHandle("circuit.psice.json");
    const { showSaveFilePicker } = stubPickers(handle);
    f.state().dropComponent("resistor", { x: 0, y: 0 });

    f.saveFile();
    await vi.waitFor(() => expect(f.isUnsaved(f.state())).toBe(false));
    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: f.DEFAULT_FILE_NAME }),
    );
    expect(f.parseDoc(handle.written[0]!)).toEqual(f.state().doc);

    f.state().dropComponent("capacitor", { x: 4, y: 0 });
    f.saveFile();
    await vi.waitFor(() => expect(handle.written).toHaveLength(2));
    expect(showSaveFilePicker).toHaveBeenCalledOnce();
    expect(f.parseDoc(handle.written[1]!).components).toHaveLength(2);
  });

  it("saves again without changes, and asks where if the file cannot be written (#94)", async () => {
    const f = await load();
    const first = fakeHandle("circuit.psice.json");
    const { showSaveFilePicker } = stubPickers(first);
    f.state().dropComponent("resistor", { x: 0, y: 0 });
    f.saveFile();
    await vi.waitFor(() => expect(f.isUnsaved(f.state())).toBe(false));

    // Nothing changed: written again all the same.
    f.saveFile();
    await vi.waitFor(() => expect(first.written).toHaveLength(2));

    // The file was deleted: writing to it fails, the dialog asks for another one.
    first.createWritable = async () => {
      throw new DOMException("gone", "NotFoundError");
    };
    const second = fakeHandle("nouveau.psice.json");
    showSaveFilePicker.mockResolvedValue(second);
    f.saveFile();
    await vi.waitFor(() => expect(second.written).toHaveLength(1));
    expect(showSaveFilePicker).toHaveBeenCalledTimes(2);
    expect(alert).not.toHaveBeenCalled();
  });

  it("saves as another file", async () => {
    const f = await load();
    const first = fakeHandle("a.psice.json");
    const { showSaveFilePicker } = stubPickers(first);
    f.state().dropComponent("resistor", { x: 0, y: 0 });
    f.saveFile();
    await vi.waitFor(() => expect(first.written).toHaveLength(1));
    const second = fakeHandle("b.psice.json");
    showSaveFilePicker.mockResolvedValue(second);
    f.saveFileAs();
    await vi.waitFor(() => expect(second.written).toHaveLength(1));
    expect(first.written).toHaveLength(1);
  });

  it("exports the schematic as a PNG image", async () => {
    const f = await load();
    const views = await import("./viewCommands");
    const image = new Blob(["png"], { type: "image/png" });
    const exportImage = vi.fn(async () => image);
    views.registerViewCommands({ zoomIn() {}, zoomOut() {}, fit() {}, show() {}, exportImage });
    const handle = fakeHandle(f.IMAGE_FILE_NAMES.png);
    const written: unknown[] = [];
    handle.createWritable = async () => ({
      write: async (data: unknown) => void written.push(data),
      close: async () => {},
    });
    const { showSaveFilePicker } = stubPickers(handle);

    await f.exportImage();
    expect(alert).toHaveBeenCalledWith(expect.stringMatching(/vide/));
    expect(exportImage).not.toHaveBeenCalled();

    f.state().dropComponent("resistor", { x: 0, y: 0 });
    await f.exportImage();
    expect(exportImage).toHaveBeenLastCalledWith({ transparent: false });
    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: "schema.png" }),
    );
    expect(written).toEqual([image]);

    await f.exportImage({ transparent: true });
    expect(exportImage).toHaveBeenLastCalledWith({ transparent: true });

    // SVG: its own name and file type.
    await f.exportImage({ transparent: false, format: "svg" });
    expect(exportImage).toHaveBeenLastCalledWith({ transparent: false, format: "svg" });
    expect(showSaveFilePicker).toHaveBeenLastCalledWith({
      suggestedName: "schema.svg",
      types: [{ description: "Image SVG", accept: { "image/svg+xml": [".svg"] } }],
    });
  });

  it("remembers the image format, PNG by default", async () => {
    const f = await load();
    window.localStorage.removeItem(f.EXPORT_FORMAT_KEY);
    expect(f.exportFormat()).toBe("png");
    f.setExportFormat("svg");
    expect(f.exportFormat()).toBe("svg");
    f.setExportFormat("png");
    expect(f.exportFormat()).toBe("png");
  });

  it("remembers the transparent background choice, white by default", async () => {
    const f = await load();
    window.localStorage.removeItem(f.TRANSPARENT_EXPORT_KEY);
    expect(f.exportTransparent()).toBe(false);
    f.setExportTransparent(true);
    expect(f.exportTransparent()).toBe(true);
    f.setExportTransparent(false);
    expect(f.exportTransparent()).toBe(false);
  });

  it("keeps the changes unsaved when the dialog is closed", async () => {
    const f = await load();
    const { showSaveFilePicker } = stubPickers(fakeHandle("x"));
    showSaveFilePicker.mockRejectedValue(abort());
    f.state().dropComponent("resistor", { x: 0, y: 0 });
    f.saveFile();
    await vi.waitFor(() => expect(showSaveFilePicker).toHaveBeenCalled());
    await Promise.resolve();
    expect(f.isUnsaved(f.state())).toBe(true);
    expect(alert).not.toHaveBeenCalled();
  });

  it("tells whether the schematic was saved (#238)", async () => {
    const f = await load();
    const handle = fakeHandle("circuit.psice.json");
    const { showSaveFilePicker } = stubPickers(handle);
    f.state().dropComponent("resistor", { x: 0, y: 0 });

    // Dialog closed: not saved.
    showSaveFilePicker.mockRejectedValueOnce(abort());
    expect(await f.saveFile()).toBe(false);
    expect(f.isUnsaved(f.state())).toBe(true);

    // First save asks where, the next one writes to the same file.
    expect(await f.saveFile()).toBe(true);
    expect(f.isUnsaved(f.state())).toBe(false);
    expect(await f.saveFile()).toBe(true);
    expect(showSaveFilePicker).toHaveBeenCalledTimes(2);

    // The file cannot be written any more, nor the one picked instead: not saved, user told.
    handle.createWritable = async () => {
      throw new DOMException("read-only", "NoModificationAllowedError");
    };
    f.state().dropComponent("capacitor", { x: 4, y: 0 });
    expect(await f.saveFile()).toBe(false);
    expect(alert).toHaveBeenCalledOnce();
    expect(f.isUnsaved(f.state())).toBe(true);
  });

  it("waits for the save in progress instead of saving twice", async () => {
    const f = await load();
    const handle = fakeHandle("circuit.psice.json");
    const { showSaveFilePicker } = stubPickers(handle);
    let pick: (h: typeof handle) => void = () => {};
    showSaveFilePicker.mockImplementationOnce(() => new Promise((r) => (pick = r)));
    f.state().dropComponent("resistor", { x: 0, y: 0 });

    const first = f.saveFile();
    const second = f.saveFile();
    pick(handle);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(showSaveFilePicker).toHaveBeenCalledOnce();
    expect(handle.written).toHaveLength(1);
  });

  it("saves a rescue copy in a new file, without marking the document saved", async () => {
    const f = await load();
    const handle = fakeHandle("schema-recupere.psice.json");
    const { showSaveFilePicker } = stubPickers(handle);
    f.state().dropComponent("resistor", { x: 0, y: 0 });
    f.saveRescueCopy();
    await vi.waitFor(() => expect(handle.written).toHaveLength(1));
    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: "schema-recupere.psice.json" }),
    );
    expect(f.isUnsaved(f.state())).toBe(true);
  });
});

describe("opening with the system file dialogs", () => {
  it("opens a schematic file", async () => {
    const f = await load();
    const doc = fixtureDoc("divider_op");
    stubPickers(fakeHandle("x"), fakeHandle("diviseur.psice.json", f.serializeDoc(doc)));
    f.openFile();
    await vi.waitFor(() => expect(f.state().doc).toEqual(doc));
    expect(f.isUnsaved(f.state())).toBe(false);
  });

  it("tells why a file cannot be opened, and keeps the current schematic", async () => {
    const f = await load();
    stubPickers(fakeHandle("x"), fakeHandle("autre.json", '{"format": "other"}'));
    f.state().dropComponent("resistor", { x: 0, y: 0 });
    f.state().markSaved(f.state().doc);
    f.openFile();
    await vi.waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0]![0]).toMatch(/pas un schéma Psice valide \(format inconnu\)/);
    expect(f.state().doc.components).toHaveLength(1);
  });

  it("does not open anything if the user keeps unsaved changes", async () => {
    const f = await load();
    const { showOpenFilePicker } = stubPickers(fakeHandle("x"), fakeHandle("y", "{}"));
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    f.state().dropComponent("resistor", { x: 0, y: 0 });
    f.openFile();
    expect(showOpenFilePicker).not.toHaveBeenCalled();
  });
});

describe("without the file dialogs (other browsers)", () => {
  it("downloads the file on save", async () => {
    const f = await load();
    // jsdom has no object URLs: add them for this test only.
    URL.createObjectURL = vi.fn(() => "blob:psice");
    URL.revokeObjectURL = vi.fn();
    onTestFinished(() => {
      delete (URL as { createObjectURL?: unknown }).createObjectURL;
      delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    f.state().dropComponent("resistor", { x: 0, y: 0 });

    const saved = f.saveFile();
    expect(click).toHaveBeenCalledOnce();
    expect(await saved).toBe(true);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe(f.DEFAULT_FILE_NAME);
    expect(f.isUnsaved(f.state())).toBe(false);
  });
});

describe("opening a dropped file (#277)", () => {
  it("opens a schematic, and saves back to its file when the drop gave its handle", async () => {
    const f = await load();
    const handle = fakeHandle("pont.psice.json");
    const file = new File([f.serializeDoc(fixtureDoc("divider_op"))], "pont.psice.json");
    await f.openDroppedFile(file, handle as unknown as FileSystemFileHandle);
    expect(f.state().doc.components.length).toBeGreaterThan(0);
    expect(f.isUnsaved(f.state())).toBe(false);
    const { showSaveFilePicker } = stubPickers(fakeHandle("other"));
    await f.saveFile();
    expect(handle.written).toHaveLength(1);
    expect(showSaveFilePicker).not.toHaveBeenCalled();
  });

  it("asks before dropping unsaved changes", async () => {
    const f = await load();
    f.state().dropComponent("resistor", { x: 0, y: 0 });
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const before = f.state().doc;
    await f.openDroppedFile(new File(["{}"], "x.psice.json"));
    expect(confirm).toHaveBeenCalledOnce();
    expect(f.state().doc).toBe(before);
  });

  it("imports an LTspice schematic (#225)", async () => {
    const f = await load();
    const fetch = stubImport({ schematic: rcSchematic, analysis: rcAnalysis });
    await f.openDroppedFile(new File(["Version 4"], "filtre.ASC"));
    expect(fetch).toHaveBeenCalledWith("/api/import/asc", expect.anything());
    expect(f.state().doc.components).toHaveLength(rcSchematic.components.length);
  });

  it("refuses any other file, with a message", async () => {
    const f = await load();
    const before = f.state().doc;
    await f.openDroppedFile(new File(["x"], "photo.png"));
    expect(alert).toHaveBeenLastCalledWith(
      expect.stringMatching(/« photo\.png » n'est pas un schéma/),
    );
    expect(f.state().doc).toBe(before);
  });

  it("tells why a broken schematic cannot be opened", async () => {
    const f = await load();
    await f.openDroppedFile(new File(["not json"], "cassé.json"));
    expect(alert).toHaveBeenCalledOnce();
  });
});

/** Answers POST /api/import/asc with `result`, and keeps the requests. */
function stubImport(result: unknown, status = 200) {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify(result), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** The bytes of `text` in UTF-16 LE, with the byte order mark or not. */
function utf16le(text: string, bom: boolean): Uint8Array<ArrayBuffer> {
  const start = bom ? 2 : 0;
  const bytes = new Uint8Array(start + text.length * 2);
  if (bom) bytes.set([0xff, 0xfe]);
  for (let i = 0; i < text.length; i++) {
    bytes[start + i * 2] = text.charCodeAt(i) & 0xff;
    bytes[start + i * 2 + 1] = text.charCodeAt(i) >> 8;
  }
  return bytes;
}

describe("reading an LTspice file (#225)", () => {
  const text = "Version 4\nSYMBOL res 16 0 R0\nSYMATTR Value 4,7kΩ é\n";

  it("reads UTF-16 LE with or without its byte order mark, and UTF-8", async () => {
    const f = await load();
    expect(await f.decodeAsc(new Blob([utf16le(text, true)]))).toBe(text);
    expect(await f.decodeAsc(new Blob([utf16le(text, false)]))).toBe(text);
    expect(await f.decodeAsc(new Blob([text]))).toBe(text);
  });

  it("reads Windows-1252 text that is not UTF-8", async () => {
    const f = await load();
    // "µF é" in Windows-1252: not valid UTF-8.
    expect(await f.decodeAsc(new Blob([new Uint8Array([0xb5, 0x46, 0x20, 0xe9])]))).toBe("µF é");
  });
});

describe("importing an LTspice schematic (#225)", () => {
  it("opens it as a new unsaved schematic, with its analysis", async () => {
    const f = await load();
    const fetch = stubImport({ schematic: rcSchematic, analysis: rcAnalysis, warnings: [] });
    stubPickers(fakeHandle("unused"), fakeHandle("filtre.asc", "Version 4\n"));

    f.importLtspice();
    await vi.waitFor(() => expect(f.state().doc.components.length).toBeGreaterThan(0));
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({ text: "Version 4\n", title: "filtre" });
    expect(f.state().doc).toEqual(fixtureDoc("rc_tran"));
    expect(f.isUnsaved(f.state())).toBe(true);
    expect(f.state().analysis).toMatchObject({ kind: "tran", stopTime: "5m" });
    expect(alert).not.toHaveBeenCalled();

    // Saving asks where: the .asc file is never written over.
    const target = fakeHandle("filtre.psice.json");
    const { showSaveFilePicker } = stubPickers(target);
    await f.saveFile();
    expect(showSaveFilePicker).toHaveBeenCalledOnce();
    expect(target.written).toHaveLength(1);
  });

  it("lists what was left out or adapted", async () => {
    const f = await load();
    stubImport({
      schematic: rcSchematic,
      warnings: [
        { code: "IMPORT_SKIPPED", message: "U1 (LT1001) ignoré : composant hors bibliothèque." },
      ],
    });
    await f.openDroppedFile(new File(["Version 4"], "ampli.asc"));
    expect(alert).toHaveBeenCalledWith(
      "Schéma LTspice importé, avec ces remarques :\n" +
        "• U1 (LT1001) ignoré : composant hors bibliothèque.",
    );
    expect(f.state().doc.components.length).toBeGreaterThan(0);
  });

  it("keeps the current schematic when nothing could be imported", async () => {
    const f = await load();
    f.state().dropComponent("resistor", { x: 0, y: 0 });
    f.state().markSaved(f.state().doc);
    const before = f.state().doc;
    stubImport({
      schematic: null,
      errors: [{ code: "IMPORT_UNREADABLE", message: "Ce n'est pas un fichier LTspice." }],
    });
    await f.openDroppedFile(new File(["x"], "faux.asc"));
    expect(alert).toHaveBeenCalledWith(
      "Ce fichier LTspice n'a pas pu être importé :\n• Ce n'est pas un fichier LTspice.",
    );
    expect(f.state().doc).toBe(before);
  });

  it("tells when the backend fails", async () => {
    const f = await load();
    stubImport({ detail: "Erreur interne" }, 500);
    await f.openDroppedFile(new File(["x"], "faux.asc"));
    expect(alert).toHaveBeenCalledWith("Impossible d'importer ce fichier LTspice : Erreur interne");
  });

  it("asks before dropping unsaved changes", async () => {
    const f = await load();
    f.state().dropComponent("resistor", { x: 0, y: 0 });
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    const fetch = stubImport({ schematic: rcSchematic });
    f.importLtspice();
    await f.openDroppedFile(new File(["x"], "filtre.asc"));
    expect(fetch).not.toHaveBeenCalled();
  });
});
