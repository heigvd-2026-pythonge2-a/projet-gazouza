import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useThemeStore } from "../store";
import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { TRANSPARENT_EXPORT_KEY } from "./fileActions";
import { EditorToolbar } from "./Toolbar";
import { registerViewCommands } from "./viewCommands";

beforeEach(resetEditorStore);
afterEach(() => vi.restoreAllMocks());

const button = (name: string | RegExp) => screen.getByRole("button", { name });

describe("EditorToolbar", () => {
  it("greys out what cannot apply on an empty schematic", () => {
    render(<EditorToolbar />);
    for (const name of [
      "Annuler (Ctrl+Z)",
      "Rétablir (Ctrl+Y)",
      "Supprimer (Suppr)",
      "Tourner (R)",
      "Miroir (M)",
      "Copier (Ctrl+C)",
      "Coller (Ctrl+V)",
      "Dupliquer (Ctrl+D)",
    ]) {
      expect(button(name)).toBeDisabled();
    }
    expect(button(/^Importer un fichier LTspice/)).toBeDisabled();
    expect(button("Nouveau schéma (Ctrl+N)")).toBeEnabled();
  });

  it("enables the edit buttons once a component is selected, and they act on it", async () => {
    const user = userEvent.setup();
    render(<EditorToolbar />);
    act(() => void dropComponent("resistor"));

    await user.click(button("Tourner (R)"));
    expect(editorState().doc.components[0]!.rotation).toBe(90);
    await user.click(button("Miroir (M)"));
    expect(editorState().doc.components[0]!.mirror).toBe(true);

    expect(button("Coller (Ctrl+V)")).toBeDisabled();
    await user.click(button("Copier (Ctrl+C)"));
    // The copy follows the mouse on the schematic until a click there drops it.
    await user.click(button("Coller (Ctrl+V)"));
    expect(editorState().tool.kind).toBe("paste");
    act(() => editorState().pasteAt({ x: 10, y: 0 }));
    await user.click(button("Dupliquer (Ctrl+D)"));
    act(() => editorState().pasteAt({ x: 20, y: 0 }));
    expect(editorState().doc.components.map((c) => c.name)).toEqual(["R1", "R2", "R3"]);

    await user.click(button("Supprimer (Suppr)"));
    expect(editorState().doc.components).toHaveLength(2);
  });

  it("undoes and redoes", async () => {
    const user = userEvent.setup();
    render(<EditorToolbar />);
    act(() => void dropComponent("resistor"));
    await user.click(button("Annuler (Ctrl+Z)"));
    expect(editorState().doc.components).toEqual([]);
    expect(button("Annuler (Ctrl+Z)")).toBeDisabled();
    await user.click(button("Rétablir (Ctrl+Y)"));
    expect(editorState().doc.components).toHaveLength(1);
  });

  it("marks unsaved changes on the save button", () => {
    render(<EditorToolbar />);
    expect(button("Enregistrer le schéma (Ctrl+S)")).toBeInTheDocument();
    act(() => void dropComponent("resistor"));
    expect(button(/modifications non enregistrées/)).toBeInTheDocument();
  });

  it("asks before dropping unsaved changes on New", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<EditorToolbar />);
    act(() => void dropComponent("resistor"));

    await user.click(button("Nouveau schéma (Ctrl+N)"));
    expect(confirm).toHaveBeenCalledOnce();
    expect(editorState().doc.components).toHaveLength(1);

    confirm.mockReturnValue(true);
    await user.click(button("Nouveau schéma (Ctrl+N)"));
    expect(editorState().doc.components).toEqual([]);
  });

  it("exports on a white background unless the transparent box is checked, and keeps it", async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem(TRANSPARENT_EXPORT_KEY);
    vi.spyOn(window, "alert").mockImplementation(() => {});
    const exportImage = vi.fn(async () => null);
    const unregister = registerViewCommands({ zoomIn() {}, zoomOut() {}, fit() {}, exportImage });
    render(<EditorToolbar />);
    act(() => void dropComponent("resistor"));

    const open = button("Exporter le schéma en image PNG…");
    await user.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");
    const box = screen.getByRole("checkbox", { name: /Fond transparent/ });
    expect(box).not.toBeChecked();
    await user.click(button("Exporter…"));
    expect(exportImage).toHaveBeenLastCalledWith({ transparent: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(open);
    await user.click(screen.getByRole("checkbox", { name: /Fond transparent/ }));
    await user.click(button("Exporter…"));
    expect(exportImage).toHaveBeenLastCalledWith({ transparent: true });
    expect(window.localStorage.getItem(TRANSPARENT_EXPORT_KEY)).toBe("true");

    // Reopened: the last choice is kept; Escape closes without exporting.
    await user.click(open);
    expect(screen.getByRole("checkbox", { name: /Fond transparent/ })).toBeChecked();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(exportImage).toHaveBeenCalledTimes(2);
    unregister();
  });

  it("switches between the light and the night-blue theme", async () => {
    useThemeStore.setState({ theme: "light", chosen: false });
    const user = userEvent.setup();
    render(<EditorToolbar />);
    await user.click(button("Passer au thème bleu nuit"));
    expect(useThemeStore.getState()).toMatchObject({ theme: "dark", chosen: true });
    await user.click(button("Passer au thème clair"));
    expect(useThemeStore.getState().theme).toBe("light");
  });
});
