import { act, createEvent, fireEvent, render, screen } from "@testing-library/react";
import Konva from "konva";
import type { Node as KonvaNode } from "konva/lib/Node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SimulationResult } from "../api/client";
import netlist from "../../../shared/fixtures/divider_op/netlist.json";
import { diagnosticMarks } from "../store";
import { fixtureDoc, fixtureResult } from "../store/testFixtures";
import { installFakeCanvas } from "../test/canvas";
import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { SchematicCanvas } from "./Editor";
import { DRAG_TYPE } from "./Palette";
import { GRID } from "./theme";
import { exportImage, fitView, zoomIn, zoomOut } from "./viewCommands";

installFakeCanvas();

beforeEach(resetEditorStore);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Renders the canvas and returns its Konva stage. */
function renderCanvas() {
  const view = render(<SchematicCanvas />);
  const stage = Konva.stages.at(-1)!;
  return { ...view, stage };
}

/** Layer of the schematic (the second one: the first is the grid). */
const content = (stage: Konva.Stage) => stage.getLayers()[1]!;

/** Screen point (the stage is not moved nor zoomed at first) of a grid point. */
const at = (x: number, y: number) => ({ clientX: x * GRID, clientY: y * GRID });

/** A mouse event of the left button (or `button`) at a grid point. */
const mouse = (type: string, x: number, y: number, init: MouseEventInit = {}) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, ...at(x, y), ...init });

/** Fires a Konva event on `node` as if the pointer were at a grid point: it bubbles to the stage. */
function fire(node: KonvaNode, type: string, x = 0, y = 0, init: MouseEventInit = {}) {
  const evt = mouse(type, x, y, init);
  node.getStage()!.setPointersPositions(evt);
  act(() => {
    node.fire(type, { evt }, true);
  });
}

/** Mouse events on the window (the drags follow the mouse there). */
const windowMouse = (type: string, x: number, y: number, init: MouseEventInit = {}) =>
  act(() => {
    window.dispatchEvent(mouse(type, x, y, init));
  });

/** The drawn group of the component at this grid position. */
function componentNode(stage: Konva.Stage, position: { x: number; y: number }) {
  const node = content(stage)
    .find("Group")
    .find(
      (g) =>
        g.getParent() === content(stage) &&
        g.x() === position.x * GRID &&
        g.y() === position.y * GRID &&
        g.listening() &&
        // Its symbol is drawn in a group (turned and mirrored); the wires are lines.
        (g as Konva.Group).getChildren()[0]?.getClassName() === "Group",
    );
  if (!node) throw new Error(`no component at ${position.x},${position.y}`);
  return node as Konva.Group;
}

/** The clickable lines of the wires, in the order of the document. */
const wireLines = (stage: Konva.Stage) =>
  content(stage)
    .find("Line")
    .filter((l) => typeof l.getAttr("hitStrokeWidth") === "number");

const texts = (stage: Konva.Stage) => stage.find("Text").map((t) => (t as Konva.Text).text());

