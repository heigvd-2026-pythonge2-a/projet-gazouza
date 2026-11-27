import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { editorState, resetEditorStore } from "../test/editorStore";
import { COLLAPSED_GROUPS_KEY, DRAG_TYPE, Palette, TILE_MIN_WIDTH } from "./Palette";
import { entryForKey } from "./paletteLayout";

beforeEach(resetEditorStore);

const tile = (label: string) => screen.getByRole("button", { name: new RegExp(`^\\d?${label}$`) });

describe("Palette", () => {
  it("groups the components by category, with their digit key", () => {
    render(<Palette />);
    for (const group of ["Passifs", "Sources", "Connexions"]) {
      expect(screen.getByRole("region", { name: group })).toBeInTheDocument();
    }
    expect(tile("Résistance")).toHaveAttribute("aria-keyshortcuts", "1");
    expect(tile("Fil")).toHaveAttribute("aria-keyshortcuts");
  });

  it("starts placing a component, or drawing wires, on a click", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.click(tile("Condensateur"));
    expect(editorState().tool).toMatchObject({ kind: "place", type: "capacitor" });
    await user.click(tile("Fil"));
    expect(editorState().tool).toEqual({ kind: "wire" });
  });

  it("puts the component type in the data of a drag", () => {
    render(<Palette />);
    const setData = vi.fn();
    fireEvent.dragStart(tile("Résistance"), { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith(DRAG_TYPE, "resistor");
    expect(tile("Fil")).not.toHaveAttribute("draggable", "true");
  });

  it("narrows the palette to what the search matches, accents ignored", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.type(screen.getByRole("searchbox", { name: "Rechercher un composant" }), "resist");
    expect(tile("Résistance")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Condensateur/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sources" })).not.toBeInTheDocument();
    // The digit key stays the one of the whole palette.
    expect(tile("Résistance")).toHaveAttribute("aria-keyshortcuts", "1");
  });

  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByRole("status")).toHaveTextContent("Aucun composant");
  });

  it("picks the first result with Enter, and clears the field with Escape", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    const search = screen.getByRole("searchbox");
    await user.type(search, "bobine{Enter}");
    expect(editorState().tool).toMatchObject({ kind: "place", type: "inductor" });
    expect(search).not.toHaveFocus();
    await user.click(search);
    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(tile("Condensateur")).toBeInTheDocument();
  });

  it("goes to the search field with Ctrl+F", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.keyboard("{Control>}f{/Control}");
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });
});

describe("folding the groups of the palette (#331)", () => {
  beforeEach(() => window.localStorage.removeItem(COLLAPSED_GROUPS_KEY));

  const header = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}$`) });

  it("folds a group with a click on its title, and opens it again", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    expect(header("Passifs")).toHaveAttribute("aria-expanded", "true");
    await user.click(header("Passifs"));
    expect(header("Passifs")).toHaveAttribute("aria-expanded", "false");
    // Hidden by its style: an inline `display` would win over the `hidden` attribute.
    const panel = document.getElementById(header("Passifs").getAttribute("aria-controls")!);
    expect(panel).toHaveStyle({ display: "none" });
    expect(screen.queryByRole("button", { name: /Résistance/ })).toBeNull();
    // The other groups stay open.
    expect(tile("Fil")).toBeInTheDocument();
    await user.click(header("Passifs"));
    expect(tile("Résistance")).toBeInTheDocument();
  });

  it("works from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    header("Sources").focus();
    await user.keyboard("{Enter}");
    expect(header("Sources")).toHaveAttribute("aria-expanded", "false");
  });

  it("remembers the folded groups after a restart", async () => {
    const user = userEvent.setup();
    const first = render(<Palette />);
    await user.click(header("Passifs"));
    first.unmount();
    render(<Palette />);
    expect(header("Passifs")).toHaveAttribute("aria-expanded", "false");
    expect(header("Sources")).toHaveAttribute("aria-expanded", "true");
  });

  it("ignores a stored value it cannot read", () => {
    window.localStorage.setItem(COLLAPSED_GROUPS_KEY, "{pas du json");
    render(<Palette />);
    expect(header("Passifs")).toHaveAttribute("aria-expanded", "true");
  });

  it("shows the results of a search even in a folded group", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.click(header("Passifs"));
    await user.type(screen.getByRole("searchbox"), "condens");
    expect(tile("Condensateur")).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox"));
    expect(screen.queryByRole("button", { name: /Condensateur/ })).toBeNull();
  });

  it("keeps the digit keys on the same tools, folded or not", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.click(header("Passifs"));
    expect(entryForKey("1")).toMatchObject({ kind: "place", def: { type: "resistor" } });
  });

  it("fits as many columns as the panel's width allows", () => {
    render(<Palette />);
    const grid = tile("Résistance").parentElement!;
    expect(grid.style.gridTemplateColumns).toBe(
      `repeat(auto-fill, minmax(${TILE_MIN_WIDTH}px, 1fr))`,
    );
  });
});
