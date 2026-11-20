import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu, type MenuItem } from "./ContextMenu";

function setup(overrides: Partial<Record<string, Partial<MenuItem>>> = {}) {
  const run = { rotate: vi.fn(), copy: vi.fn(), props: vi.fn(), remove: vi.fn() };
  const items: MenuItem[] = [
    { label: "Tourner", shortcut: "R", keys: ["r", "R"], onSelect: run.rotate },
    { label: "Copier", shortcut: "Ctrl+C", keys: ["c"], onSelect: run.copy },
    { label: "Propriétés…", disabled: true, onSelect: run.props },
    { label: "Supprimer", keys: ["Delete"], onSelect: run.remove },
  ].map((item) => ({ ...item, ...overrides[item.label] }));
  const onClose = vi.fn();
  const view = render(<ContextMenu x={10} y={20} items={items} onClose={onClose} />);
  return { run, onClose, view, item: (name: string) => screen.getByRole("menuitem", { name }) };
}

describe("ContextMenu", () => {
  it("focuses the first item and shows the shortcuts", () => {
    const { item } = setup();
    expect(item("Tourner R")).toHaveFocus();
    expect(item("Tourner R")).toHaveAttribute("aria-keyshortcuts", "R");
    expect(item("Propriétés…")).toBeDisabled();
  });

  it("moves with the arrows, Home and End, skipping disabled items", async () => {
    const user = userEvent.setup();
    const { item } = setup();
    await user.keyboard("{ArrowDown}");
    expect(item("Copier Ctrl+C")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item("Supprimer")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item("Tourner R")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(item("Supprimer")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(item("Tourner R")).toHaveFocus();
    await user.keyboard("{End}");
    expect(item("Supprimer")).toHaveFocus();
  });

  it("runs the focused item on Enter, and closes", async () => {
    const user = userEvent.setup();
    const { run, onClose } = setup();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(run.copy).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
  });

  it("runs an item from its key, not with Ctrl held", async () => {
    const user = userEvent.setup();
    const { run } = setup();
    await user.keyboard("{Control>}r{/Control}");
    expect(run.rotate).not.toHaveBeenCalled();
    await user.keyboard("r");
    expect(run.rotate).toHaveBeenCalledOnce();
  });

  it("never runs a disabled item", async () => {
    const user = userEvent.setup();
    const { run, item } = setup();
    await user.click(item("Propriétés…"));
    expect(run.props).not.toHaveBeenCalled();
  });

  it("closes on Escape without letting the key reach the editor", async () => {
    const user = userEvent.setup();
    const editorKeys = vi.fn();
    window.addEventListener("keydown", editorKeys);
    const { onClose } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    expect(editorKeys).not.toHaveBeenCalled();
    window.removeEventListener("keydown", editorKeys);
  });

  it("closes on a press or the wheel outside it, not inside", () => {
    const { onClose, item } = setup();
    fireEvent.pointerDown(item("Copier Ctrl+C"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.wheel(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("gives the focus back when it closes", () => {
    const before = document.createElement("button");
    document.body.append(before);
    before.focus();
    const { view } = setup();
    expect(before).not.toHaveFocus();
    view.unmount();
    expect(before).toHaveFocus();
    before.remove();
  });
});