describe("SchematicCanvas drawing", () => {
  it("draws the components with their names and values", () => {
    editorState().openDocument(fixtureDoc("rc_tran"));
    const { stage } = renderCanvas();
    expect(texts(stage)).toEqual(expect.arrayContaining(["V1", "R1", "1kΩ", "C1", "1uF"]));
    expect(wireLines(stage)).toHaveLength(editorState().doc.wires.length);
  });

  it("writes the values of an operating point, and hides them on demand", () => {
    editorState().openDocument(fixtureDoc("divider_op"));
    act(() => editorState().setSimulation(fixtureResult("divider_op"), netlist.nets));
    const { stage } = renderCanvas();
    const shown = texts(stage);
    expect(shown.some((t) => /\d\s?V$/.test(t))).toBe(true);
    expect(shown.some((t) => /A$/.test(t))).toBe(true);
    expect(stage.find("Arrow").length).toBeGreaterThan(0);
    act(() => editorState().setShowValues(false));
    expect(stage.find("Arrow")).toHaveLength(0);
  });

  it("shows the voltage across a hovered component", () => {
    editorState().openDocument(fixtureDoc("divider_op"));
    act(() => editorState().setSimulation(fixtureResult("divider_op"), netlist.nets));
    const { stage } = renderCanvas();
    const before = stage.find("Arrow").length;
    fire(componentNode(stage, { x: 4, y: -2 }), "mouseenter");
    expect(stage.find("Arrow").length).toBeGreaterThan(before);
    fire(componentNode(stage, { x: 4, y: -2 }), "mouseleave");
    expect(stage.find("Arrow")).toHaveLength(before);
  });

  it("marks what the errors of a simulation point at", () => {
    editorState().openDocument(fixtureDoc("shorted_resistor_op"));
    act(() => editorState().setSimulation(fixtureResult("shorted_resistor_op")));
    const { stage } = renderCanvas();
    const marks = diagnosticMarks(editorState().doc, fixtureResult("shorted_resistor_op"), {});
    const marked = marks.flatMap((m) => m.components);
    expect(marked.length).toBeGreaterThan(0);
    // A rounded frame of the colour of the error under each component pointed at.
    const halos = content(stage)
      .find("Rect")
      .filter((r) => (r as Konva.Rect).cornerRadius() === 4);
    expect(halos).toHaveLength(marked.length);
  });

  it("highlights the node of a hovered wire and the component of a hovered result", () => {
    editorState().openDocument(fixtureDoc("divider_op"));
    const { stage } = renderCanvas();
    const lines = () => content(stage).find("Line").length;
    const before = lines();
    fire(wireLines(stage)[0]!, "mouseenter");
    expect(lines()).toBeGreaterThan(before);
    fire(wireLines(stage)[0]!, "mouseleave");
    expect(lines()).toBe(before);
    act(() => editorState().setReportHighlight({ component: "c2" }));
    expect(content(stage).find("Rect").length).toBeGreaterThan(0);
  });

  it("animates the current of a transient analysis", () => {
    editorState().openDocument(fixtureDoc("rc_tran"));
    act(() => editorState().setSimulation(fixtureResult("rc_tran")));
    const { stage } = renderCanvas();
    const layers = stage.getLayers().length;
    act(() => editorState().setAnimation({ on: true }));
    expect(stage.getLayers().length).toBe(layers + 1);
  });

  it("lights an LED as bright as its current", () => {
    const led = dropComponent("led", { x: 2, y: 2 });
    const result = {
      analysis: "op",
      traces: [
        { name: "i(D1)", kind: "current", unit: "A", component_id: led.id, values: [20e-3] },
      ],
    } as SimulationResult;
    act(() => editorState().setSimulation(result));
    const { stage } = renderCanvas();
    const glow = content(stage)
      .find("Group")
      .filter((g) => !g.listening() && g.x() === 2 * GRID && g.y() === 2 * GRID);
    expect(glow.map((g) => g.opacity())).toContain(1);
  });
});

