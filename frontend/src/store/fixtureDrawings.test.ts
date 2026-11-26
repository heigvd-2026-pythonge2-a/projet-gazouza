// The reference circuits of shared/fixtures/ are opened as they are by the editor (`?demo=` in
// development and in the online demo of the website): their drawing must follow the editor's
// rules, like a schematic drawn by hand.
import { describe, expect, it } from "vitest";

import {
  componentBox,
  componentsOverlap,
  pinPosition,
  samePoint,
  wirePath,
  type GridPoint,
} from "./document";
import { getDef } from "./library";
import { fixtureDoc, fixtureNames } from "./testFixtures";

/** Problems of the drawing of fixture `name`, in words (empty when it is clean). */
function drawingProblems(name: string): string[] {
  const doc = fixtureDoc(name);
  const problems: string[] = [];
  const label = (id: string) => doc.components.find((c) => c.id === id)?.name ?? id;

  const points: { p: GridPoint; what: string }[] = [
    ...doc.components.flatMap((c) =>
      getDef(c.type).pins.map((pin) => ({
        p: pinPosition(c, pin.name),
        what: `pin ${label(c.id)}.${pin.name}`,
      })),
    ),
    ...doc.junctions.map((j) => ({ p: j.position, what: `junction ${j.id}` })),
  ];

  for (const w of doc.wires) {
    const path = wirePath(doc, w);
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i] as GridPoint;
      const b = path[i + 1] as GridPoint;
      const where = `${w.id} (${a.x},${a.y})-(${b.x},${b.y})`;
      if (a.x !== b.x && a.y !== b.y) problems.push(`${where} is not horizontal or vertical`);
      // Through a symbol: the open segment crosses the inside of a component's box.
      for (const c of doc.components) {
        const box = componentBox(c);
        const [lo, hi] = [
          { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
          { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
        ];
        const across = (l: number, h: number, min: number, max: number) =>
          l === h ? min < l && l < max : Math.min(h, max) - Math.max(l, min) > 0;
        if (across(lo.x, hi.x, box.min.x, box.max.x) && across(lo.y, hi.y, box.min.y, box.max.y)) {
          problems.push(`${where} goes through ${label(c.id)}`);
        }
      }
      // Over a pin or a junction it does not end at: it would look connected there.
      for (const { p, what } of points) {
        const inside =
          !samePoint(p, a) &&
          !samePoint(p, b) &&
          (a.x === b.x
            ? p.x === a.x && Math.min(a.y, b.y) < p.y && p.y < Math.max(a.y, b.y)
            : p.y === a.y && Math.min(a.x, b.x) < p.x && p.x < Math.max(a.x, b.x));
        if (inside) problems.push(`${where} passes over ${what}`);
      }
    }
  }

  doc.components.forEach((c, i) => {
    for (const other of doc.components.slice(i + 1)) {
      if (componentsOverlap(c, other)) problems.push(`${label(c.id)} overlaps ${label(other.id)}`);
    }
  });
  return problems;
}

describe("drawings of the reference circuits", () => {
  it.each(fixtureNames())("%s is drawn like a clean schematic", (name) => {
    expect(drawingProblems(name)).toEqual([]);
  });
});
