import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { analysisSources, toAnalysis } from "../store";
import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { SimulationControls } from "./SimulationControls";

beforeEach(resetEditorStore);

const analysisOf = () => toAnalysis(editorState().analysis, analysisSources(editorState().doc));

describe("SimulationControls (#222)", () => {
  it("sets an .ac analysis on the chosen input source", async () => {
    const user = userEvent.setup();
    const v1 = dropComponent("voltage_source");
    const v2 = dropComponent("voltage_source", { x: 6, y: 0 });
    render(<SimulationControls />);

    await user.selectOptions(screen.getByLabelText("Analyse"), "ac");
    const source = screen.getByLabelText("Source d'entrée");
    expect(source).toHaveValue(v1.id);
    await user.selectOptions(source, v2.id);
    const stop = screen.getByLabelText("Fréquence de fin (Hz)");
    await user.clear(stop);
    await user.type(stop, "1Meg");

    expect(analysisOf()).toEqual({
      analysis: {
        kind: "ac",
        input_source_id: v2.id,
        start_frequency: 10,
        stop_frequency: 1e6,
        points_per_decade: 20,
      },
    });
  });

  it("sweeps a current source in amperes", async () => {
    const user = userEvent.setup();
    dropComponent("current_source");
    render(<SimulationControls />);

    await user.selectOptions(screen.getByLabelText("Analyse"), "dc");
    expect(screen.getByLabelText("Pas du balayage (A)")).toHaveValue("100u");
    expect(analysisOf()).toMatchObject({
      analysis: { kind: "dc", start: 0, stop: 0.01, step: 1e-4 },
    });
  });

  it("gives the default range of its unit to another swept source, unless it was typed", async () => {
    const user = userEvent.setup();
    dropComponent("voltage_source");
    const i1 = dropComponent("current_source", { x: 6, y: 0 });
    render(<SimulationControls />);

    await user.selectOptions(screen.getByLabelText("Analyse"), "dc");
    const source = screen.getByLabelText("Source balayée");
    expect(screen.getByLabelText("Valeur de fin (V)")).toHaveValue("5");
    await user.selectOptions(source, i1.id);
    expect(screen.getByLabelText("Valeur de fin (A)")).toHaveValue("10m");

    const stop = screen.getByLabelText("Valeur de fin (A)");
    await user.clear(stop);
    await user.type(stop, "50m");
    await user.selectOptions(source, editorState().doc.components[0]!.id);
    expect(screen.getByLabelText("Valeur de fin (V)")).toHaveValue("50m");
  });

  it("offers no source to choose when the schematic has none", async () => {
    const user = userEvent.setup();
    render(<SimulationControls />);
    act(() => void dropComponent("resistor"));

    await user.selectOptions(screen.getByLabelText("Analyse"), "dc");
    expect(screen.getByLabelText("Source balayée")).toBeDisabled();
    expect(analysisOf()).toEqual({ error: expect.stringMatching(/source/) });
  });
});
