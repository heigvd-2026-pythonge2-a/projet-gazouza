import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../store";
import { fixtureDoc, fixtureResult } from "../store/testFixtures";
import { editorState, resetEditorStore } from "../test/editorStore";
import { AnimateButton, AnimationControls } from "./AnimationControls";

beforeEach(resetEditorStore);

/** Opens a fixture circuit with its result, as if it had just been simulated. */
function simulated(name: string) {
  act(() => {
    editorState().openDocument(fixtureDoc(name));
    editorState().setSimulation(fixtureResult(name));
  });
}

const animate = () => screen.getByRole("button", { name: /animation|Animer/ });

describe("AnimateButton", () => {
  it("is disabled until a simulation, and says why", () => {
    render(<AnimateButton />);
    expect(animate()).toBeDisabled();
    expect(animate()).toHaveAttribute("title", expect.stringMatching(/après une simulation/));
  });

  it("is disabled for an analysis that cannot be animated", () => {
    render(<AnimateButton />);
    simulated("lowpass_ac");
    expect(animate()).toBeDisabled();
    expect(animate()).toHaveAttribute("title", expect.stringMatching(/\.op et \.tran/));
  });

  it("starts and stops the animation", async () => {
    const user = userEvent.setup();
    render(<AnimateButton />);
    simulated("divider_op");
    await user.click(animate());
    expect(editorState().animation.on).toBe(true);
    expect(animate()).toHaveAttribute("aria-pressed", "true");
    expect(animate()).toHaveTextContent("Arrêter l'animation");
    await user.click(animate());
    expect(editorState().animation.on).toBe(false);
  });
});

describe("AnimationControls", () => {
  it("shows nothing while the animation is off", () => {
    simulated("rc_tran");
    const { container } = render(<AnimationControls />);
    expect(container).toBeEmptyDOMElement();
  });

  it("sets the direction of the current", async () => {
    const user = userEvent.setup();
    simulated("divider_op");
    act(() => editorState().setAnimation({ on: true }));
    render(<AnimationControls />);
    await user.selectOptions(screen.getByLabelText("Sens du courant"), "Sens des électrons");
    expect(editorState().animation.electrons).toBe(true);
    // An operating point does not change with time: no playback controls.
    expect(screen.queryByLabelText("Vitesse de lecture")).not.toBeInTheDocument();
  });

  it("plays back a transient analysis", async () => {
    const user = userEvent.setup();
    simulated("rc_tran");
    act(() => editorState().setAnimation({ on: true }));
    render(<AnimationControls />);
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(editorState().animation.playing).toBe(false);
    expect(screen.getByRole("button", { name: "Lecture" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Vitesse de lecture"), "×2");
    expect(editorState().animation.speed).toBe(2);
    expect(screen.getByText(/t = 0 s \/ 5 ms/)).toBeInTheDocument();
  });

  it("explains why it stopped once the schematic changed", () => {
    simulated("divider_op");
    act(() => editorState().setAnimation({ on: true }));
    render(<AnimationControls />);
    act(() => {
      editorState().selectAll();
      useEditorStore.getState().moveSelection({ x: 1, y: 0 });
    });
    expect(screen.getByText(/Schéma modifié depuis la simulation/)).toBeInTheDocument();
  });
});
