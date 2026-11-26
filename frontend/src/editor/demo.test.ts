import { beforeEach, describe, expect, it } from "vitest";

import { demoAnswer } from "../api/demoBackend";
import {
  analysisSources,
  parseSpiceNumber,
  toAnalysis,
  toSchematic,
  useEditorStore,
} from "../store";
import { resetEditorStore } from "../test/editorStore";
import { loadDemo } from "./demo";
import { analysisSettings, spiceNumber } from "./examples";

beforeEach(resetEditorStore);

describe("spiceNumber", () => {
  it("writes a number as typed in the toolbar, and reads back the same number", () => {
    expect(spiceNumber(0.005)).toBe("5m");
    expect(spiceNumber(1e-5)).toBe("10u");
    expect(spiceNumber(2)).toBe("2");
    expect(spiceNumber(1e5)).toBe("100k");
    expect(spiceNumber(2e6)).toBe("2Meg");
    expect(spiceNumber(0)).toBe("0");
    expect(spiceNumber(-0.5)).toBe("-500m");
    for (const t of [0.005, 1e-5, 2.5e-3, 3e-9, 1e5, 2e6, -0.5, 0]) {
      expect(parseSpiceNumber(spiceNumber(t))).toBe(t);
    }
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
      analysisSettings({
        kind: "ac",
        input_source_id: "c1",
        start_frequency: 10,
        stop_frequency: 1e5,
        points_per_decade: 20,
      }),
    ).toEqual({ kind: "ac", acSource: "c1", acStart: "10", acStop: "100k", acPoints: "20" });
    expect(analysisSettings({ kind: "dc", source_id: "c1", start: 0, stop: 1, step: 0.1 })).toEqual(
      { kind: "dc", dcSource: "c1", dcStart: "0", dcStop: "1", dcStep: "100m" },
    );
  });
});

describe("loadDemo", () => {
  it.each(["divider_op", "rc_tran", "lowpass_ac", "loaded_divider_dc"])(
    "opens %s so that Simulate gives its result again in the demo",
    (name) => {
      loadDemo(name);
      const s = useEditorStore.getState();
      expect(s.simulation).not.toBeNull();
      const analysis = toAnalysis(s.analysis, analysisSources(s.doc));
      if ("error" in analysis) throw new Error(analysis.error);
      const request = { schematic: toSchematic(s.doc), analysis: analysis.analysis };
      expect(demoAnswer("POST", "/api/simulate", request)).toEqual(s.simulation?.result);
    },
  );
});
