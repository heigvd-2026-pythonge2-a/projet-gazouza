import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dividerOpResult from "../../../shared/fixtures/divider_op/result.json";
import dcResultJson from "../../../shared/fixtures/loaded_divider_dc/result.json";
import acResultJson from "../../../shared/fixtures/lowpass_ac/result.json";
import rcTranResult from "../../../shared/fixtures/rc_tran/result.json";
import type { SimulationResult } from "../api/client";
import { editorState, resetEditorStore } from "../test/editorStore";
import { PlotPanel } from "./PlotPanel";

interface MockOpts {
  scales?: { x?: { time?: boolean; distr?: number; log?: number } };
  series?: unknown[];
  hooks?: { setScale?: Array<(u: unknown, key: string) => void> };
}

const mockInstances: Array<{
  opts: MockOpts;
  data: unknown;
  over: HTMLDivElement;
  axes: Array<{ show?: boolean }>;
  scales: Record<string, { min: number; max: number }>;
  setScale: ReturnType<typeof vi.fn>;
  setSeries: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  redraw: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("uplot", () => {
  class MockUPlot {
    opts: MockOpts;
    data: number[][];
    over: HTMLDivElement;
    axes: Array<{ show?: boolean }>;
    scales: Record<string, { min: number; max: number }>;
    setScale = vi.fn((key: string, limits: { min: number; max: number }) => {
      this.scales[key] = limits;
      for (const hook of this.opts.hooks?.setScale ?? []) {
        hook(this, key);
      }
    });
    setSeries = vi.fn();
    setSize = vi.fn();
    redraw = vi.fn();
    destroy = vi.fn();

    constructor(opts: MockOpts, data: number[][], host: HTMLElement) {
      this.opts = opts;
      this.data = data;
      const xVals = data[0] ?? [0, 1];
      this.axes = [{ show: true }, { show: true }, { show: true }];
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
      const isLog = this.opts.scales?.x?.distr === 3;
      if (isLog && min > 0 && max > 0) {
        const lMin = Math.log10(min);
        const lMax = Math.log10(max);
        return 10 ** (lMin + (leftCss / 400) * (lMax - lMin));
      }
      return min + (leftCss / 400) * (max - min);
    }

    valToPos(val: number) {
      const { min, max } = this.scales.x ?? { min: 0, max: 1 };
      const isLog = this.opts.scales?.x?.distr === 3;
      if (isLog && min > 0 && max > 0 && val > 0) {
        const lMin = Math.log10(min);
        const lMax = Math.log10(max);
        return lMax === lMin ? 0 : ((Math.log10(val) - lMin) / (lMax - lMin)) * 400;
      }
      return max === min ? 0 : ((val - min) / (max - min)) * 400;
    }

    static Axis = { Side: { Top: 0, Right: 1, Bottom: 2, Left: 3 } };
    static pxRatio = 1;
  }
  return { default: MockUPlot };
});

const rcResult = rcTranResult as SimulationResult;
const opResult = dividerOpResult as SimulationResult;
const acResult = acResultJson as SimulationResult;
const dcResult = dcResultJson as SimulationResult;

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

    const legend = screen.getByRole("group", { name: "Traces affichées" });
    for (const name of ["v(in)", "v(out)", "i(V1)", "i(R1)", "i(C1)"]) {
      expect(within(legend).getByLabelText(name)).toBeChecked();
    }

    await waitFor(() => expect(mockInstances).toHaveLength(1));
    const chart = mockInstances[0]!;
    expect(chart.opts.scales?.x?.time).toBe(false);
    expect(chart.opts.series).toHaveLength(6);

    const table = screen.getByRole("table", { name: "Mesures des curseurs" });
    expect(within(table).getByText("Temps (s)")).toBeInTheDocument();
    expect(within(table).getByText("v(out)")).toBeInTheDocument();

    await user.click(within(legend).getByLabelText("i(R1)"));
    expect(within(table).queryByText("i(R1)")).not.toBeInTheDocument();
    expect(chart.setSeries).toHaveBeenCalled();

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

    await user.click(screen.getByRole("button", { name: "Placer C1" }));
    fireEvent.mouseDown(chart.over, { button: 0, clientX: 80 });
    fireEvent.mouseUp(window);
    expect(within(table).getByText(/997[.,]617 µs/)).toBeInTheDocument();

    await user.click(within(legend).getByLabelText("v(in)"));
    await user.click(within(legend).getByLabelText("v(out)"));
    expect(mockInstances).toHaveLength(1);
    expect(chart.axes[1]?.show).toBe(false);

    await user.click(screen.getByRole("button", { name: "Masquer les curseurs" }));
    expect(screen.queryByRole("table", { name: "Mesures des curseurs" })).not.toBeInTheDocument();
  });

  it("dragging C1 directly on its line does not trigger uPlot drag-zoom", async () => {
    const user = userEvent.setup();
    act(() => editorState().setSimulation(rcResult));
    render(<PlotPanel />);

    await waitFor(() => expect(mockInstances).toHaveLength(1));
    const chart = mockInstances[0]!;
    const uplotOwnListener = vi.fn();
    chart.over.addEventListener("mousedown", uplotOwnListener);

    await user.click(screen.getByRole("button", { name: "Placer C1" }));
    fireEvent.mouseDown(chart.over, { button: 0, clientX: 80 });
    fireEvent.mouseUp(window);

    await user.click(screen.getByRole("button", { name: "Zoom (glisser)" }));
    uplotOwnListener.mockClear();
    chart.setScale.mockClear();

    fireEvent.mouseDown(chart.over, { button: 0, clientX: 80 });
    fireEvent.mouseMove(window, { clientX: 200 });
    fireEvent.mouseUp(window);

    expect(uplotOwnListener).not.toHaveBeenCalled();
    expect(chart.setScale).not.toHaveBeenCalled();
    const table = screen.getByRole("table", { name: "Mesures des curseurs" });
    expect(within(table).getByText(/2[.,]498 ms|2[.,]5 ms/)).toBeInTheDocument();
  });

  it("renders Bode Gain and Phase charts for .ac with linked zoom and -3 dB at 1 kHz", async () => {
    const user = userEvent.setup();
    act(() => editorState().setSimulation(acResult));
    render(<PlotPanel />);

    await waitFor(() => expect(mockInstances).toHaveLength(2));
    const [gainChart, phaseChart] = mockInstances;
    expect(gainChart!.opts.scales?.x?.distr).toBe(3);
    expect(gainChart!.opts.scales?.x?.log).toBe(10);
    expect(phaseChart!.opts.scales?.x?.distr).toBe(3);

    // 10 Hz .. 100 kHz -> 1 kHz is at the exact visual midpoint (200 px of 400 px).
    await user.click(screen.getByRole("button", { name: "Placer C1" }));
    fireEvent.mouseDown(gainChart!.over, { button: 0, clientX: 200 });
    fireEvent.mouseUp(window);

    const table = screen.getByRole("table", { name: "Mesures des curseurs" });
    expect(within(table).getByText("1 kHz")).toBeInTheDocument();
    expect(within(table).getByText(/-3[.,]01 dB/)).toBeInTheDocument();
    expect(within(table).getByText(/-44[.,]999°|-45°/)).toBeInTheDocument();

    // Zooming on the Gain chart synchronizes X scale to the Phase chart.
    phaseChart!.setScale.mockClear();
    fireEvent.wheel(gainChart!.over, { deltaY: -100, clientX: 200 });
    expect(phaseChart!.setScale).toHaveBeenCalledWith(
      "x",
      expect.objectContaining({
        min: expect.any(Number),
        max: expect.any(Number),
      }),
    );
  });

  it("renders DC sweep curves with the swept source on the X axis", async () => {
    act(() => editorState().setSimulation(dcResult));
    render(<PlotPanel />);

    await waitFor(() => expect(mockInstances).toHaveLength(1));
    const chart = mockInstances[0]!;
    expect(chart.opts.scales?.x?.distr).toBeUndefined();

    const table = screen.getByRole("table", { name: "Mesures des curseurs" });
    expect(within(table).getByText("V1 (V)")).toBeInTheDocument();
    expect(within(table).getByText("v(n2)")).toBeInTheDocument();
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
