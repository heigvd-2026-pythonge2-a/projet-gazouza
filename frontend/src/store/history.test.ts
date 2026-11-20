import { describe, expect, it } from "vitest";

import { HISTORY_LIMIT, emptyHistory, record, redo, seal, undo } from "./history";

describe("history", () => {
  it("undoes and redoes in order", () => {
    let h = emptyHistory<number>();
    h = record(h, 0); // 0 -> 1
    h = record(h, 1); // 1 -> 2

    const u1 = undo(h, 2);
    expect(u1?.state).toBe(1);
    const u2 = undo(u1!.history, 1);
    expect(u2?.state).toBe(0);
    expect(undo(u2!.history, 0)).toBeNull();

    const r1 = redo(u2!.history, 0);
    expect(r1?.state).toBe(1);
    const r2 = redo(r1!.history, 1);
    expect(r2?.state).toBe(2);
    expect(redo(r2!.history, 2)).toBeNull();
  });

  it("clears the redo list on a new change", () => {
    let h = record(emptyHistory<number>(), 0);
    h = undo(h, 1)!.history;
    expect(h.future).toEqual([1]);
    h = record(h, 0);
    expect(h.future).toEqual([]);
  });

  it("merges consecutive edits with the same key into one step", () => {
    let h = emptyHistory<string>();
    h = record(h, "", "param:c1:resistance"); // "" -> "1"
    h = record(h, "1", "param:c1:resistance"); // "1" -> "10"
    h = record(h, "10", "param:c1:resistance"); // "10" -> "10k"
    expect(h.past).toEqual([""]);
    expect(undo(h, "10k")?.state).toBe("");
  });

  it("adds a step for another key, or after seal", () => {
    let h = record(emptyHistory<string>(), "a", "name:c1");
    h = record(h, "b", "name:c2");
    expect(h.past).toEqual(["a", "b"]);
    h = record(seal(h), "c", "name:c2");
    expect(h.past).toEqual(["a", "b", "c"]);
  });

  it("never merges unkeyed changes", () => {
    let h = record(emptyHistory<number>(), 0);
    h = record(h, 1);
    expect(h.past).toEqual([0, 1]);
  });

  it(`keeps at most ${HISTORY_LIMIT} steps, dropping the oldest`, () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) h = record(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(10);
  });
});
