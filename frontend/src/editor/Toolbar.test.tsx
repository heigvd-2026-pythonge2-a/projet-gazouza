import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useThemeStore } from "../store";
import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { CloseDialog } from "./CloseDialog";
import { EXPORT_FORMAT_KEY, TRANSPARENT_EXPORT_KEY } from "./fileActions";
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
    expect(button(/^Importer un schéma LTspice/)).toBeEnabled();
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

  it("asks before dropping unsaved changes on New, in the Psice dialog (#332)", async () => {
    const user = userEvent.setup();
    render(
      <>
        <EditorToolbar />
        <CloseDialog />
      </>,
    );
    act(() => void dropComponent("resistor"));

    await user.click(button("Nouveau schéma (Ctrl+N)"));
    expect(screen.getByRole("alertdialog", { name: "Nouveau schéma" })).toBeInTheDocument();
    await user.click(button("Annuler"));
    expect(editorState().doc.components).toHaveLength(1);

    await user.click(button("Nouveau schéma (Ctrl+N)"));
    await user.click(button("Créer sans enregistrer"));
    expect(editorState().doc.components).toEqual([]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("exports on a white background unless the transparent box is checked, and keeps it", async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem(TRANSPARENT_EXPORT_KEY);
    window.localStorage.removeItem(EXPORT_FORMAT_KEY);
    vi.spyOn(window, "alert").mockImplementation(() => {});
    const exportImage = vi.fn(async () => null);
    const unregister = registerViewCommands({
      zoomIn() {},
      zoomOut() {},
      fit() {},
      show() {},
      exportImage,
    });
    render(<EditorToolbar />);
    act(() => void dropComponent("resistor"));

    const open = button("Exporter le schéma en image (PNG ou SVG)…");
    await user.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");
    const box = screen.getByRole("checkbox", { name: /Fond transparent/ });
    expect(box).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /PNG/ })).toBeChecked();
    await user.click(button("Exporter…"));
    expect(exportImage).toHaveBeenLastCalledWith({ transparent: false, format: "png" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(open);
    await user.click(screen.getByRole("checkbox", { name: /Fond transparent/ }));
    await user.click(button("Exporter…"));
    expect(exportImage).toHaveBeenLastCalledWith({ transparent: true, format: "png" });
    expect(window.localStorage.getItem(TRANSPARENT_EXPORT_KEY)).toBe("true");

    // Reopened: the last choice is kept; Escape closes without exporting.
    await user.click(open);
    expect(screen.getByRole("checkbox", { name: /Fond transparent/ })).toBeChecked();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(exportImage).toHaveBeenCalledTimes(2);

    // SVG: chosen, used, and kept for the next export.
    await user.click(open);
    await user.click(screen.getByRole("radio", { name: /SVG/ }));
    await user.click(button("Exporter…"));
    expect(exportImage).toHaveBeenLastCalledWith({ transparent: true, format: "svg" });
    expect(window.localStorage.getItem(EXPORT_FORMAT_KEY)).toBe("svg");
    await user.click(open);
    expect(screen.getByRole("radio", { name: /SVG/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /SVG/ })).toHaveFocus();
    await user.keyboard("{Escape}");
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

  it("opens an example with its analysis, after asking about unsaved changes", async () => {
    const user = userEvent.setup();
    render(
      <>
        <EditorToolbar />
        <CloseDialog />
      </>,
    );
    act(() => void dropComponent("resistor"));

    await user.click(button("Ouvrir un exemple prêt à simuler"));
    await user.click(screen.getByRole("menuitem", { name: /^Filtre passe-bas RC/ }));
    expect(screen.getByRole("alertdialog", { name: "Ouvrir un exemple" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(editorState().doc.components.map((c) => c.type)).toEqual(["resistor"]);
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(button("Ouvrir un exemple prêt à simuler"));
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await user.click(button("Ouvrir sans enregistrer"));
    expect(editorState().doc.components.some((c) => c.type === "capacitor")).toBe(true);
    expect(editorState().analysis).toMatchObject({ kind: "ac", acStop: "100k" });
  });

  it("closes the examples menu on Escape", async () => {
    const user = userEvent.setup();
    render(<EditorToolbar />);
    await user.click(button("Ouvrir un exemple prêt à simuler"));
    expect(screen.getByRole("menu", { name: "Exemples" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button("Ouvrir un exemple prêt à simuler")).toHaveFocus();
  });

  it("closes the examples menu when the focus leaves it", async () => {
    const user = userEvent.setup();
    render(<EditorToolbar />);
    await user.click(button("Ouvrir un exemple prêt à simuler"));
    await user.tab();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
