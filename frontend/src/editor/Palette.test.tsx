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
});
