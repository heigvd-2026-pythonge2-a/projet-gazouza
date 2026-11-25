import { describe, expect, it } from "vitest";

import { analysisSources, DEFAULT_ANALYSIS, toAnalysis, toSchematic } from "../store";
import { fixtureDoc, fixtureNames } from "../store/testFixtures";
import { EXAMPLES, exampleContent } from "./examples";

const analyses = import.meta.glob<unknown>("../../../shared/fixtures/*/analysis.json", {
  eager: true,
  import: "default",
});

describe("examples (#226)", () => {
  it("offers reference circuits only, each once", () => {
    // Not every fixture has to be an example (a circuit made to fail, for instance).
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(fixtureNames()).toContain(name);
  });

  it.each(EXAMPLES.map((e) => e.name))(
    "opens %s as drawn, with the toolbar set to give back its analysis",
    (name) => {
      const content = exampleContent(name);
      if (!content) throw new Error(`No example ${name}`);
      expect(toSchematic(content.doc)).toEqual(toSchematic(fixtureDoc(name)));
      const settings = { ...DEFAULT_ANALYSIS, ...content.analysis };
      const analysis = toAnalysis(settings, analysisSources(content.doc));
      if ("error" in analysis) throw new Error(analysis.error);
      expect(analysis.analysis).toEqual(analyses[`../../../shared/fixtures/${name}/analysis.json`]);
    },
  );

  it("has nothing for an unknown name", () => {
    expect(exampleContent("nope")).toBeNull();
  });
});
