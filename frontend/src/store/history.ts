// Undo/redo history of the document. Pure functions: the store keeps a `History` next to the
// current document and replaces it on every change.

/** Maximum number of steps that can be undone. */
export const HISTORY_LIMIT = 100;

export interface History<T> {
  /** Previous states, oldest first. */
  past: T[];
  /** States undone, the next one to redo last. */
  future: T[];
  /**
   * Identifies the edit that made the current state (e.g. typing in one field). A new edit with
   * the same key replaces it instead of adding a step, so typing "10k" is one step, not three.
   */
  lastKey: string | null;
}

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [], lastKey: null };
}

/**
 * Records that `previous` became a new state. `key` merges consecutive edits of the same thing
 * into one step; `null` always adds a step. Any new change clears the redo list.
 */
export function record<T>(history: History<T>, previous: T, key: string | null = null): History<T> {
  if (key !== null && key === history.lastKey) return { ...history, future: [] };
  const past = [...history.past, previous];
  return { past: past.slice(-HISTORY_LIMIT), future: [], lastKey: key };
}

/** Ends the current merge: the next keyed edit adds a step even if its key is the same. */
export function seal<T>(history: History<T>): History<T> {
  return history.lastKey === null ? history : { ...history, lastKey: null };
}

/** Steps back: returns the state to restore and the new history, or null if nothing to undo. */
export function undo<T>(history: History<T>, current: T): { state: T; history: History<T> } | null {
  const state = history.past[history.past.length - 1];
  if (state === undefined) return null;
  return {
    state,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current],
      lastKey: null,
    },
  };
}

/** Steps forward again: the reverse of `undo`. */
export function redo<T>(history: History<T>, current: T): { state: T; history: History<T> } | null {
  const state = history.future[history.future.length - 1];
  if (state === undefined) return null;
  return {
    state,
    history: {
      past: [...history.past, current],
      future: history.future.slice(0, -1),
      lastKey: null,
    },
  };
}
