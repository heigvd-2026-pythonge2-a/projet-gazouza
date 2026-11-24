// Wire routing while drawing: orthogonal paths on the grid that go around the components.

import {
  samePoint,
  toWorld,
  type EditorDoc,
  type GridPoint,
  type PlacedComponent,
} from "./document";
import { getDef, symbolBounds, type SymbolShape } from "./library";

/** Extra cost of a bend, in grid steps: a slightly longer path with fewer bends is preferred. */
const BEND_COST = 3;
/** Free space kept around the obstacles and the end points, where the route may go. */
const MARGIN = 3;
/** Above this many explored states, give up and fall back to the plain L route. */
const MAX_EXPANSIONS = 50_000;

const key = (p: GridPoint) => `${p.x},${p.y}`;

const obstacleCache = new WeakMap<EditorDoc, Set<string>>();

/**
 * Box of what a wire must go around: the symbol without its leads (the straight lines that join
 * a pin to the body). A lead only blocks the grid points on its own line, so a wire can leave a
 * pin sideways right away, even next to a wide body such as the circle of a source (#88).
 */
function bodyAndLeads(c: PlacedComponent): { body: GridPoint[]; leads: GridPoint[][] } {
  const def = getDef(c.type);
  const isPin = (x: number, y: number) => def.pins.some((pin) => pin.x === x && pin.y === y);
  const leads: GridPoint[][] = [];
  const body: SymbolShape[] = [];
  for (const shape of def.symbol) {
    const [x1, y1, x2, y2] = shape.kind === "line" ? shape.points : [];
    const isLead =
      shape.kind === "line" &&
      shape.points.length === 4 &&
      (x1 === x2 || y1 === y2) &&
      (isPin(x1 as number, y1 as number) || isPin(x2 as number, y2 as number));
    if (isLead) {
      leads.push([
        toWorld({ x: x1 as number, y: y1 as number }, c),
        toWorld({ x: x2 as number, y: y2 as number }, c),
      ]);
    } else {
      body.push(shape);
    }
  }
  if (body.length === 0) return { body: [], leads };
  const b = symbolBounds({ ...def, pins: [], symbol: body });
  return { body: [toWorld(b.min, c), toWorld(b.max, c)], leads };
}

/**
 * Grid points a wire may not go through: every point of a component's body box (borders
 * included, so a wire does not run along a symbol), and the points of its leads, pins included.
 * Cached per document.
 */
export function obstacles(doc: EditorDoc): Set<string> {
  const cached = obstacleCache.get(doc);
  if (cached) return cached;
  const blocked = new Set<string>();
  for (const c of doc.components) {
    const { body, leads } = bodyAndLeads(c);
    const [p, q] = body;
    if (p && q) {
      for (let x = Math.ceil(Math.min(p.x, q.x)); x <= Math.floor(Math.max(p.x, q.x)); x++) {
        for (let y = Math.ceil(Math.min(p.y, q.y)); y <= Math.floor(Math.max(p.y, q.y)); y++) {
          blocked.add(`${x},${y}`);
        }
      }
    }
    for (const [a, b] of leads) {
      if (!a || !b) continue;
      const dx = Math.sign(b.x - a.x);
      const dy = Math.sign(b.y - a.y);
      const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (let k = 0; k <= Math.floor(n); k++) {
        const x = a.x + dx * k;
        const y = a.y + dy * k;
        if (Number.isInteger(x) && Number.isInteger(y)) blocked.add(`${x},${y}`);
      }
    }
    // Pins are always obstacles, whatever the symbol looks like.
    for (const pin of getDef(c.type).pins) blocked.add(key(toWorld(pin, c)));
  }
  obstacleCache.set(doc, blocked);
  return blocked;
}

/** The two L routes from `a` to `b` (horizontal first, then vertical first), points after `a`. */
function lRoutes(a: GridPoint, b: GridPoint): GridPoint[][] {
  if (a.x === b.x || a.y === b.y) return [[b]];
  return [
    [{ x: b.x, y: a.y }, b],
    [{ x: a.x, y: b.y }, b],
  ];
}

/** True if the orthogonal polyline `from` → `points` only crosses free grid points. */
function isFree(from: GridPoint, points: readonly GridPoint[], free: (p: GridPoint) => boolean) {
  let cur = from;
  for (const next of points) {
    const dx = Math.sign(next.x - cur.x);
    const dy = Math.sign(next.y - cur.y);
    let p = cur;
    while (!samePoint(p, next)) {
      p = { x: p.x + dx, y: p.y + dy };
      if (!free(p)) return false;
    }
    cur = next;
  }
  return true;
}

const DIRS: readonly GridPoint[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** Min-heap of [cost, value] pairs. */
class Heap<T> {
  private items: [number, T][] = [];
  get size() {
    return this.items.length;
  }
  push(cost: number, value: T) {
    const a = this.items;
    a.push([cost, value]);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((a[parent] as [number, T])[0] <= cost) break;
      [a[i], a[parent]] = [a[parent] as [number, T], a[i] as [number, T]];
      i = parent;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (top === undefined || last === undefined) return undefined;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && (a[l] as [number, T])[0] < (a[m] as [number, T])[0]) m = l;
        if (r < a.length && (a[r] as [number, T])[0] < (a[m] as [number, T])[0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m] as [number, T], a[i] as [number, T]];
        i = m;
      }
    }
    return top[1];
  }
}

