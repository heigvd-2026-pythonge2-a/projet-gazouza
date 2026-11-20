import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { Inspector } from "./Inspector";

beforeEach(resetEditorStore);

describe("Inspector", () => {
  it("explains what to do when nothing is selected", () => {
    render(<Inspector />);
    expect(screen.getByText(/Sélectionne un composant/)).toBeInTheDocument();
  });

  it("counts several selected items, and says a wire has no properties", () => {
    const a = dropComponent("resistor");
    const b = dropComponent("resistor", { x: 4, y: 0 });
    render(<Inspector />);
    act(() => editorState().select([a.id, b.id]));
    expect(screen.getByText("2 éléments sélectionnés.")).toBeInTheDocument();

    act(() => {
      editorState().startWiring();
      editorState().wireClick({ x: 10, y: 0 });
      editorState().wireClick({ x: 15, y: 0 });
      editorState().wireClick({ x: 15, y: 0 });
      editorState().setTool({ kind: "select" });
      editorState().select([editorState().doc.wires[0]!.id]);
    });
    expect(screen.getByText("Un fil n'a pas de propriétés.")).toBeInTheDocument();
  });

  it("shows the name and value of the selected component, with its unit", () => {
    dropComponent("resistor");
    render(<Inspector />);
    expect(screen.getByRole("heading")).toHaveTextContent("Résistance — R1");
    expect(screen.getByLabelText("Nom")).toHaveValue("R1");
    expect(screen.getByLabelText("Résistance")).toHaveValue("1k");
    expect(screen.getByText("Ω")).toBeInTheDocument();
    expect(screen.getByText(/« M » veut dire milli/)).toBeInTheDocument();
  });

  it("changes the document while typing, in a single undo step", async () => {
    const user = userEvent.setup();
    dropComponent("resistor");
    render(<Inspector />);
    const field = screen.getByLabelText("Résistance");

    await user.clear(field);
    await user.type(field, "4k7");
    expect(editorState().doc.components[0]!.params.resistance).toBe("4k7");

    act(() => editorState().undo());
    expect(editorState().doc.components[0]!.params.resistance).toBe("1k");
    expect(field).toHaveValue("1k");
  });

  it("Escape takes back what was typed, Enter keeps it; both leave the field", async () => {
    const user = userEvent.setup();
    dropComponent("resistor");
    render(<Inspector />);
    const field = screen.getByLabelText("Résistance");

    await user.type(field, "0");
    await user.keyboard("{Escape}");
    expect(field).toHaveValue("1k");
    expect(field).not.toHaveFocus();

    await user.type(field, "0");
    await user.keyboard("{Enter}");
    expect(field).toHaveValue("1k0");
    expect(field).not.toHaveFocus();
  });

  it("flags an invalid name", async () => {
    const user = userEvent.setup();
    dropComponent("resistor");
    render(<Inspector />);
    const name = screen.getByLabelText("Nom");

    await user.clear(name);
    await user.type(name, "C1");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Le nom doit commencer par « R ».")).toBeInTheDocument();

    await user.clear(name);
    await user.type(name, "R5");
    expect(name).not.toHaveAttribute("aria-invalid");
  });

  it("shows the parameters of the chosen waveform only", async () => {
    const user = userEvent.setup();
    dropComponent("voltage_source");
    render(<Inspector />);
    expect(screen.getByLabelText("Tension continue")).toBeInTheDocument();
    expect(screen.queryByLabelText("Période")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Forme d'onde"), "Impulsion");
    expect(editorState().doc.components[0]!.params.waveform).toBe("pulse");
    expect(screen.getByLabelText("Période")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tension continue")).not.toBeInTheDocument();
  });

  it("checks node names and has nothing to edit on a ground", async () => {
    const user = userEvent.setup();
    const label = dropComponent("label");
    render(<Inspector />);
    const net = screen.getByLabelText("Nom du nœud");
    await user.clear(net);
    await user.type(net, "n3");
    expect(screen.getByText(/réservé aux nœuds automatiques/)).toBeInTheDocument();

    act(() => {
      editorState().select([]);
      dropComponent("ground");
    });
    expect(screen.getByText("Ce composant n'a pas de paramètre.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nom")).not.toBeInTheDocument();
    expect(label.id).toBeTruthy();
  });
});
