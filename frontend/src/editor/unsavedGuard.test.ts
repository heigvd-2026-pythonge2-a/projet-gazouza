import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { useUnsavedChangesGuard } from "./unsavedGuard";

beforeEach(resetEditorStore);

/** Sends `beforeunload` and tells whether the page asked to stay (the confirmation shows). */
function closeWindow(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("useUnsavedChangesGuard", () => {
  it("asks before closing only while there are unsaved changes", () => {
    renderHook(() => useUnsavedChangesGuard());
    expect(closeWindow()).toBe(false);
    dropComponent("resistor");
    expect(closeWindow()).toBe(true);
    editorState().markSaved(editorState().doc);
    expect(closeWindow()).toBe(false);
  });

  it("lets the launcher ask, while the editor is shown", () => {
    const view = renderHook(() => useUnsavedChangesGuard());
    expect(window.psiceHasUnsavedChanges?.()).toBe(false);
    dropComponent("resistor");
    expect(window.psiceHasUnsavedChanges?.()).toBe(true);

    view.unmount();
    expect(window.psiceHasUnsavedChanges).toBeUndefined();
    expect(closeWindow()).toBe(false);
  });
});
