import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { addComponent, emptyDoc, setParam, type EditorDoc } from "../store";
import { ErrorBubbles } from "./ErrorBubbles";
import { GRID } from "./theme";

const viewport = { x: 100, y: 50, scale: 2 };

function resistor(value: string): { doc: EditorDoc; id: string } {
  const added = addComponent(emptyDoc(), {
    type: "resistor",
    position: { x: 3, y: 4 },
    rotation: 0,
    mirror: false,
  });
  return { doc: setParam(added.doc, added.id, "resistance", value), id: added.id };
}

describe("ErrorBubbles", () => {
  it("shows nothing when every value is fine", () => {
    const { container } = render(
      <ErrorBubbles doc={resistor("1k").doc} viewport={viewport} onPick={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("points at the component with the message, and picks its field on click", async () => {
    const onPick = vi.fn();
    const { doc, id } = resistor("10l");
    render(<ErrorBubbles doc={doc} viewport={viewport} onPick={onPick} />);
    const bubble = screen.getByRole("button", { name: /^R1 : Valeur non reconnue/ });
    expect(bubble).toHaveAttribute("data-level", "error");
    // Centred under the component, which is at (3, 4) on the grid.
    expect(parseFloat(bubble.parentElement?.style.left ?? "")).toBeCloseTo(3 * GRID * 2 + 100);
    expect(parseFloat(bubble.parentElement?.style.top ?? "")).toBeGreaterThan(4 * GRID * 2 + 50);
    await userEvent.click(bubble);
    expect(onPick).toHaveBeenCalledWith(id, "resistance");
  });

  it("styles a warning apart from an error", () => {
    render(<ErrorBubbles doc={resistor("1M").doc} viewport={viewport} onPick={() => {}} />);
    expect(screen.getByRole("button", { name: /milli/ })).toHaveAttribute("data-level", "warning");
  });
});
