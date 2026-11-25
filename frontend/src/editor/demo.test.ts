import { beforeEach, describe, expect, it } from "vitest";

import { demoAnswer } from "../api/demoBackend";
import { parseSpiceNumber, toAnalysis, toSchematic, useEditorStore } from "../store";
import { resetEditorStore } from "../test/editorStore";
import { analysisSettings, loadDemo, spiceTime } from "./demo";

beforeEach(resetEditorStore);

describe("spiceTime", () => {
  it("writes a time as typed in the toolbar, and reads back the same number", () => {
    expect(spiceTime(0.005)).toBe("5m");
    expect(spiceTime(1e-5)).toBe("10u");
    expect(spiceTime(2)).toBe("2");
    for (const t of [0.005, 1e-5, 2.5e-3, 3e-9]) expect(parseSpiceNumber(spiceTime(t))).toBe(t);
  });
});

describe("analysisSettings", () => {
  it("gives the toolbar settings of the analyses it offers", () => {
    expect(analysisSettings({ kind: "op" })).toEqual({ kind: "op" });
    expect(analysisSettings({ kind: "tran", stop_time: 0.005 })).toEqual({
      kind: "tran",
      stopTime: "5m",
      maxStep: "",
    });
    expect(
      analysisSettings({ kind: "dc", source_id: "c1", start: 0, stop: 1, step: 0.1 }),
    ).toBeNull();
  });
});

describe("loadDemo", () => {
  it.each(["divider_op", "rc_tran"])(
    "opens %s so that Simulate gives its result again in the demo",
    (name) => {
      loadDemo(name);
      const s = useEditorStore.getState();
      expect(s.simulation).not.toBeNull();
      const analysis = toAnalysis(s.analysis);
      if ("error" in analysis) throw new Error(analysis.error);
      const request = { schematic: toSchematic(s.doc), analysis: analysis.analysis };
      expect(demoAnswer("POST", "/api/simulate", request)).toEqual(s.simulation?.result);
    },
  );
});
