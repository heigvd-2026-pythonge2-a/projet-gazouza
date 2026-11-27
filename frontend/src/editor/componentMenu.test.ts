import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { componentMenu } from "./componentMenu";
import { focusInspector } from "./inspectorFocus";

vi.mock("./inspectorFocus", () => ({ focusInspector: vi.fn() }));

beforeEach(resetEditorStore);
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

/** Runs the menu item labelled `label`, for a selection of `size` items. */
function choose(label: string, size = 1) {
  const item = componentMenu(size).find((i) => i.label === label);
  if (!item) throw new Error(`no item "${label}"`);
  item.onSelect();
}

const first = () => editorState().doc.components[0]!;

describe("componentMenu", () => {
  it("shows the keyboard shortcut of each action", () => {
    expect(componentMenu(1).map((i) => [i.label, i.shortcut])).toEqual([
      ["Tourner", "R"],
      ["Tourner de 45°", "Maj+R"],
      ["Miroir", "M"],
      ["Replacer les textes automatiquement", "O"],
      ["Dupliquer", "Ctrl+D"],
      ["Copier", "Ctrl+C"],
      ["Supprimer", "Suppr"],
      ["Propriétés…", undefined],
    ]);
  });

  it("offers the properties of a single component only", () => {
    const properties = (size: number) => componentMenu(size).find((i) => i.label === "Propriétés…");
    expect(properties(1)?.disabled).toBe(false);
    expect(properties(2)?.disabled).toBe(true);
    expect(componentMenu(2).filter((i) => i.disabled)).toHaveLength(1);
  });

  it("turns and mirrors the selection", () => {
    dropComponent("resistor");
    choose("Tourner");
    expect(first().rotation).toBe(90);
    choose("Tourner de 45°");
    expect(first().rotation).toBe(135);
    choose("Miroir");
    expect(first().mirror).toBe(true);
    choose("Replacer les textes automatiquement");
    expect(editorState().doc.components).toHaveLength(1);
  });

  it("copies, duplicates and deletes the selection", () => {
    dropComponent("resistor");
    choose("Copier");
    expect(editorState().clipboard).not.toBeNull();
    choose("Dupliquer");
    expect(editorState().tool.kind).toBe("paste");
    editorState().cancel();
    editorState().select([first().id]);
    choose("Supprimer");
    expect(editorState().doc.components).toHaveLength(0);
  });

  it("opens the properties panel once the menu has closed", () => {
    vi.useFakeTimers();
    choose("Propriétés…");
    expect(focusInspector).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(focusInspector).toHaveBeenCalledOnce();
  });
});
