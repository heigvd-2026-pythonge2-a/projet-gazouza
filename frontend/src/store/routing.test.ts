import { describe, expect, it } from "vitest";

import { addComponent, emptyDoc, pinPosition, samePoint, type GridPoint } from "./document";
import { obstacles, routeAround } from "./routing";

const key = (p: GridPoint) => `${p.x},${p.y}`;

/** Every grid point of an orthogonal path, ends included. */
function pointsOf(path: readonly GridPoint[]): GridPoint[] {
  const out: GridPoint[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const n = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    for (let k = 0; k <= n; k++) {
      out.push({ x: a.x + Math.sign(b.x - a.x) * k, y: a.y + Math.sign(b.y - a.y) * k });
    }
  }
  return out;
}

describe("routeAround", () => {
  it("goes straight, or as an L, when nothing is in the way", () => {
    const doc = emptyDoc();
    expect(routeAround(doc, { x: 0, y: 0 }, { x: 5, y: 0 })).toEqual([{ x: 5, y: 0 }]);
    const l = routeAround(doc, { x: 0, y: 0 }, { x: 5, y: 3 });
    expect(l).toHaveLength(2);
    expect(l.at(-1)).toEqual({ x: 5, y: 3 });
  });

  it("goes around a component in the way, orthogonally", () => {
    const doc = addComponent(emptyDoc(), {
      type: "resistor",
      position: { x: 5, y: 0 },
      rotation: 90,
      mirror: false,
    }).doc;
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    const route = routeAround(doc, a, b);
    expect(route.at(-1)).toEqual(b);

    const path = [a, ...route];
    for (let i = 1; i < path.length; i++) {
      expect(path[i]!.x === path[i - 1]!.x || path[i]!.y === path[i - 1]!.y).toBe(true);
    }
    const blocked = obstacles(doc);
    expect(blocked.size).toBeGreaterThan(0);
    const crossed = pointsOf(path).filter((p) => blocked.has(key(p)));
    expect(crossed).toEqual([]);
  });

  it("goes straight through a pin when allowed, around it otherwise (#244)", () => {
    // A vertical resistor below the line, its top pin on it.
    const doc = addComponent(emptyDoc(), {
      type: "resistor",
      position: { x: 5, y: 2 },
      rotation: 0,
      mirror: false,
    }).doc;
    expect(pinPosition(doc.components[0]!, "1")).toEqual({ x: 5, y: 0 });
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(routeAround(doc, a, b, { throughPins: true })).toEqual([b]);
    expect(routeAround(doc, a, b)).not.toEqual([b]);
  });

  it("keeps a detour off the pins, even when the L route may cross them (#244)", () => {
    // A horizontal resistor on the line: its body is in the way, its pins too.
    const doc = addComponent(emptyDoc(), {
      type: "resistor",
      position: { x: 5, y: 0 },
      rotation: 90,
      mirror: false,
    }).doc;
    const c = doc.components[0]!;
    const pins = [pinPosition(c, "1"), pinPosition(c, "2")];
    const a = { x: 0, y: 0 };
    const route = routeAround(doc, a, { x: 10, y: 0 }, { throughPins: true });
    const crossed = pointsOf([a, ...route]).filter((p) => pins.some((q) => samePoint(p, q)));
    expect(crossed).toEqual([]);
  });

  it("caches the obstacles per document", () => {
    const doc = addComponent(emptyDoc(), {
      type: "capacitor",
      position: { x: 0, y: 0 },
      rotation: 0,
      mirror: false,
    }).doc;
    expect(obstacles(doc)).toBe(obstacles(doc));
  });
});
