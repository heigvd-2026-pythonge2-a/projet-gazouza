import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isUnsaved, serializeDoc } from "../store";
import { fixtureDoc } from "../store/testFixtures";
import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { adoptFileName, currentFileName } from "./fileActions";
import { RECOVERY_DELAY_MS, RECOVERY_KEY, clearRecovery, endRecovery } from "./recovery";
import { RecoveryPrompt } from "./RecoveryPrompt";

const leaveCopy = (fileName: string | null) =>
  window.localStorage.setItem(
    RECOVERY_KEY,
    JSON.stringify({
      format: "psice-recovery",
      version: 1,
      fileName,
      savedAt: "2026-11-26T13:05:00.000Z",
      content: serializeDoc(fixtureDoc("divider_op")),
    }),
  );

const stored = () => window.localStorage.getItem(RECOVERY_KEY);

beforeEach(() => {
  resetEditorStore();
  clearRecovery();
  adoptFileName(null);
});
afterEach(endRecovery);

describe("RecoveryPrompt", () => {
  it("asks nothing when there is no copy", () => {
    render(<RecoveryPrompt />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("restores the copy found, marked as modified, with its file name", async () => {
    leaveCopy("pont.psice.json");
    const user = userEvent.setup();
    render(<RecoveryPrompt />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      /Un schéma non enregistré a été retrouvé \(« pont\.psice\.json »\).*Le restaurer \?/,
    );
    expect(screen.getByRole("button", { name: "Restaurer" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Restaurer" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(editorState().doc).toEqual(fixtureDoc("divider_op"));
    expect(isUnsaved(editorState())).toBe(true);
    expect(currentFileName()).toBe("pont.psice.json");
    // Still unsaved: the copy is kept for a next crash.
    expect(stored()).not.toBeNull();
  });

  it("drops the copy when ignored, and starts copying the new work", async () => {
    leaveCopy(null);
    const user = userEvent.setup();
    render(<RecoveryPrompt />);
    await user.click(screen.getByRole("button", { name: "Ignorer" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(stored()).toBeNull();
    expect(editorState().doc.components).toEqual([]);
    act(() => void dropComponent("resistor"));
    await new Promise((r) => setTimeout(r, RECOVERY_DELAY_MS + 100));
    expect(stored()).not.toBeNull();
  });

  it("keeps the copy found until the question is answered", () => {
    leaveCopy(null);
    render(<RecoveryPrompt />);
    const before = stored();
    act(() => editorState().newDocument());
    expect(stored()).toBe(before);
  });
});
