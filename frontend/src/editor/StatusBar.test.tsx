import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { shortcutKey } from "./paletteLayout";
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

  it("says why a wire was not added, until the next change (#257)", () => {
    render(<StatusBar />);
    act(() => {
      dropComponent("resistor", { x: 0, y: 0 });
      dropComponent("resistor", { x: 4, y: 0 });
      editorState().startWiring();
      for (const [x, y] of [
        [0, 2],
        [4, 2],
        [1, 2],
        [1, 4],
        [3, 4],
        [3, 2],
      ] as const) {
        editorState().wireClick({ x, y });
      }
    });
    expect(screen.getByRole("status")).toHaveTextContent(/déjà reliés par des fils/);
    act(() => editorState().setTool({ kind: "select" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/Clic : sélectionner/)).toBeInTheDocument();
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

  it("lists the digit keys of the palette tools", () => {
    const digits = SHORTCUT_GROUPS.flatMap((g) => g.items).find((i) =>
      i.action.includes("outils de la palette"),
    );
    // The help names the whole key range: the palette has more tools than keys once the
    // semiconductors are loaded, and fewer with the basic library.
    expect(digits?.keys).toBe(`${shortcutKey(0)} à ${shortcutKey(8)}`);
    expect(shortcutKey(9)).toBeUndefined();
  });
});
