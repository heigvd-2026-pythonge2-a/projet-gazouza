import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { fixtureDoc } from "../store/testFixtures";

// fileActions remembers the current file in its module: each test loads it (and the store it
// uses) afresh.
async function load() {
  vi.resetModules();
  const actions = await import("./fileActions");
  const store = await import("../store");
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

    // Saved already: nothing to do.
    f.saveFile();
    f.state().dropComponent("capacitor", { x: 4, y: 0 });
    f.saveFile();
    await vi.waitFor(() => expect(handle.written).toHaveLength(2));
    expect(showSaveFilePicker).toHaveBeenCalledOnce();
    expect(f.parseDoc(handle.written[1]!).components).toHaveLength(2);
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

    f.saveFile();
    expect(click).toHaveBeenCalledOnce();
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe(f.DEFAULT_FILE_NAME);
    expect(f.isUnsaved(f.state())).toBe(false);
  });
});
