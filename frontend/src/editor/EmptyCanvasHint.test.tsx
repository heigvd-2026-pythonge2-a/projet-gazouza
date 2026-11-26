import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { EmptyCanvasHint } from "./EmptyCanvasHint";

beforeEach(resetEditorStore);

const hint = () => screen.queryByRole("note", { name: "Premiers pas" });

describe("EmptyCanvasHint", () => {
  it("shows on an empty schematic, with the first palette key and the wire key", () => {
    render(<EmptyCanvasHint />);
    expect(hint()).toHaveTextContent("appuyez sur 1 pour choisir « Résistance »");
    expect(hint()).toHaveTextContent("touche W");
    expect(hint()).toHaveTextContent("? pour voir tous les raccourcis");
  });

  it("goes as soon as something is placed, and comes back when all is deleted", () => {
    render(<EmptyCanvasHint />);
    act(() => void dropComponent("resistor"));
    expect(hint()).not.toBeInTheDocument();
    act(() => {
      editorState().selectAll();
      editorState().deleteSelection();
    });
    expect(hint()).toBeInTheDocument();
  });

  it("lets the pointer through, except on its buttons", () => {
    render(<EmptyCanvasHint />);
    expect(hint()).toHaveStyle({ pointerEvents: "none" });
    expect(screen.getByRole("button", { name: "Ouvrir un exemple" })).toHaveStyle({
      pointerEvents: "auto",
    });
  });

  it("opens an example from its list", async () => {
    const user = userEvent.setup();
    render(<EmptyCanvasHint />);
    await user.click(screen.getByRole("button", { name: "Ouvrir un exemple" }));
    await user.click(screen.getByRole("button", { name: "Diviseur de tension (.op)" }));
    expect(editorState().doc.components.length).toBeGreaterThan(0);
    expect(hint()).not.toBeInTheDocument();
  });
});
