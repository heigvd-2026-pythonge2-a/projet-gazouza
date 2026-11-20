import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MaximizeButton } from "./MaximizeButton";
import { PanelErrorBoundary } from "./PanelErrorBoundary";
import { Splitter } from "./Splitter";

describe("Splitter", () => {
  beforeEach(() => {
    // jsdom has no pointer capture.
    HTMLElement.prototype.setPointerCapture = vi.fn();
  });

  const setup = (direction: 1 | -1, orientation: "vertical" | "horizontal" = "vertical") => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(
      <Splitter
        orientation={orientation}
        label="Redimensionner"
        value={200}
        direction={direction}
        onChange={onChange}
        onReset={onReset}
      />,
    );
    return { onChange, onReset, bar: screen.getByRole("separator", { name: "Redimensionner" }) };
  };

  it("resizes with the arrow keys, in the panel's direction", async () => {
    const user = userEvent.setup();
    const { onChange, bar } = setup(-1);
    expect(bar).toHaveAttribute("aria-valuenow", "200");
    bar.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(184);
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith(216);
    // Up / down mean nothing for a vertical bar.
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("follows a drag from where it started", () => {
    const { onChange, bar } = setup(1, "horizontal");
    fireEvent.pointerDown(bar, { button: 0, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientY: 130, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(230);
    fireEvent.pointerUp(bar, { pointerId: 1 });
    fireEvent.pointerMove(bar, { clientY: 400, pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("ignores the right button, and resets on a double click", () => {
    const { onChange, onReset, bar } = setup(1);
    fireEvent.pointerDown(bar, { button: 2, clientX: 0 });
    fireEvent.pointerMove(bar, { clientX: 50 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.doubleClick(bar);
    expect(onReset).toHaveBeenCalledOnce();
  });
});

describe("MaximizeButton", () => {
  it("names the panel, and says how to leave full screen", () => {
    const { rerender } = render(
      <MaximizeButton panel="le schéma" maximized={false} onClick={() => {}} />,
    );
    expect(
      screen.getByRole("button", { name: "Afficher le schéma en plein écran" }),
    ).toHaveAttribute("aria-pressed", "false");
    rerender(<MaximizeButton panel="le schéma" maximized onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Quitter le plein écran (Échap)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("PanelErrorBoundary", () => {
  beforeEach(() => {
    // React and the boundary log the error: keep the test output readable.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  function Bomb({ explode }: { explode: boolean }) {
    if (explode) throw new Error("Boum");
    return <p>Contenu</p>;
  }

  /** A panel whose content fails until "réparer" is clicked. */
  function Panel({ onRescue, compact }: { onRescue?: () => void; compact?: boolean }) {
    const [broken, setBroken] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setBroken(false)}>
          réparer
        </button>
        <PanelErrorBoundary panel="le schéma" onRescue={onRescue} compact={compact}>
          <Bomb explode={broken} />
        </PanelErrorBoundary>
        <p>Autre panneau</p>
      </>
    );
  }

  it("shows the error in the panel only, and offers a rescue copy", async () => {
    const user = userEvent.setup();
    const onRescue = vi.fn();
    render(<Panel onRescue={onRescue} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Une erreur est survenue dans le schéma.");
    expect(alert).toHaveTextContent("Boum");
    expect(screen.getByText("Autre panneau")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enregistrer une copie du schéma" }));
    expect(onRescue).toHaveBeenCalledOnce();
  });

  it("shows the panel again on Réessayer once the cause is gone", async () => {
    const user = userEvent.setup();
    render(<Panel />);
    expect(screen.queryByRole("button", { name: /copie/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "réparer" }));
    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Contenu")).toBeInTheDocument();
  });

  it("puts the message on one line in compact mode", () => {
    render(<Panel compact />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("title", "Boum");
    expect(alert.querySelectorAll("p")).toHaveLength(0);
  });
});
