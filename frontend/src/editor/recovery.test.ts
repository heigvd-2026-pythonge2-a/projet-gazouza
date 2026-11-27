import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyDoc, isUnsaved, serializeDoc } from "../store";
import { fixtureDoc } from "../store/testFixtures";
import { dropComponent, editorState, resetEditorStore } from "../test/editorStore";
import { adoptFileName } from "./fileActions";
import {
  RECOVERY_DELAY_MS,
  RECOVERY_KEY,
  clearRecovery,
  endRecovery,
  readRecovery,
  startRecovery,
} from "./recovery";

const stored = () => window.localStorage.getItem(RECOVERY_KEY);

/** A copy as `startRecovery` writes it. */
const copy = (content: string, fileName: string | null = "pont.psice.json") =>
  JSON.stringify({
    format: "psice-recovery",
    version: 1,
    fileName,
    savedAt: "2026-11-26T13:05:00.000Z",
    content,
  });

beforeEach(() => {
  resetEditorStore();
  clearRecovery();
  adoptFileName(null);
  vi.useFakeTimers();
});
afterEach(() => {
  endRecovery();
  vi.useRealTimers();
});

describe("startRecovery", () => {
  it("copies the schematic once the changes pause, not at every change", () => {
    startRecovery();
    dropComponent("resistor");
    vi.advanceTimersByTime(RECOVERY_DELAY_MS / 2);
    dropComponent("capacitor", { x: 4, y: 0 });
    vi.advanceTimersByTime(RECOVERY_DELAY_MS / 2);
    expect(stored()).toBeNull();
    vi.advanceTimersByTime(RECOVERY_DELAY_MS);
    expect(readRecovery()?.doc).toEqual(editorState().doc);
  });

  it("keeps the name of the schematic's file", () => {
    adoptFileName("filtre.psice.json");
    startRecovery();
    dropComponent("resistor");
    vi.runAllTimers();
    expect(readRecovery()?.fileName).toBe("filtre.psice.json");
  });

  it("removes the copy at once when the schematic is saved, opened or new", () => {
    startRecovery();
    dropComponent("resistor");
    vi.runAllTimers();
    expect(stored()).not.toBeNull();
    editorState().markSaved(editorState().doc);
    expect(stored()).toBeNull();

    dropComponent("capacitor", { x: 4, y: 0 });
    vi.runAllTimers();
    editorState().openDocument(fixtureDoc("divider_op"));
    expect(stored()).toBeNull();

    dropComponent("capacitor", { x: 8, y: 0 });
    vi.runAllTimers();
    editorState().newDocument();
    expect(stored()).toBeNull();
  });

  it("removes the copy when the window closes normally, and copies nothing after", () => {
    startRecovery();
    dropComponent("resistor");
    vi.runAllTimers();
    window.dispatchEvent(new Event("pagehide"));
    expect(stored()).toBeNull();
    dropComponent("capacitor", { x: 4, y: 0 });
    vi.runAllTimers();
    expect(stored()).toBeNull();
  });

  it("copies nothing once stopped", () => {
    const stop = startRecovery();
    stop();
    dropComponent("resistor");
    vi.runAllTimers();
    expect(stored()).toBeNull();
  });
});

describe("readRecovery", () => {
  it("gives the schematic back as it was, with its file and date", () => {
    const doc = fixtureDoc("divider_op");
    window.localStorage.setItem(RECOVERY_KEY, copy(serializeDoc(doc)));
    expect(readRecovery()).toEqual({
      doc,
      fileName: "pont.psice.json",
      savedAt: new Date("2026-11-26T13:05:00.000Z"),
    });
  });

  it("ignores and removes a copy it cannot read", () => {
    const unknownPart = {
      ...emptyDoc(),
      components: [
        {
          id: "X1",
          type: "warp_drive",
          position: { x: 0, y: 0 },
          rotation: 0 as const,
          mirror: false,
          params: {},
        },
      ],
    };
    for (const bad of [
      "{not json",
      "null",
      JSON.stringify({ format: "psice-recovery", version: 99, content: "" }),
      copy(JSON.stringify({ format: "psice-schematic", version: 0 })),
      copy(serializeDoc(unknownPart)),
    ]) {
      window.localStorage.setItem(RECOVERY_KEY, bad);
      expect(readRecovery()).toBeNull();
      expect(stored()).toBeNull();
    }
  });

  it("finds nothing when there is no copy", () => {
    expect(readRecovery()).toBeNull();
  });
});

describe("restoring the copy", () => {
  it("opens the copy marked as modified, with nothing to undo", () => {
    const doc = fixtureDoc("divider_op");
    editorState().openDocument(doc, true);
    expect(editorState().doc).toEqual(doc);
    expect(isUnsaved(editorState())).toBe(true);
    expect(editorState().history.past).toHaveLength(0);
  });
});
