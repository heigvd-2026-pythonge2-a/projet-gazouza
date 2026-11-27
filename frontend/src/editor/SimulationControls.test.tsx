import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SimulationResult } from "../api/client";
import { analysisSources, toAnalysis } from "../store";
import { fixtureDoc, fixtureResult } from "../store/testFixtures";
import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import netlist from "../../../shared/fixtures/divider_op/netlist.json";
import { SETTINGS_ROW_HEIGHT, SimulationControls, SimulationReport } from "./SimulationControls";
import { registerViewCommands } from "./viewCommands";

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

describe("SimulationReport (#253)", () => {
  it("shows on the schematic what an error points at when it is clicked", async () => {
    const user = userEvent.setup();
    const show = vi.fn();
    const unregister = registerViewCommands({
      zoomIn() {},
      zoomOut() {},
      fit() {},
      show,
      exportImage: async () => null,
    });
    editorState().openDocument(fixtureDoc("divider_op"));
    const result = {
      analysis: "op",
      traces: [],
      errors: [
        {
          code: "SINGULAR_MATRIX",
          message: "Le nœud « out » est flottant.",
          targets: [{ net: "out" }],
        },
        { code: "SIMULATION_FAILED", message: "ngspice a échoué." },
      ],
    } as SimulationResult;
    act(() => editorState().setSimulation(result, netlist.nets));
    render(<SimulationReport />);

    // An error that points at nothing is plain text.
    expect(screen.queryByRole("button", { name: "ngspice a échoué." })).toBeNull();
    expect(screen.getByText("ngspice a échoué.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /« out » est flottant/ }));
    expect(show).toHaveBeenCalledOnce();
    expect(editorState().selection).toEqual(["w2", "w6", "w8"]);
    unregister();
  });

  it("names the nodes after the schematic and highlights a hovered line (#292)", async () => {
    const user = userEvent.setup();
    editorState().openDocument(fixtureDoc("divider_op"));
    act(() => editorState().setSimulation(fixtureResult("divider_op"), netlist.nets));
    render(<SimulationReport />);

    expect(screen.queryByText(/n\d/)).toBeNull();
    expect(screen.getByRole("columnheader", { name: /Potentiels des nœuds/ })).toBeInTheDocument();
    const out = screen.getByRole("row", { name: "out 5 V" });
    await user.hover(out);
    expect(editorState().reportHighlight).toEqual({ wire: "w2" });
    await user.hover(screen.getByRole("row", { name: "V1 fournit 5 mA" }));
    expect(editorState().reportHighlight).toEqual({ component: "c1" });
    await user.unhover(screen.getByRole("row", { name: "V1 fournit 5 mA" }));
    expect(editorState().reportHighlight).toBeNull();
  });
});

describe("the line of the analysis settings (#339)", () => {
  it("holds the settings of every analysis, always as high and always last", async () => {
    const user = userEvent.setup();
    render(<SimulationControls />);
    const row = screen.getByRole("group", { name: "Réglages de l'analyse" });
    for (const [kind, field] of [
      ["op", null],
      ["tran", "Durée de la simulation (s)"],
      ["ac", "Fréquence de début (Hz)"],
      ["dc", "Valeur de début (V)"],
    ] as const) {
      await user.selectOptions(screen.getByLabelText("Analyse"), kind);
      expect(screen.getByRole("group", { name: "Réglages de l'analyse" })).toBe(row);
      expect(row).toHaveStyle({ height: `${SETTINGS_ROW_HEIGHT}px`, order: "1" });
      if (field) expect(row).toContainElement(screen.getByLabelText(field));
      else expect(row).toHaveTextContent("sans réglage");
    }
  });

  it("keeps the Simulate button next to the choice of the analysis, outside that line", () => {
    render(<SimulationControls />);
    const choice = screen.getByLabelText("Analyse");
    const simulate = screen.getByRole("button", { name: /Simuler/ });
    expect(choice.nextElementSibling).toBe(simulate);
    expect(screen.getByRole("group", { name: "Réglages de l'analyse" })).not.toContainElement(
      simulate,
    );
  });
});

describe("the number of points of a transient analysis (#334)", () => {
  it("is typed in the toolbar, with the step it gives next to it", async () => {
    const user = userEvent.setup();
    render(<SimulationControls />);
    await user.selectOptions(screen.getByLabelText("Analyse"), "tran");
    const row = screen.getByRole("group", { name: "Réglages de l'analyse" });
    // 10 ms and 1000 points by default.
    expect(row).toHaveTextContent("soit un pas de 10 µs");

    await user.type(screen.getByLabelText("Nombre de points"), "20000");
    expect(row).toHaveTextContent("soit un pas de 500 ns");
    expect(analysisOf()).toEqual({ analysis: { kind: "tran", stop_time: 0.01, points: 20000 } });

    // An invalid number hides the step: Simulate says what is wrong.
    await user.type(screen.getByLabelText("Nombre de points"), "x");
    expect(row).not.toHaveTextContent("soit un pas");
  });
});
