// The question asked before unsaved changes are dropped (#238, #332): by New, Open, Examples,
// the LTspice import, a dropped file, and the desktop window about to close. CloseDialog.tsx
// shows it and answers it: cancel, go on without saving, or save then go on.

import { create } from "zustand";

import { isUnsaved, useEditorStore } from "../store";

/** What is about to drop the schematic. */
export type UnsavedAction = "close" | "new" | "open" | "example" | "import";

/** The texts of the dialog for one action. */
export interface UnsavedQuestion {
  title: string;
  /** Main button: saves, then does the action once the file is written. */
  save: string;
  /** Does the action without saving. */
  discard: string;
}

export const UNSAVED_QUESTIONS: Record<UnsavedAction, UnsavedQuestion> = {
  close: {
    title: "Fermer Psice",
    save: "Enregistrer et fermer",
    discard: "Fermer sans enregistrer",
  },
  new: {
    title: "Nouveau schéma",
    save: "Enregistrer et créer",
    discard: "Créer sans enregistrer",
  },
  open: {
    title: "Ouvrir un schéma",
    save: "Enregistrer et ouvrir",
    discard: "Ouvrir sans enregistrer",
  },
  example: {
    title: "Ouvrir un exemple",
    save: "Enregistrer et ouvrir",
    discard: "Ouvrir sans enregistrer",
  },
  import: {
    title: "Importer un schéma LTspice",
    save: "Enregistrer et importer",
    discard: "Importer sans enregistrer",
  },
};

/** The question shown, and how to answer whoever asked it. */
interface PendingQuestion {
  question: UnsavedQuestion;
  promise: Promise<boolean>;
  resolve: (goOn: boolean) => void;
}

/** The question waiting for the user, if any (read by CloseDialog.tsx). */
export const useUnsavedDialog = create<{ pending: PendingQuestion | null }>()(() => ({
  pending: null,
}));

/**
 * Asks what to do with unsaved changes before `action`. Resolves to true when the action may go
 * on: nothing unsaved, "… sans enregistrer", or the schematic was saved. False: cancelled. A
 * second question while one is shown gets the same answer.
 */
export function askBeforeDroppingChanges(action: UnsavedAction): Promise<boolean> {
  if (!isUnsaved(useEditorStore.getState())) return Promise.resolve(true);
  const shown = useUnsavedDialog.getState().pending;
  if (shown) return shown.promise;
  let resolve: (goOn: boolean) => void = () => {};
  const promise = new Promise<boolean>((r) => (resolve = r));
  useUnsavedDialog.setState({ pending: { question: UNSAVED_QUESTIONS[action], promise, resolve } });
  return promise;
}

/** Answers the question shown (true: the action goes on) and hides it. */
export function answerUnsavedQuestion(goOn: boolean) {
  const shown = useUnsavedDialog.getState().pending;
  if (!shown) return;
  useUnsavedDialog.setState({ pending: null });
  shown.resolve(goOn);
}
