import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { EditorToolbar } from "./Toolbar";

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
    await user.click(button("Coller (Ctrl+V)"));
    await user.click(button("Dupliquer (Ctrl+D)"));
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
});