describe("SchematicCanvas tools", () => {
  it("places a component with the place tool, and shows it under the pointer first", () => {
    const { stage } = renderCanvas();
    act(() => editorState().startPlacing("resistor"));
    fire(stage, "mousemove", 3, 4);
    expect(
      content(stage)
        .find("Group")
        .some((g) => g.opacity() === 0.5),
    ).toBe(true);
    fire(stage, "mousedown", 3, 4);
    expect(editorState().doc.components).toEqual([
      expect.objectContaining({ type: "resistor", position: { x: 3, y: 4 } }),
    ]);
    fire(stage, "mouseleave");
  });

  it("draws a wire with the wire tool", () => {
    const { stage } = renderCanvas();
    act(() => editorState().startWiring());
    fire(stage, "mousedown", 0, 0);
    fire(stage, "mousemove", 4, 0);
    expect(editorState().draft).not.toBeNull();
  });

  it("writes a text with the text tool", () => {
    const { stage } = renderCanvas();
    act(() => editorState().startText());
    fire(stage, "mousemove", 2, 2);
    expect(texts(stage)).toContain("Texte");
    fire(stage, "mousedown", 2, 2);
    expect(editorState().doc.texts).toEqual([
      expect.objectContaining({ position: { x: 2, y: 2 } }),
    ]);
  });

  it("pastes a copy where the pointer is", () => {
    dropComponent("resistor", { x: 0, y: 0 });
    const { stage } = renderCanvas();
    act(() => {
      editorState().copy();
      editorState().paste();
    });
    fire(stage, "mousemove", 10, 10);
    fire(stage, "mousedown", 10, 10);
    expect(editorState().doc.components).toHaveLength(2);
    expect(editorState().tool.kind).toBe("select");
  });

  it("starts a wire from a pin", () => {
    dropComponent("resistor", { x: 0, y: 0 });
    act(() => editorState().select([]));
    const { stage } = renderCanvas();
    // The clickable squares of the pins, after the hit area of the whole symbol.
    const pin = () =>
      componentNode(stage, { x: 0, y: 0 })
        .find("Rect")
        .filter((r) => r.getAttr("fill") === "rgba(0,0,0,0)")
        .at(-1)!;
    fire(pin(), "mouseenter");
    fire(pin(), "mouseleave");
    fire(pin(), "mousedown", 0, 2);
    expect(editorState().tool.kind).toBe("wire");
    expect(editorState().draft).not.toBeNull();
  });

  it("probes a wire and a component with the probe tool", () => {
    editorState().openDocument(fixtureDoc("divider_op"));
    act(() => {
      editorState().setSimulation(fixtureResult("divider_op"), netlist.nets);
      editorState().startProbe();
    });
    const { stage, container } = renderCanvas();
    expect((container.firstElementChild as HTMLElement).style.cursor).toMatch(/url/);
    fire(stage, "mousedown", 20, 20);
    expect(editorState().probes).toEqual([]);
    fire(componentNode(stage, { x: 4, y: -2 }), "mousedown", 4, -2);
    expect(editorState().probes.map((p) => p.trace)).toEqual(["i(R1)"]);
    fire(wireLines(stage)[0]!, "mousedown");
    expect(editorState().probes).toHaveLength(2);
    expect(editorState().probes[1]!.trace).toMatch(/^v\(/);
  });

  it("drops a component dragged from the palette", () => {
    const { container } = renderCanvas();
    const area = container.firstElementChild as HTMLElement;
    const dataTransfer = {
      types: [DRAG_TYPE],
      getData: (type: string) => (type === DRAG_TYPE ? "capacitor" : ""),
      dropEffect: "none",
    };
    fireEvent.dragOver(area, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("copy");
    // jsdom gives no position to a drag event: set it by hand.
    const drop = createEvent.drop(area, { dataTransfer });
    Object.defineProperties(drop, { clientX: { value: 5 * GRID }, clientY: { value: GRID } });
    fireEvent(area, drop);
    expect(editorState().doc.components).toEqual([
      expect.objectContaining({ type: "capacitor", position: { x: 5, y: 1 } }),
    ]);
    // Another drag (a file, a text) is not a component.
    fireEvent.drop(area, { dataTransfer: { types: [], getData: () => "" } });
    expect(editorState().doc.components).toHaveLength(1);
  });
});

describe("SchematicCanvas selection", () => {
  it("selects a component on press, and Shift toggles it", () => {
    const a = dropComponent("resistor", { x: 0, y: 0 });
    const b = dropComponent("resistor", { x: 6, y: 0 });
    const { stage } = renderCanvas();
    fire(componentNode(stage, a.position), "mousedown");
    expect(editorState().selection).toEqual([a.id]);
    fire(componentNode(stage, b.position), "mousedown", 0, 0, { shiftKey: true });
    expect(editorState().selection).toEqual([a.id, b.id]);
    fire(componentNode(stage, b.position), "mousedown", 0, 0, { shiftKey: true });
    expect(editorState().selection).toEqual([a.id]);
  });

  it("clears the selection on a click in the void", () => {
    dropComponent("resistor", { x: 0, y: 0 });
    const { stage } = renderCanvas();
    fire(stage, "mousedown", 20, 20);
    windowMouse("mouseup", 20, 20);
    expect(editorState().selection).toEqual([]);
  });

  it("selects what a rectangle drawn in the void holds", () => {
    const a = dropComponent("resistor", { x: 0, y: 0 });
    dropComponent("resistor", { x: 20, y: 0 });
    act(() => editorState().select([]));
    const { stage } = renderCanvas();
    fire(stage, "mousedown", -3, -4);
    windowMouse("mousemove", 3, 4);
    expect(
      content(stage)
        .find("Rect")
        .some((r) => r.width() === 6 * GRID),
    ).toBe(true);
    windowMouse("mouseup", 3, 4);
    expect(editorState().selection).toEqual([a.id]);
  });

  it("drops the rectangle on Escape", () => {
    const a = dropComponent("resistor", { x: 0, y: 0 });
    const { stage } = renderCanvas();
    fire(stage, "mousedown", -3, -4, { shiftKey: true });
    windowMouse("mousemove", 3, 4);
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    windowMouse("mouseup", 3, 4);
    expect(editorState().selection).toEqual([a.id]);
  });

  it("selects a part of a wire on press, the whole wire on double-click", () => {
    editorState().openDocument(fixtureDoc("divider_op"));
    const { stage } = renderCanvas();
    const wire = editorState().doc.wires[2]!;
    const line = wireLines(stage)[2]!;
    // Wire w3 goes from V1 (pin -) down to the ground below.
    fire(line, "mousedown", 0, 5);
    windowMouse("mouseup", 0, 5);
    expect(editorState().wirePart?.wire).toBe(wire.id);
    fire(line, "dblclick", 0, 5);
    expect(editorState().selection).toEqual([wire.id]);
    fire(line, "mousedown", 0, 5, { shiftKey: true });
    expect(editorState().selection).toEqual([]);
  });

  it("moves a dragged component with the selection", () => {
    const a = dropComponent("resistor", { x: 0, y: 0 });
    const { stage } = renderCanvas();
    const node = componentNode(stage, a.position);
    node.position({ x: 2 * GRID + 3, y: 4 * GRID });
    fire(node, "dragmove");
    expect(node.x()).toBe(2 * GRID);
    node.position({ x: 2 * GRID, y: 4 * GRID });
    fire(node, "dragend");
    expect(editorState().doc.components[0]!.position).toEqual({ x: 2, y: 4 });
  });

  it("toggles a switch on click, and not after a drag", () => {
    const sw = dropComponent("switch", { x: 0, y: 0 });
    act(() => editorState().select([]));
    const state = () => editorState().doc.components[0]!.params.state;
    const before = state();
    const { stage } = renderCanvas();
    fire(componentNode(stage, sw.position), "mousedown");
    windowMouse("mouseup", 0, 0);
    expect(state()).not.toBe(before);
    expect(editorState().selection).toEqual([]);
    // Dragged: it is moved, not worked.
    const node = componentNode(stage, sw.position);
    fire(node, "mousedown");
    node.position({ x: 4 * GRID, y: 0 });
    fire(node, "dragmove");
    windowMouse("mouseup", 4, 0);
    expect(state()).not.toBe(before);
  });

  it("closes a push button while it is held", () => {
    const button = dropComponent("push_button", { x: 0, y: 0 });
    const { stage } = renderCanvas();
    fire(componentNode(stage, button.position), "mousedown");
    expect(editorState().pressedButton).toBe(button.id);
    windowMouse("mouseup", 0, 0);
    expect(editorState().pressedButton).toBeNull();
  });
});

describe("SchematicCanvas menus and dialogs", () => {
  it("opens the menu of a component on a right click", () => {
    const a = dropComponent("resistor", { x: 0, y: 0 });
    act(() => editorState().select([]));
    const { stage } = renderCanvas();
    fire(componentNode(stage, a.position), "mousedown", 0, 0, { button: 2 });
    windowMouse("mouseup", 0, 0, { button: 2 });
    expect(editorState().selection).toEqual([a.id]);
    expect(screen.getByRole("menuitem", { name: /^Tourner R$/ })).toBeInTheDocument();
  });

  it("leaves the current tool on a right click", () => {
    const { stage } = renderCanvas();
    act(() => editorState().startPlacing("resistor"));
    fire(stage, "mousedown", 0, 0, { button: 2 });
    windowMouse("mouseup", 0, 0, { button: 2 });
    expect(editorState().tool.kind).toBe("select");
  });

  it("moves the view while the right or middle button is held", () => {
    const { stage } = renderCanvas();
    fire(stage, "mousedown", 0, 0, { button: 2 });
    windowMouse("mousemove", 3, 2, { button: 2 });
    expect(stage.x()).toBe(3 * GRID);
    expect(stage.y()).toBe(2 * GRID);
    windowMouse("mouseup", 3, 2, { button: 2 });
    fire(stage, "mousedown", 0, 0, { button: 1 });
    windowMouse("mousemove", -1, 0, { button: 1 });
    windowMouse("mouseup", -1, 0, { button: 1 });
    expect(stage.x()).toBe(2 * GRID);
  });

  it("edits the value of a component on double-click", () => {
    const a = dropComponent("resistor", { x: 0, y: 0 });
    const { stage } = renderCanvas();
    fire(componentNode(stage, a.position), "dblclick");
    expect(screen.getByRole("dialog", { name: "Valeur de R1" })).toBeInTheDocument();
  });
});

describe("SchematicCanvas view", () => {
  it("zooms with the wheel around the pointer", () => {
    const { stage } = renderCanvas();
    const evt = new WheelEvent("wheel", { deltaY: -100, cancelable: true, ...at(2, 2) });
    stage.setPointersPositions(evt);
    act(() => {
      stage.fire("wheel", { evt }, true);
    });
    expect(stage.scaleX()).toBeGreaterThan(1);
    expect(evt.defaultPrevented).toBe(true);
  });

  it("zooms and fits with the view commands and the F key", () => {
    dropComponent("resistor", { x: 0, y: 0 });
    const { stage } = renderCanvas();
    act(() => zoomIn());
    expect(stage.scaleX()).toBeGreaterThan(1);
    act(() => zoomOut());
    expect(stage.scaleX()).toBeCloseTo(1);
    act(() => fitView());
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    });
    expect(Number.isFinite(stage.scaleX())).toBe(true);
  });

  /** Runs the image export, the next frame being drawn at once. */
  async function exported(options: Parameters<typeof exportImage>[0]) {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    let image: Blob | null | undefined;
    act(() => {
      void exportImage(options).then((b) => (image = b));
    });
    await vi.waitFor(() => expect(image).not.toBeUndefined());
    return image;
  }

  it("exports the circuit as an SVG or a PNG image", async () => {
    dropComponent("resistor", { x: 0, y: 0 });
    renderCanvas();
    const svg = await exported({ transparent: false, format: "svg" });
    expect(svg?.type).toBe("image/svg+xml");
    expect(await svg?.text()).toMatch(/<svg[^>]*>.*R1/s);
    const png = await exported({ transparent: true, format: "png" });
    expect(png?.type).toBe("image/png");
  });

  it("exports nothing for an empty schematic", async () => {
    renderCanvas();
    expect(await exported({ transparent: false })).toBeNull();
  });
});
