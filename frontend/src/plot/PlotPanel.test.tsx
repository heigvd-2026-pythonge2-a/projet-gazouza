import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dividerOpResult from "../../../shared/fixtures/divider_op/result.json";
import rcTranResult from "../../../shared/fixtures/rc_tran/result.json";
import type { SimulationResult } from "../api/client";
import { editorState, resetEditorStore } from "../test/editorStore";
import { PlotPanel } from "./PlotPanel";

const mockInstances: Array<{
  opts: unknown;
  data: unknown;
  over: HTMLDivElement;
  scales: Record<string, { min: number; max: number }>;
  setScale: ReturnType<typeof vi.fn>;
  setSeries: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  redraw: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("uplot", () => {
  class MockUPlot {
    opts: unknown;
    data: number[][];
    over: HTMLDivElement;
    scales: Record<string, { min: number; max: number }>;
    setScale = vi.fn((key: string, limits: { min: number; max: number }) => {
      this.scales[key] = limits;
    });
    setSeries = vi.fn();
    setSize = vi.fn();
    redraw = vi.fn();
    destroy = vi.fn();

    constructor(opts: unknown, data: number[][], host: HTMLElement) {
      this.opts = opts;
      this.data = data;
      const xVals = data[0] ?? [0, 1];
      this.scales = {
        x: { min: xVals[0] ?? 0, max: xVals[xVals.length - 1] ?? 1 },
      };
      this.over = document.createElement("div");
      this.over.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 400, height: 240, right: 400, bottom: 240 }) as DOMRect;
      host.appendChild(this.over);
      mockInstances.push(this);
    }

    posToVal(leftCss: number) {
      const { min, max } = this.scales.x ?? { min: 0, max: 1 };
      return min + (leftCss / 400) * (max - min);
    }

    valToPos(val: number) {
      const { min, max } = this.scales.x ?? { min: 0, max: 1 };
      return max === min ? 0 : ((val - min) / (max - min)) * 400;
    }

    static Axis = { Side: { Top: 0, Right: 1, Bottom: 2, Left: 3 } };
    static pxRatio = 1;
  }
  return { default: MockUPlot };
});

const rcResult = rcTranResult as SimulationResult;
const opResult = dividerOpResult as SimulationResult;

beforeEach(() => {
  mockInstances.length = 0;
  resetEditorStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PlotPanel", () => {
  it("shows the placeholder message before any simulation", () => {
    render(<PlotPanel />);
    expect(
      screen.getByText("Les courbes s'afficheront ici après une simulation."),
    ).toBeInTheDocument();
  });

  it("renders rc_tran traces, legend checkboxes, zoom controls, and cursor table", async () => {
    const user = userEvent.setup();
    act(() => editorState().setSimulation(rcResult));
    render(<PlotPanel />);

    // All 5 traces from rc_tran appear in the interactive legend.
    const legend = screen.getByRole("group", { name: "Traces affichées" });
    for (const name of ["v(in)", "v(out)", "i(V1)", "i(R1)", "i(C1)"]) {
      expect(within(legend).getByLabelText(name)).toBeChecked();
    }

    // uPlot was initialized with non-Unix time scale and all 5 series.
    await waitFor(() => expect(mockInstances).toHaveLength(1));
    const chart = mockInstances[0]!;
    const opts = chart.opts as { scales: { x: { time: boolean } }; series: unknown[] };
    expect(opts.scales.x.time).toBe(false);
    expect(opts.series).toHaveLength(6);

    // Cursor table shows time and trace rows.
    const table = screen.getByRole("table", { name: "Mesures des curseurs" });
    expect(within(table).getByText("Temps (s)")).toBeInTheDocument();
    expect(within(table).getByText("v(out)")).toBeInTheDocument();

    // Unchecking a trace removes it from the cursor table and hides it on uPlot.
    await user.click(within(legend).getByLabelText("i(R1)"));
    expect(within(table).queryByText("i(R1)")).not.toBeInTheDocument();
    expect(chart.setSeries).toHaveBeenCalled();

    // Mouse wheel zooms X scale, and reset zoom restores full range.
    fireEvent.wheel(chart.over, { deltaY: -100, clientX: 200 });
    expect(chart.setScale).toHaveBeenCalledWith(
      "x",
      expect.objectContaining({
        min: expect.any(Number),
        max: expect.any(Number),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Réinitialiser le zoom" }));
    expect(chart.setScale).toHaveBeenLastCalledWith("x", {
      min: 0,
      max: expect.closeTo(0.005, 6),
    });

    // Cursor placement mode updates cursor 1 position via mouse click.
    await user.click(screen.getByRole("button", { name: "Placer C1" }));
    fireEvent.mouseDown(chart.over, { button: 0, clientX: 80 });
    fireEvent.mouseUp(window);
    expect(within(table).getByText(/997[.,]617 µs/)).toBeInTheDocument();

    // Hiding cursors removes the readout table.
    await user.click(screen.getByRole("button", { name: "Masquer les curseurs" }));
    expect(screen.queryByRole("table", { name: "Mesures des curseurs" })).not.toBeInTheDocument();
  });

  it("renders operating point results as a table", () => {
    act(() => editorState().setSimulation(opResult));
    render(<PlotPanel />);
    const table = screen.getByRole("table", { name: "Point de fonctionnement" });
    expect(within(table).getByText("v(in)")).toBeInTheDocument();
    expect(within(table).getByText("10 V")).toBeInTheDocument();
    expect(within(table).getByText("5 V")).toBeInTheDocument();
  });

  it("warns when the schematic changed after simulation and shows errors", () => {
    act(() => {
      editorState().setSimulation({
        ...rcResult,
        errors: [{ code: "SIMULATION_FAILED", message: "Convergence impossible" }],
      });
      editorState().dropComponent("resistor", { x: 0, y: 0 });
    });
    render(<PlotPanel />);
    expect(
      screen.getByText("Le schéma a été modifié depuis cette simulation."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Convergence impossible");
  });
});
