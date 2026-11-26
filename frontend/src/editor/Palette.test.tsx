import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { editorState, resetEditorStore } from "../test/editorStore";
import { DRAG_TYPE, Palette } from "./Palette";

beforeEach(resetEditorStore);

const tile = (label: string) => screen.getByRole("button", { name: new RegExp(`^\\d?${label}$`) });

describe("Palette", () => {
  it("groups the components by category, with their digit key", () => {
    render(<Palette />);
    for (const group of ["Passifs", "Sources", "Connexions"]) {
      expect(screen.getByRole("region", { name: group })).toBeInTheDocument();
    }
    expect(tile("Résistance")).toHaveAttribute("aria-keyshortcuts", "1");
    expect(tile("Fil")).toHaveAttribute("aria-keyshortcuts");
  });

  it("starts placing a component, or drawing wires, on a click", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.click(tile("Condensateur"));
    expect(editorState().tool).toMatchObject({ kind: "place", type: "capacitor" });
    await user.click(tile("Fil"));
    expect(editorState().tool).toEqual({ kind: "wire" });
  });

  it("puts the component type in the data of a drag", () => {
    render(<Palette />);
    const setData = vi.fn();
    fireEvent.dragStart(tile("Résistance"), { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith(DRAG_TYPE, "resistor");
    expect(tile("Fil")).not.toHaveAttribute("draggable", "true");
  });

  it("narrows the palette to what the search matches, accents ignored", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.type(screen.getByRole("searchbox", { name: "Rechercher un composant" }), "resist");
    expect(tile("Résistance")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Condensateur/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sources" })).not.toBeInTheDocument();
    // The digit key stays the one of the whole palette.
    expect(tile("Résistance")).toHaveAttribute("aria-keyshortcuts", "1");
  });

  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByRole("status")).toHaveTextContent("Aucun composant");
  });

  it("picks the first result with Enter, and clears the field with Escape", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    const search = screen.getByRole("searchbox");
    await user.type(search, "bobine{Enter}");
    expect(editorState().tool).toMatchObject({ kind: "place", type: "inductor" });
    expect(search).not.toHaveFocus();
    await user.click(search);
    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(tile("Condensateur")).toBeInTheDocument();
  });

  it("goes to the search field with Ctrl+F", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.keyboard("{Control>}f{/Control}");
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });
});
