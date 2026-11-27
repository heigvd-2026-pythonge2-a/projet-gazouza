// Getting an unsaved schematic back after a crash (#274).
//
// While the schematic has unsaved changes, a copy of it (the content of a .psice.json file, and
// the name of its file if any) is kept in the localStorage of the window, a moment after each
// change. It goes once the schematic is saved, replaced by another one or the window closes
// normally: a copy found at startup means the app did not close properly, and the user is asked
// whether to restore it (RecoveryPrompt.tsx).

import { isUnsaved, parseDoc, serializeDoc, useEditorStore, type EditorDoc } from "../store";
import { currentFileName } from "./fileActions";

/** localStorage key of the copy; the version in the stored value tells its shape. */
export const RECOVERY_KEY = "psice.recovery";

/**
 * Delay between the last change and the copy: one copy for a burst of changes (typing a value,
 * arrow keys held down), never one per mouse move (a drag changes the schematic once, at the end).
 */
export const RECOVERY_DELAY_MS = 1000;

const FORMAT = "psice-recovery";
const VERSION = 1;

/** What is stored. */
interface StoredCopy {
  format: typeof FORMAT;
  version: typeof VERSION;
  /** Name of the schematic's file, null if it was never saved. */
  fileName: string | null;
  /** When the copy was written (ISO 8601). */
  savedAt: string;
  /** The schematic, as in a .psice.json file. */
  content: string;
}

/** A copy found at startup. */
export interface RecoveredCopy {
  doc: EditorDoc;
  fileName: string | null;
  savedAt: Date | null;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Removes the copy, if any. */
export function clearRecovery() {
  try {
    storage()?.removeItem(RECOVERY_KEY);
  } catch {
    // Storage blocked: there is no copy to remove either.
  }
}

/**
 * The copy left by a session that did not close properly, or null. A copy that cannot be read (an
 * older format, broken JSON, a component the library does not know) is removed without a word.
 * Needs the component library (read by `parseDoc`).
 */
export function readRecovery(): RecoveredCopy | null {
  let text: string | null;
  try {
    text = storage()?.getItem(RECOVERY_KEY) ?? null;
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    const stored = JSON.parse(text) as Partial<StoredCopy> | null;
    if (
      !stored ||
      stored.format !== FORMAT ||
      stored.version !== VERSION ||
      typeof stored.content !== "string"
    ) {
      throw new Error("unknown copy");
    }
    const savedAt = typeof stored.savedAt === "string" ? new Date(stored.savedAt) : null;
    return {
      doc: parseDoc(stored.content),
      fileName: typeof stored.fileName === "string" ? stored.fileName : null,
      savedAt: savedAt && !Number.isNaN(savedAt.getTime()) ? savedAt : null,
    };
  } catch {
    clearRecovery();
    return null;
  }
}

/** Keeps the copy in step with the schematic now: written if it has unsaved changes, else gone. */
function syncRecovery() {
  const state = useEditorStore.getState();
  if (!isUnsaved(state)) {
    clearRecovery();
    return;
  }
  const copy: StoredCopy = {
    format: FORMAT,
    version: VERSION,
    fileName: currentFileName(),
    savedAt: new Date().toISOString(),
    content: serializeDoc(state.doc),
  };
  try {
    storage()?.setItem(RECOVERY_KEY, JSON.stringify(copy));
  } catch {
    // Storage full or blocked: no copy, the app works as before.
  }
}

/** Stops the copies started by `startRecovery`, if they run. */
let stopRecovery: (() => void) | null = null;

/**
 * Starts keeping the copy, until the returned function is called. Once the user has answered
 * about a copy found at startup, not before: that copy must not be replaced meanwhile.
 */
export function startRecovery(): () => void {
  stopRecovery?.();
  let timer: number | undefined;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(syncRecovery, RECOVERY_DELAY_MS);
  };
  const unsubscribe = useEditorStore.subscribe((s, prev) => {
    if (s.doc === prev.doc && s.savedDoc === prev.savedDoc) return;
    // Saved, opened, new: the copy goes at once. Changed: copied once the changes pause.
    if (isUnsaved(s)) {
      schedule();
    } else {
      window.clearTimeout(timer);
      clearRecovery();
    }
  });
  // A normal close: nothing to recover next time.
  const onPageHide = () => endRecovery();
  window.addEventListener("pagehide", onPageHide);
  syncRecovery();

  const stop = () => {
    window.clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("pagehide", onPageHide);
    if (stopRecovery === stop) stopRecovery = null;
  };
  stopRecovery = stop;
  return stop;
}

/**
 * The window closes normally (pagehide, or the close dialog let it go, CloseDialog.tsx): stop the
 * copies and remove the last one, so the next start does not offer it.
 */
export function endRecovery() {
  stopRecovery?.();
  clearRecovery();
}
