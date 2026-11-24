import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import App from "./App";
import { SHOW_INSPECTOR_EVENT } from "./editor";
import { LAYOUT_STORAGE_KEY } from "./layout/storage";
import { fixtureDoc, fixtureResult } from "./store/testFixtures";
import { editorState, resetEditorStore } from "./test/editorStore";

// The schematic is drawn by Konva on a <canvas>, which jsdom does not have: a placeholder takes
// its place. Everything around it (toolbar, panels, layout) is the real thing.
vi.mock("./editor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./editor")>()),
  SchematicCanvas: () => <div data-testid="schematic" />,
}));

beforeEach(() => {
  resetEditorStore();
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ status: "ok" })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const button = (name: string | RegExp) => screen.getByRole("button", { name });

describe("App", () => {
  it("shows the backend state", async () => {
    render(<App />);
    expect(await screen.findByText("Backend : ok")).toBeInTheDocument();
  });

  it("says when the backend cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<App />);
    expect(await screen.findByText("Backend : injoignable")).toBeInTheDocument();
  });

  it("shows the schematic or the results in full screen, and Escape comes back", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(button("Résultats"));
    const results = screen.getByRole("region", { name: "Résultats" });
    const properties = screen.getByRole("region", { name: "Propriétés" });

    await user.click(button("Afficher le schéma en plein écran"));
    expect(screen.getByTestId("schematic")).toBeVisible();
    expect(results).not.toBeVisible();
    expect(properties).not.toBeVisible();

    await user.keyboard("{Escape}");
    expect(results).toBeVisible();
    expect(properties).toBeVisible();

    await user.click(within(results).getByRole("button", { name: /plein écran/ }));
    expect(screen.getByTestId("schematic")).not.toBeVisible();
    expect(screen.getByRole("region", { name: "Résultats" })).toBeVisible();
  });

  it("keeps Escape for the editor while a tool is active", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(button("Afficher le schéma en plein écran"));
    act(() => editorState().startWiring());
    await user.keyboard("{Escape}");
    // Still in full screen: the properties stay hidden.
    expect(screen.getByRole("region", { name: "Propriétés", hidden: true })).not.toBeVisible();
  });

  it("starts without the results, even if they were shown when the app was closed (#96)", () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ resultsVisible: true }));
    render(<App />);
    expect(document.querySelector('section[aria-label="Résultats"]')).not.toBeVisible();
  });

  it("shows the results only after a simulation, or on demand (#96)", async () => {
    const user = userEvent.setup();
    render(<App />);
    // Hidden itself (display: none), it has no accessible name: found by its label instead.
    const results = document.querySelector('section[aria-label="Résultats"]')!;
    expect(results).not.toBeVisible();

    act(() => {
      editorState().openDocument(fixtureDoc("divider_op"));
      editorState().setSimulation(fixtureResult("divider_op"));
    });
    expect(results).toBeVisible();

    await user.click(button("Masquer les résultats"));
    expect(results).not.toBeVisible();
    expect(JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "{}").resultsVisible).toBe(
      false,
    );
    // Every simulation shows them again.
    act(() => editorState().setSimulation(fixtureResult("divider_op")));
    expect(results).toBeVisible();

    // A new schematic starts without them.
    act(() => editorState().newDocument());
    expect(results).not.toBeVisible();
    await user.click(button("Résultats"));
    expect(results).toBeVisible();
  });

  it("closes the properties and shows them again (#164)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const properties = screen.getByRole("region", { name: "Propriétés" });
    await user.click(button("Masquer les propriétés"));
    expect(properties).not.toBeVisible();
    await user.click(button("Propriétés"));
    expect(properties).toBeVisible();

    await user.click(button("Masquer les propriétés"));
    act(() => void window.dispatchEvent(new Event(SHOW_INSPECTOR_EVENT)));
    expect(properties).toBeVisible();
  });

  it("leaves a handle for each hidden panel, which opens it again (#198)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const properties = screen.getByRole("region", { name: "Propriétés" });
    const results = document.querySelector('section[aria-label="Résultats"]')!;
    // Before any simulation the results are hidden: their handle is at the top of the column.
    await user.click(button("Afficher le panneau Résultats"));
    expect(results).toBeVisible();

    await user.click(button("Masquer les propriétés"));
    await user.click(button("Masquer les résultats"));
    expect(properties).not.toBeVisible();
    // Both hidden: two handles at the window edge.
    await user.click(button("Afficher le panneau Propriétés"));
    expect(properties).toBeVisible();
    expect(button("Afficher le panneau Résultats")).toBeVisible();
  });

  it("folds the right column when its splitter is dragged well under its width (#198)", () => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
    render(<App />);
    const properties = screen.getByRole("region", { name: "Propriétés" });
    const bar = screen.getByRole("separator", { name: "Redimensionner le panneau de droite" });
    fireEvent.pointerDown(bar, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 700, pointerId: 1 });
    // Still open while dragging, only faded.
    expect(properties).toBeVisible();
    fireEvent.pointerUp(bar, { pointerId: 1 });
    expect(properties).not.toBeVisible();
    // Reopened at the width it had before the drag.
    const stored = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "{}");
    expect(stored).toMatchObject({ inspectorVisible: false, sideWidth: 440 });
    fireEvent.click(button("Afficher le panneau Propriétés"));
    expect(properties).toBeVisible();
  });

  it("goes back to full screen once the properties are done with (#95)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    onTestFinished(() => void vi.useRealTimers());
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    const properties = screen.getByRole("region", { name: "Propriétés" });

    await user.click(button("Afficher le schéma en plein écran"));
    act(() => void window.dispatchEvent(new Event(SHOW_INSPECTOR_EVENT)));
    expect(properties).toBeVisible();
    act(() => void vi.advanceTimersByTime(3500));
    expect(properties).not.toBeVisible();

    // Left by hand: it stays left.
    act(() => void window.dispatchEvent(new Event(SHOW_INSPECTOR_EVENT)));
    await user.click(button("Afficher le schéma en plein écran"));
    await user.click(button("Quitter le plein écran (Échap)"));
    act(() => void vi.advanceTimersByTime(3500));
    expect(properties).toBeVisible();
  });

  it("moves the results under the schematic and remembers it", async () => {
    const user = userEvent.setup();
    render(<App />);
    // The button names where the results are now; its tooltip says what a click does.
    expect(button("Résultats : à droite")).toHaveAttribute(
      "title",
      "Placer les résultats sous le schéma",
    );
    await user.click(button("Résultats : à droite"));
    expect(button("Résultats : en bas")).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "{}");
    expect(stored.resultsPosition).toBe("bottom");

    await user.click(button("Réinitialiser la disposition"));
    expect(button("Résultats : à droite")).toBeInTheDocument();
  });

  it("starts from the layout saved last time", () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ resultsPosition: "bottom" }));
    render(<App />);
    expect(button("Résultats : en bas")).toBeInTheDocument();
  });
});
