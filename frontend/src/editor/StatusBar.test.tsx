import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { paletteLayout } from "./paletteLayout";
import { SHORTCUT_GROUPS } from "./shortcuts";
import { StatusBar } from "./StatusBar";

beforeEach(resetEditorStore);

describe("StatusBar", () => {
  it("shows the gestures of the active tool", () => {
    render(<StatusBar />);
    expect(screen.getByText(/Clic : sélectionner/)).toBeInTheDocument();
    act(() => editorState().startWiring());
    expect(screen.getByText(/Double-clic : finir dans le vide/)).toBeInTheDocument();
    act(() => editorState().startPlacing("resistor"));
    expect(screen.getByText(/Clic : poser/)).toBeInTheDocument();
  });

  it("says what is selected and counts the unconnected pins", () => {
    render(<StatusBar />);
    act(() => void dropComponent("resistor"));
    expect(screen.getByText("Sélection : R1")).toBeInTheDocument();
    expect(screen.getByText("2 broches non connectées")).toBeInTheDocument();

    act(() => {
      dropComponent("ground", { x: 10, y: 0 });
      editorState().selectAll();
    });
    expect(screen.getByText("2 éléments sélectionnés")).toBeInTheDocument();
    expect(screen.getByText("3 broches non connectées")).toBeInTheDocument();
  });

  it("opens and closes the shortcuts with the button, the ? key and Escape", async () => {
    const user = userEvent.setup();
    render(<StatusBar />);
    const toggle = screen.getByRole("button", { name: "Raccourcis (?)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(screen.getByRole("dialog", { name: "Raccourcis" })).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.keyboard("?");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not open the shortcuts while typing ? in a field", async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="champ" />
        <StatusBar />
      </>,
    );
    await user.type(screen.getByLabelText("champ"), "?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists the digit keys of every palette tool", () => {
    const tools = paletteLayout().flatMap((g) => g.entries).length;
    const digits = SHORTCUT_GROUPS.flatMap((g) => g.items).find((i) =>
      i.action.startsWith("Choisir l'outil de la palette"),
    );
    expect(digits?.keys).toBe(`1 à ${Math.min(tools, 9)}`);
  });
});
