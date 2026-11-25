import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

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
    views.registerViewCommands({ zoomIn() {}, zoomOut() {}, fit() {}, exportImage });
    const handle = fakeHandle(f.IMAGE_FILE_NAME);
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
