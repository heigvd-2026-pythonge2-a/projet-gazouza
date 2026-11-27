import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { CloseDialog } from "./CloseDialog";
import { saveFile } from "./fileActions";
import { answerUnsavedQuestion, askBeforeDroppingChanges, NATIVE_QUESTION } from "./unsavedDialog";

vi.mock("./fileActions", () => ({ saveFile: vi.fn() }));

const save = vi.mocked(saveFile);

beforeEach(() => {
  resetEditorStore();
  save.mockReset();
});

/** What the launcher does when the window is about to close. */
function requestClose(): Promise<boolean> {
  let answer!: Promise<boolean>;
  act(() => {
    answer = window.psiceRequestClose!();
  });
  return answer;
}

/** Tells whether `promise` is still waiting for an answer. */
async function pending(promise: Promise<unknown>): Promise<boolean> {
  const waiting = Symbol();
  return (await Promise.race([promise, Promise.resolve(waiting)])) === waiting;
}

const button = (name: string) => screen.getByRole("button", { name });

describe("CloseDialog", () => {
  it("lets the window close at once when everything is saved", async () => {
    render(<CloseDialog />);
    expect(await requestClose()).toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("offers to cancel, close without saving, or save and close", async () => {
    render(<CloseDialog />);
    dropComponent("resistor");
    const answer = requestClose();
    expect(screen.getByRole("alertdialog", { name: "Fermer Psice" })).toBeTruthy();
    expect(button("Enregistrer et fermer")).toBe(document.activeElement);
    expect(await pending(answer)).toBe(true);

    await userEvent.click(button("Annuler"));
    expect(await answer).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    const again = requestClose();
    await userEvent.click(button("Fermer sans enregistrer"));
    expect(await again).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("closes only once the schematic is saved", async () => {
    render(<CloseDialog />);
    dropComponent("resistor");
    let saved: (ok: boolean) => void = () => {};
    save.mockImplementation(() => new Promise((r) => (saved = r)));
    const answer = requestClose();

    await userEvent.click(button("Enregistrer et fermer"));
    expect(save).toHaveBeenCalledOnce();
    expect(await pending(answer)).toBe(true);
    expect(button("Annuler")).toHaveProperty("disabled", true);

    await act(async () => saved(true));
    expect(await answer).toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("stays open when the save does not happen", async () => {
    render(<CloseDialog />);
    dropComponent("resistor");
    save.mockResolvedValue(false); // file dialog closed or write error
    const answer = requestClose();

    await userEvent.click(button("Enregistrer et fermer"));
    expect(await pending(answer)).toBe(true);
    expect(button("Annuler")).toHaveProperty("disabled", false);

    await userEvent.click(button("Annuler"));
    expect(await answer).toBe(false);
  });

  it("cancels with Escape, without reaching the editor's shortcuts", async () => {
    render(<CloseDialog />);
    dropComponent("resistor");
    const editorKeys = vi.fn();
    window.addEventListener("keydown", editorKeys);
    const answer = requestClose();

    await userEvent.keyboard("{Delete}{Escape}");
    expect(await answer).toBe(false);
    expect(editorKeys).not.toHaveBeenCalled();
    expect(editorState().doc.components).toHaveLength(1);
    window.removeEventListener("keydown", editorKeys);
  });

  it("answers a second request with the same dialog", async () => {
    render(<CloseDialog />);
    dropComponent("resistor");
    const first = requestClose();
    const second = requestClose();
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    await userEvent.click(button("Fermer sans enregistrer"));
    expect(await first).toBe(true);
    expect(await second).toBe(true);
  });

  it("asks with the words of the action, and goes on once saved (#332)", async () => {
    render(<CloseDialog />);
    dropComponent("resistor");
    save.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    let answer!: Promise<boolean>;
    act(() => {
      answer = askBeforeDroppingChanges("open");
    });
    expect(screen.getByRole("alertdialog", { name: "Ouvrir un schéma" })).toBeTruthy();
    expect(button("Ouvrir sans enregistrer")).toBeTruthy();

    // The save dialog was closed: the schematic stays, and so does the question.
    await userEvent.click(button("Enregistrer et ouvrir"));
    expect(await pending(answer)).toBe(true);
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    await userEvent.click(button("Enregistrer et ouvrir"));
    expect(await answer).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("is only offered while the editor is shown", async () => {
    const view = render(<CloseDialog />);
    dropComponent("resistor");
    const answer = requestClose();
    view.unmount();
    expect(await answer).toBe(false);
    expect(window.psiceRequestClose).toBeUndefined();
  });

  it("shows while the schematic is hidden, the results taking the whole window", () => {
    render(
      <div style={{ display: "none" }} data-testid="schematic">
        <CloseDialog />
      </div>,
    );
    dropComponent("resistor");
    act(() => void askBeforeDroppingChanges("new"));
    const dialog = screen.getByRole("alertdialog", { name: "Nouveau schéma" });
    expect(dialog).toBeVisible();
    expect(screen.getByTestId("schematic")).not.toContainElement(dialog);
    act(() => answerUnsavedQuestion(false));
  });

  it("asks with the browser's confirmation when no dialog is shown (crashed schematic)", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    dropComponent("resistor");
    expect(await askBeforeDroppingChanges("new")).toBe(true);
    expect(confirm).toHaveBeenCalledWith(NATIVE_QUESTION);

    // Once a dialog has come and gone, the same.
    render(<CloseDialog />).unmount();
    confirm.mockReturnValue(false);
    expect(await askBeforeDroppingChanges("open")).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    vi.unstubAllGlobals();
  });
});
