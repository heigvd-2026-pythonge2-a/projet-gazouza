import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { ValuePopover } from "./ValuePopover";

beforeEach(resetEditorStore);

const viewport = { x: 0, y: 0, scale: 1 };

function open(type: string) {
  const c = dropComponent(type, { x: 10, y: 10 });
  const onClose = vi.fn();
  render(<ValuePopover componentId={c.id} viewport={viewport} onClose={onClose} />);
  return { c, onClose, field: screen.getByRole("textbox") as HTMLInputElement };
}

const param = (id: string, name: string) =>
  editorState().doc.components.find((c) => c.id === id)?.params[name];

describe("ValuePopover", () => {
  it("opens on the main value, its text selected", () => {
    const { field } = open("resistor");
    expect(screen.getByLabelText("Résistance — R1")).toBe(field);
    expect(field).toHaveFocus();
    expect(field.value).toBe("1k");
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(2);
  });

  it("changes the document while typing, and Enter keeps the value", async () => {
    const { c, onClose } = open("resistor");
    await userEvent.keyboard("4.7k");
    expect(param(c.id, "resistance")).toBe("4.7k");
    await userEvent.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalled();
    expect(param(c.id, "resistance")).toBe("4.7k");
  });

  it("takes the value back on Escape", async () => {
    const { c, onClose } = open("resistor");
    await userEvent.keyboard("22k");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    expect(param(c.id, "resistance")).toBe("1k");
  });

  it("says what is wrong with the value", async () => {
    const { field } = open("capacitor");
    await userEvent.keyboard("10l");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/Valeur non reconnue/)).toBeInTheDocument();
  });

  it("closes on a press elsewhere, keeping the value", async () => {
    const { c, onClose } = open("resistor");
    await userEvent.keyboard("2k");
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
    expect(param(c.id, "resistance")).toBe("2k");
  });

  it("links a source to its other parameters", () => {
    open("voltage_source");
    expect(screen.getByRole("button", { name: "Plus de paramètres…" })).toBeInTheDocument();
  });

  it("closes when the component goes away", () => {
    const { onClose } = open("resistor");
    act(() => editorState().deleteSelection());
    expect(onClose).toHaveBeenCalled();
  });
});
