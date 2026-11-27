import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { SHORTCUT_GROUPS } from "./shortcuts";
import { StatusBar } from "./StatusBar";
import { REPOSITORY_URL, TEAM } from "./team";

beforeEach(resetEditorStore);

describe("TeamDialog", () => {
  it("summons the team with Ctrl+Shift+E and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<StatusBar />);
    await user.keyboard("{Control>}{Shift>}E{/Shift}{/Control}");

    const dialog = screen.getByRole("dialog", { name: "L'équipe Psice" });
    expect(dialog).toHaveClass("psice-team-animated");
    for (const member of TEAM) {
      expect(screen.getByText(member.name)).toBeInTheDocument();
      expect(screen.getByText(member.role)).toBeInTheDocument();
    }

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the selection when Escape closes the window", async () => {
    const user = userEvent.setup();
    render(<StatusBar />);
    act(() => void dropComponent("resistor"));
    await user.keyboard("{Control>}{Shift>}e{/Shift}{/Control}");
    await user.keyboard("{Escape}");
    expect(editorState().selection).toHaveLength(1);
  });

  it("opens the about window from the status bar, without animation, and closes on a click", async () => {
    const user = userEvent.setup();
    render(<StatusBar />);
    await user.click(screen.getByRole("button", { name: "À propos" }));

    const dialog = screen.getByRole("dialog", { name: "À propos de Psice" });
    expect(dialog).not.toHaveClass("psice-team-animated");
    expect(dialog).toHaveTextContent(/version \d+\.\d+\.\d+/);
    expect(dialog).toHaveTextContent(/licence MIT/);
    expect(screen.getByRole("link")).toHaveAttribute("href", REPOSITORY_URL);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);

    await user.click(dialog);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is listed with the other shortcuts", () => {
    const keys = SHORTCUT_GROUPS.flatMap((g) => g.items).map((i) => i.keys);
    expect(keys).toContain("Ctrl+Maj+E");
  });
});