interface State {
  p: GridPoint;
  /** Index in DIRS of the last step, -1 at the start. */
  dir: number;
  cost: number;
  prev: State | null;
}

/** Keeps only the corners of a grid path (and its last point). */
function corners(path: readonly GridPoint[]): GridPoint[] {
  const out: GridPoint[] = [];
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1] as GridPoint;
    const p = path[i] as GridPoint;
    const next = path[i + 1];
    const straight = next && next.x - p.x === p.x - prev.x && next.y - p.y === p.y - prev.y;
    if (!straight) out.push(p);
  }
  return out;
}

/** Shortest path from `a` to `b` on free grid points, bends counted as `BEND_COST` steps. */
function search(
  a: GridPoint,
  b: GridPoint,
  free: (p: GridPoint) => boolean,
  area: { min: GridPoint; max: GridPoint },
): GridPoint[] | null {
  const heuristic = (p: GridPoint) => Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
  const best = new Map<string, number>();
  const heap = new Heap<State>();
  heap.push(heuristic(a), { p: a, dir: -1, cost: 0, prev: null });
  let expansions = 0;
  while (heap.size > 0 && expansions++ < MAX_EXPANSIONS) {
    const s = heap.pop() as State;
    if (samePoint(s.p, b)) {
      const path: GridPoint[] = [];
      for (let t: State | null = s; t; t = t.prev) path.push(t.p);
      return corners(path.reverse());
    }
    const stateKey = `${key(s.p)},${s.dir}`;
    if ((best.get(stateKey) ?? Infinity) < s.cost) continue;
    DIRS.forEach((d, dir) => {
      const p = { x: s.p.x + d.x, y: s.p.y + d.y };
      if (p.x < area.min.x || p.x > area.max.x || p.y < area.min.y || p.y > area.max.y) return;
      if (!free(p)) return;
      const cost = s.cost + 1 + (s.dir !== -1 && s.dir !== dir ? BEND_COST : 0);
      const k = `${key(p)},${dir}`;
      if ((best.get(k) ?? Infinity) <= cost) return;
      best.set(k, cost);
      heap.push(cost + heuristic(p), { p, dir, cost, prev: s });
    });
  }
  return null;
}

/**
 * Route from `a` to `b` while drawing a wire: orthogonal, on the grid, around the components
 * (`a` and `b` themselves may be pins). The plain L route (horizontal then vertical) is kept when
 * it is free; otherwise the shortest route with few bends; if there is none, the plain L route
 * anyway, so the user is never blocked. Returns the points after `a` (the corners, then `b`).
 */
export function routeAround(doc: EditorDoc, a: GridPoint, b: GridPoint): GridPoint[] {
  const routes = lRoutes(a, b);
  const plain = routes[0] as GridPoint[];
  if (samePoint(a, b)) return [b];
  const blocked = obstacles(doc);
  const free = (p: GridPoint) => samePoint(p, a) || samePoint(p, b) || !blocked.has(key(p));
  const freeRoute = routes.find((r) => isFree(a, r, free));
  if (freeRoute) return freeRoute;

  // Search area: the end points and every obstacle, with some room around them.
  const xs = [a.x, b.x];
  const ys = [a.y, b.y];
  for (const k of blocked) {
    const [x, y] = k.split(",").map(Number);
    xs.push(x as number);
    ys.push(y as number);
  }
  const area = {
    min: { x: Math.min(...xs) - MARGIN, y: Math.min(...ys) - MARGIN },
    max: { x: Math.max(...xs) + MARGIN, y: Math.max(...ys) + MARGIN },
  };
  return search(a, b, free, area) ?? plain;
}

/** True if the orthogonal `path` goes through an obstacle, its two ends excepted. */
export function pathBlocked(doc: EditorDoc, path: readonly GridPoint[]): boolean {
  const a = path[0];
  const b = path[path.length - 1];
  if (!a || !b) return false;
  const blocked = obstacles(doc);
  const free = (p: GridPoint) => samePoint(p, a) || samePoint(p, b) || !blocked.has(key(p));
  return !isFree(a, path.slice(1), free);
}

/**
 * Full path (ends included) of a wire from `a` to `b` around the components, or null if there is
 * no free one. A wire end on a pin first leaves it outwards (`aOut`, `bOut`: one grid step away
 * from the component), as a wire drawn by hand would.
 */
export function routeBetween(
  doc: EditorDoc,
  a: GridPoint,
  b: GridPoint,
  aOut: GridPoint | null,
  bOut: GridPoint | null,
): GridPoint[] | null {
  const blocked = obstacles(doc);
  const stub = (p: GridPoint, out: GridPoint | null) => {
    const q = out ? { x: p.x + out.x, y: p.y + out.y } : p;
    return blocked.has(key(q)) ? p : q;
  };
  const a2 = stub(a, aOut);
  const b2 = stub(b, bOut);
  // Repeated points (no stub, or a stub at the other end) are removed by the caller.
  const path = [a, a2, ...routeAround(doc, a2, b2), b];
  return pathBlocked(doc, path) ? null : path;
}
