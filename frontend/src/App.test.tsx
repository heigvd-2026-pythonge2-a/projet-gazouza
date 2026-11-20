import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { LAYOUT_STORAGE_KEY } from "./layout/storage";
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
    // Still in full screen: the results stay hidden.
    expect(screen.getByRole("region", { name: "Résultats", hidden: true })).not.toBeVisible();
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
