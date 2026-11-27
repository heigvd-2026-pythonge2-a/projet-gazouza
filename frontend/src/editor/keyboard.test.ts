import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { newFile, openFile, saveFile, saveFileAs } from "./fileActions";
import { handleEditorKey, useKeyboardShortcuts } from "./keyboard";
import { entryForKey } from "./paletteLayout";

// The file shortcuts open dialogs: only check that they are called.
vi.mock("./fileActions", () => ({
  newFile: vi.fn(),
  openFile: vi.fn(),
  saveFile: vi.fn(),
  saveFileAs: vi.fn(),
}));

beforeEach(resetEditorStore);
afterEach(() => vi.clearAllMocks());

/** Presses `key` on the page (on `target` if given), and returns the event to read its state. */
function press(key: string, options: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

const ctrl = (key: string, options: KeyboardEventInit = {}) =>
  press(key, { ctrlKey: true, ...options });

describe("useKeyboardShortcuts", () => {
  it("listens to the keys only while mounted", () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts());
    press("w");
    expect(editorState().tool.kind).toBe("wire");
    unmount();
    press("t");
    expect(editorState().tool.kind).toBe("wire");
  });
});

describe("handleEditorKey", () => {
  beforeEach(() => window.addEventListener("keydown", handleEditorKey));
  afterEach(() => window.removeEventListener("keydown", handleEditorKey));

  it("undoes with Ctrl+Z and redoes with Ctrl+Y or Ctrl+Shift+Z", () => {
    dropComponent("resistor");
    expect(ctrl("z").defaultPrevented).toBe(true);
    expect(editorState().doc.components).toHaveLength(0);
    ctrl("y");
    expect(editorState().doc.components).toHaveLength(1);
    ctrl("z");
    ctrl("Z", { shiftKey: true });
    expect(editorState().doc.components).toHaveLength(1);
  });

  it("selects all, copies, pastes and duplicates", () => {
    const r1 = dropComponent("resistor", { x: 0, y: 0 });
    const r2 = dropComponent("resistor", { x: 6, y: 0 });
    editorState().select([]);
    ctrl("a");
    expect(new Set(editorState().selection)).toEqual(new Set([r1.id, r2.id]));
    ctrl("c");
    ctrl("v");
    expect(editorState().tool.kind).toBe("paste");
    editorState().cancel();
    editorState().select([r1.id]);
    // Meta (Cmd) works as Ctrl.
    expect(press("d", { metaKey: true }).defaultPrevented).toBe(true);
    expect(editorState().tool.kind).toBe("paste");
  });

  it("runs the file commands", () => {
    ctrl("n");
    ctrl("o");
    ctrl("s");
    ctrl("S", { shiftKey: true });
    expect(newFile).toHaveBeenCalledOnce();
    expect(openFile).toHaveBeenCalledOnce();
    expect(saveFile).toHaveBeenCalledOnce();
    expect(saveFileAs).toHaveBeenCalledOnce();
  });

  it("leaves the other Ctrl and Alt keys to the browser", () => {
    // Ctrl+F is handled by the palette (search), not here.
    expect(ctrl("f").defaultPrevented).toBe(false);
    dropComponent("resistor");
    expect(ctrl("z", { altKey: true }).defaultPrevented).toBe(false);
    expect(press("r", { altKey: true }).defaultPrevented).toBe(false);
    expect(editorState().doc.components[0]!.rotation).toBe(0);
  });

  it("ignores the keys typed in a text field", () => {
    const input = document.createElement("input");
    document.body.append(input);
    dropComponent("resistor");
    expect(press("Delete", {}, input).defaultPrevented).toBe(false);
    expect(press("z", { ctrlKey: true }, input).defaultPrevented).toBe(false);
    expect(editorState().doc.components).toHaveLength(1);
    input.remove();
  });

  it("moves the selection with the arrows, in a single undo step", () => {
    const r = dropComponent("resistor", { x: 0, y: 0 });
    press("ArrowRight");
    press("ArrowRight");
    press("ArrowDown");
    press("ArrowLeft");
    press("ArrowUp");
    press("ArrowUp");
    expect(editorState().doc.components[0]!.position).toEqual({ x: 1, y: -1 });
    ctrl("z");
    expect(editorState().doc.components[0]!.position).toEqual(r.position);
  });

  it("lets the arrows scroll the page when nothing is selected or another tool is on", () => {
    dropComponent("resistor");
    editorState().select([]);
    expect(press("ArrowRight").defaultPrevented).toBe(false);
    editorState().selectAll();
    editorState().startWiring();
    expect(press("ArrowRight").defaultPrevented).toBe(false);
  });

  it("picks the palette tool of a digit key", () => {
    for (let n = 1; n <= 9; n++) {
      const entry = entryForKey(String(n));
      if (!entry) continue;
      press(String(n));
      const tool = editorState().tool;
      if (entry.kind === "wire") expect(tool.kind).toBe("wire");
      else expect(tool).toMatchObject({ kind: "place", type: entry.def.type });
    }
    expect(entryForKey("1")).toBeDefined();
  });

  it("rotates by 90° with R and by 45° with Shift+R, and mirrors with M", () => {
    dropComponent("resistor");
    press("r");
    expect(editorState().doc.components[0]!.rotation).toBe(90);
    press("R", { shiftKey: true });
    expect(editorState().doc.components[0]!.rotation).toBe(135);
    press("m");
    expect(editorState().doc.components[0]!.mirror).toBe(true);
    expect(press("o").defaultPrevented).toBe(true);
  });

  it.each([
    ["w", "wire"],
    ["W", "wire"],
    ["t", "text"],
    ["T", "text"],
    ["p", "probe"],
    ["P", "probe"],
  ])("starts a tool with %s", (key, kind) => {
    press(key);
    expect(editorState().tool.kind).toBe(kind);
    press("Escape");
    expect(editorState().tool.kind).toBe("select");
  });

  it.each(["Delete", "Backspace"])("deletes the selection with %s", (key) => {
    dropComponent("resistor");
    press(key);
    expect(editorState().doc.components).toHaveLength(0);
  });

  it("leaves the keys it does not use to the browser", () => {
    expect(press("x").defaultPrevented).toBe(false);
    expect(press("Enter").defaultPrevented).toBe(false);
  });
});
