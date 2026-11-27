// Switches and push buttons worked with a click (#43).

import { beforeEach, describe, expect, it } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { emptyDoc } from "./document";
import { isSwitch, isUnsaved, simulatedDoc, toggledState } from "./editorStore";

beforeEach(resetEditorStore);

describe("toggleSwitch", () => {
  it("closes an open switch and opens it again, one undo step each time", () => {
    const sw = dropComponent("switch");
    expect(sw.params.state).toBe("SW_OPEN");
    editorState().toggleSwitch(sw.id);
    expect(editorState().doc.components[0]!.params.state).toBe("SW_CLOSED");
    editorState().toggleSwitch(sw.id);
    expect(editorState().doc.components[0]!.params.state).toBe("SW_OPEN");
    editorState().undo();
    expect(editorState().doc.components[0]!.params.state).toBe("SW_CLOSED");
    // The state is part of the schematic: it is saved with it.
    expect(isUnsaved(editorState())).toBe(true);
  });

  it("does nothing to another component", () => {
    const r = dropComponent("resistor");
    const doc = editorState().doc;
    editorState().toggleSwitch(r.id);
    expect(editorState().doc).toBe(doc);
  });

  it("toggles a missing or unknown state to closed", () => {
    expect(toggledState(undefined)).toBe("SW_CLOSED");
    expect(toggledState("SW_CLOSED")).toBe("SW_OPEN");
    expect(isSwitch("push_button")).toBe(true);
    expect(isSwitch("resistor")).toBe(false);
  });
});

describe("a push button held down", () => {
  it("is simulated closed, while the document stays as it is", () => {
    const pb = dropComponent("push_button");
    const doc = editorState().doc;
    editorState().pressButton(pb.id);
    expect(editorState().doc).toBe(doc);
    expect(isUnsaved(editorState())).toBe(true); // from the drop, not from the press
    const simulated = simulatedDoc(doc, pb.id);
    expect(simulated.components[0]!.params.state).toBe("SW_CLOSED");
    expect(simulatedDoc(doc, null)).toBe(doc);
  });

  it("is let go when another schematic is opened", () => {
    const pb = dropComponent("push_button");
    editorState().pressButton(pb.id);
    editorState().openDocument(emptyDoc());
    expect(editorState().pressedButton).toBeNull();
  });
});
