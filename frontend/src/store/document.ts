// Editor-internal document model and pure operations on it (doc -> new doc).
//
// These are NOT the API contract types: they follow what was agreed on PR #2 (explicit wires,
// junctions, free wire ends as {x, y}) so the editor can move forward before the contract PR
// lands. Once it does, a single `toSchematic()` serializer typed against `src/api/client.ts`
// will convert this model to the contract format.
//
// Every operation returns a new document and never mutates its input, so undo/redo can later
// be implemented by keeping snapshots.

import { getDef, symbolBounds } from "./library";

export interface GridPoint {
  x: number;
  y: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface PlacedComponent {
  id: string;
  type: string;
  /** SPICE name (e.g. "R1"). Absent for ground and label. */
  name?: string;
  position: GridPoint;
  rotation: Rotation;
  mirror: boolean;
  params: Record<string, string>;
}

export type WireEnd = { comp: string; pin: string } | { junction: string } | GridPoint;

export interface EditorWire {
  id: string;
  from: WireEnd;
  to: WireEnd;
  /** Bend points only; the end positions come from the pins/junctions they are attached to. */
  points: GridPoint[];
}

export interface EditorJunction {
  id: string;
  position: GridPoint;
}

export interface EditorDoc {
  components: PlacedComponent[];
  wires: EditorWire[];
  junctions: EditorJunction[];
}

export const emptyDoc = (): EditorDoc => ({ components: [], wires: [], junctions: [] });

// --- Geometry -------------------------------------------------------------------------------

/**
 * Local symbol coordinates -> grid coordinates.
 * Convention (same as Konva): mirror (x -> -x) first, then clockwise rotation, then translate.
 */
export function toWorld(
  local: GridPoint,
  c: Pick<PlacedComponent, "position" | "rotation" | "mirror">,
): GridPoint {
  const x = c.mirror ? -local.x : local.x;
  const y = local.y;
  let r: GridPoint;
  switch (c.rotation) {
    case 0:
      r = { x, y };
      break;
    case 90:
      r = { x: -y, y: x };
      break;
    case 180:
      r = { x: -x, y: -y };
      break;
    case 270:
      r = { x: y, y: -x };
      break;
  }
  // `+ 0` turns -0 into 0, which keeps positions clean when compared or serialized.
  return { x: r.x + c.position.x + 0, y: r.y + c.position.y + 0 };
}

export function pinPosition(c: PlacedComponent, pinName: string): GridPoint {
  const pin = getDef(c.type).pins.find((p) => p.name === pinName);
  if (!pin) throw new Error(`${c.name ?? c.id} has no pin ${pinName}`);
  return toWorld(pin, c);
}

export const samePoint = (a: GridPoint, b: GridPoint): boolean => a.x === b.x && a.y === b.y;

/** True if `p` lies on the segment [a, b], ends included. Exact on integer coordinates. */
export function onSegment(p: GridPoint, a: GridPoint, b: GridPoint): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return (
    cross === 0 &&
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

/**
 * Removes repeated points and bends on the straight line through their neighbours: aligned bends,
 * and U-turns where the wire goes back along itself (a dead end that connects nothing).
 */
export function simplifyPath(path: readonly GridPoint[]): GridPoint[] {
  const out: GridPoint[] = [];
  for (const p of path) {
    let last = out[out.length - 1];
    if (last && samePoint(last, p)) continue;
    let prev = out[out.length - 2];
    while (prev && last && collinear(prev, last, p)) {
      out.pop();
      last = prev;
      prev = out[out.length - 2];
    }
    if (last && samePoint(last, p)) continue;
    out.push({ ...p });
  }
  return out;
}

const collinear = (a: GridPoint, b: GridPoint, c: GridPoint): boolean =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) === 0;

/** Grid position of a wire end. */
export function endPosition(doc: EditorDoc, end: WireEnd): GridPoint {
  if ("comp" in end) {
    const c = doc.components.find((comp) => comp.id === end.comp);
    if (!c) throw new Error(`Unknown component ${end.comp}`);
    return pinPosition(c, end.pin);
  }
  if ("junction" in end) {
    const j = doc.junctions.find((junction) => junction.id === end.junction);
    if (!j) throw new Error(`Unknown junction ${end.junction}`);
    return j.position;
  }
  return end;
}

/** Full polyline of a wire: its two ends and the bends in between. */
export function wirePath(doc: EditorDoc, w: EditorWire): GridPoint[] {
  return [endPosition(doc, w.from), ...w.points, endPosition(doc, w.to)];
}

/** Something a wire end can be attached to, found at a grid point. */
export type Anchor =
  | { kind: "pin"; comp: string; pin: string }
  | { kind: "junction"; junction: string }
  | { kind: "freeEnd" }
  | { kind: "wire"; wire: string };

/**
 * What a wire end dropped at `p` would attach to. Pins win over junctions, which win over wires,
 * so a wire is never split at one of its own attached ends.
 */
export function anchorAt(doc: EditorDoc, p: GridPoint): Anchor | null {
  for (const c of doc.components) {
    for (const pin of getDef(c.type).pins) {
      if (samePoint(toWorld(pin, c), p)) return { kind: "pin", comp: c.id, pin: pin.name };
    }
  }
  const junction = doc.junctions.find((j) => samePoint(j.position, p));
  if (junction) return { kind: "junction", junction: junction.id };
  const isFreeEndAtP = (end: WireEnd) =>
    !("comp" in end) && !("junction" in end) && samePoint(end, p);
  if (doc.wires.some((w) => isFreeEndAtP(w.from) || isFreeEndAtP(w.to))) return { kind: "freeEnd" };
  for (const w of doc.wires) {
    const path = wirePath(doc, w);
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (a && b && onSegment(p, a, b)) return { kind: "wire", wire: w.id };
    }
  }
  return null;
}

/** Axis-aligned rectangle in grid units (not necessarily on grid points). */
/** A component pin that nothing is connected to, with its grid position. */
export interface UnconnectedPin {
  comp: string;
  pin: string;
  position: GridPoint;
}

/**
 * Pins connected to nothing: no wire ends on them and no other component has a pin at the same
 * point. A wire merely passing over a pin does not connect it (wires only connect at their ends),
 * and a node label counts like any other component: its net name connects nothing by itself.
 */
export function unconnectedPins(doc: EditorDoc): UnconnectedPin[] {
  const wired = new Set<string>();
  for (const w of doc.wires) {
    for (const end of [w.from, w.to]) if ("comp" in end) wired.add(`${end.comp}/${end.pin}`);
  }
  const pins = doc.components.flatMap((c) =>
    getDef(c.type).pins.map((pin) => ({ comp: c.id, pin: pin.name, position: toWorld(pin, c) })),
  );
  const pinsAt = new Map<string, number>();
  for (const p of pins) {
    const key = `${p.position.x},${p.position.y}`;
    pinsAt.set(key, (pinsAt.get(key) ?? 0) + 1);
  }
  return pins.filter(
    (p) =>
      !wired.has(`${p.comp}/${p.pin}`) && (pinsAt.get(`${p.position.x},${p.position.y}`) ?? 0) < 2,
  );
}

export interface GridRect {
  min: GridPoint;
  max: GridPoint;
}

/** Rectangle with corners `a` and `b`, in any order. */
export const rectFrom = (a: GridPoint, b: GridPoint): GridRect => ({
  min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
  max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
});

const inRect = (p: GridPoint, r: GridRect): boolean =>
  r.min.x <= p.x && p.x <= r.max.x && r.min.y <= p.y && p.y <= r.max.y;

/**
 * Ids of what lies entirely inside `r`: components whose symbol box does, wires whose points all
 * do, and junctions. Used by the selection rectangle.
 */
export function itemsInRect(doc: EditorDoc, r: GridRect): string[] {
  const components = doc.components.filter((c) => {
    const { min, max } = symbolBounds(getDef(c.type));
    const corners = [min, max, { x: min.x, y: max.y }, { x: max.x, y: min.y }];
    return corners.every((p) => inRect(toWorld(p, c), r));
  });
  const wires = doc.wires.filter((w) => wirePath(doc, w).every((p) => inRect(p, r)));
  const junctions = doc.junctions.filter((j) => inRect(j.position, r));
  return [...components, ...wires, ...junctions].map((item) => item.id);
}

/** Box of the symbol of `c` on the grid, turned and mirrored like the component. */
export function componentBounds(c: PlacedComponent): GridRect {
  const { min, max } = symbolBounds(getDef(c.type));
  const a = toWorld(min, c);
  const b = toWorld(max, c);
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
  };
}

/**
 * Smallest rectangle holding the whole circuit: symbol boxes of the components, wires and
 * junctions. Null for an empty document.
 */
export function docBounds(doc: EditorDoc): GridRect | null {
  const points: GridPoint[] = [
    ...doc.components.flatMap((c) => {
      const { min, max } = symbolBounds(getDef(c.type));
      return [min, max, { x: min.x, y: max.y }, { x: max.x, y: min.y }].map((p) => toWorld(p, c));
    }),
    ...doc.wires.flatMap((w) => wirePath(doc, w)),
    ...doc.junctions.map((j) => j.position),
  ];
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    min: { x: Math.min(...xs), y: Math.min(...ys) },
    max: { x: Math.max(...xs), y: Math.max(...ys) },
  };
}

// --- Ids and names --------------------------------------------------------------------------

/** Next value of the form `${prefix}${n}`, one above the highest existing n (case-insensitive). */
export function nextIndexed(prefix: string, existing: Iterable<string>): string {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`, "i");
  let max = 0;
  for (const value of existing) {
    const m = re.exec(value);
    if (m?.[1]) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

const allIds = (doc: EditorDoc): string[] => [
  ...doc.components.map((c) => c.id),
  ...doc.wires.map((w) => w.id),
  ...doc.junctions.map((j) => j.id),
];

// --- Operations -----------------------------------------------------------------------------

export interface Placement {
  type: string;
  position: GridPoint;
  rotation: Rotation;
  mirror: boolean;
}

/** Adds a component with default parameters; returns the new doc and the new component id. */
export function addComponent(doc: EditorDoc, p: Placement): { doc: EditorDoc; id: string } {
  const def = getDef(p.type);
  const id = nextIndexed("c", allIds(doc));
  const names = doc.components.flatMap((c) => (c.name ? [c.name] : []));
  const params = Object.fromEntries(def.params.map((param) => [param.name, param.default]));
  const component: PlacedComponent = { id, params, ...p, position: { ...p.position } };
  if (def.prefix !== null) component.name = nextIndexed(def.prefix, names);
  return { doc: { ...doc, components: [...doc.components, component] }, id };
}

function updateComponents(
  doc: EditorDoc,
  ids: ReadonlySet<string>,
  update: (c: PlacedComponent) => PlacedComponent,
): EditorDoc {
  return {
    ...doc,
    components: doc.components.map((c) => (ids.has(c.id) ? update(c) : c)),
  };
}

// --- Keeping wires orthogonal -----------------------------------------------------------------

const isDiagonal = (a: GridPoint, b: GridPoint): boolean => a.x !== b.x && a.y !== b.y;

/**
 * Moves the bend next to a wire end that went from `oldEnd` to `newEnd`, so the segment between
 * them keeps its direction: a horizontal segment keeps the end's y, a vertical one its x. The
 * direction is read on `original` (the bend before any change), the result built from `bend`.
 */
function followEnd(
  bend: GridPoint,
  original: GridPoint,
  oldEnd: GridPoint,
  newEnd: GridPoint,
): GridPoint {
  if (original.y === oldEnd.y && original.x !== oldEnd.x) return { x: bend.x, y: newEnd.y };
  if (original.x === oldEnd.x && original.y !== oldEnd.y) return { x: newEnd.x, y: bend.y };
  return bend;
}

/** Adds a corner (horizontal then vertical) inside every diagonal segment of `path`. */
function squarePath(path: readonly GridPoint[]): GridPoint[] {
  const out: GridPoint[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (last && isDiagonal(last, p)) out.push({ x: p.x, y: last.y });
    out.push({ ...p });
  }
  return out;
}

/**
 * New bends of a wire whose ends moved from `a0`/`b0` to `a1`/`b1`, so that no segment becomes
 * diagonal. Both ends moved by the same amount: the whole wire is translated. Otherwise the
 * bends next to a moved end follow it, a corner is added where that is not enough, and bends left
 * useless (repeated or aligned) are removed.
 */
export function realignedBends(
  bends: readonly GridPoint[],
  a0: GridPoint,
  b0: GridPoint,
  a1: GridPoint,
  b1: GridPoint,
): GridPoint[] {
  const da = { x: a1.x - a0.x, y: a1.y - a0.y };
  const db = { x: b1.x - b0.x, y: b1.y - b0.y };
  if (da.x === db.x && da.y === db.y) return bends.map((p) => ({ x: p.x + da.x, y: p.y + da.y }));

  // Work on the simplified path, so consecutive segments always alternate direction.
  // A single bend follows the start for one coordinate and the end for the other.
  const original = simplifyPath([a0, ...bends, b0]).slice(1, -1);
  const inner = original.map((p) => ({ ...p }));
  const n = inner.length;
  const first = original[0];
  const last = original[n - 1];
  if (first && !samePoint(a0, a1)) inner[0] = followEnd(inner[0] ?? first, first, a0, a1);
  if (last && !samePoint(b0, b1)) inner[n - 1] = followEnd(inner[n - 1] ?? last, last, b0, b1);
  return simplifyPath(squarePath([a1, ...inner, b1])).slice(1, -1);
}

/**
 * Re-aligns the wires whose ends moved between `before` and `after` (a component was moved,
 * rotated or mirrored), so that every wire stays horizontal / vertical. Other wires are kept as is.
 */
export function realignWires(before: EditorDoc, after: EditorDoc): EditorDoc {
  let changed = false;
  const wires = after.wires.map((w) => {
    const a0 = endPosition(before, w.from);
    const b0 = endPosition(before, w.to);
    const a1 = endPosition(after, w.from);
    const b1 = endPosition(after, w.to);
    if (samePoint(a0, a1) && samePoint(b0, b1)) return w;
    changed = true;
    return { ...w, points: realignedBends(w.points, a0, b0, a1, b1) };
  });
  return changed ? { ...after, wires } : after;
}

// --- Editing part of a wire ---------------------------------------------------------------------

/**
 * A bend or a straight segment of a wire, as indexes in its simplified path (`partPath`): bend
 * `index` is the point `path[index]` (never an end), segment `index` goes from `path[index]` to
 * `path[index + 1]`.
 */
export interface WirePart {
  wire: string;
  kind: "bend" | "segment";
  index: number;
}

/** Distance (grid units) under which a press on a wire picks a bend rather than a segment. */
export const BEND_PICK_RADIUS = 0.4;

/** Path of a wire without repeated or aligned points: the one wire parts index into. */
export function partPath(doc: EditorDoc, w: EditorWire): GridPoint[] {
  return simplifyPath(wirePath(doc, w));
}

function distanceToSegment(p: GridPoint, a: GridPoint, b: GridPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The bend or segment of wire `wireId` closest to `p` (grid units, not rounded). */
export function wirePartAt(doc: EditorDoc, wireId: string, p: GridPoint): WirePart | null {
  const w = doc.wires.find((wire) => wire.id === wireId);
  if (!w) return null;
  const path = partPath(doc, w);
  for (let i = 1; i + 1 < path.length; i++) {
    const bend = path[i] as GridPoint;
    if (Math.hypot(p.x - bend.x, p.y - bend.y) <= BEND_PICK_RADIUS) {
      return { wire: wireId, kind: "bend", index: i };
    }
  }
  let best: WirePart | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const d = distanceToSegment(p, path[i] as GridPoint, path[i + 1] as GridPoint);
    if (d < bestDistance) {
      bestDistance = d;
      best = { wire: wireId, kind: "segment", index: i };
    }
  }
  return best;
}

/** Points of a wire part (one for a bend, two for a segment), or null if it no longer exists. */
export function wirePartPoints(doc: EditorDoc, part: WirePart): GridPoint[] | null {
  const w = doc.wires.find((wire) => wire.id === part.wire);
  if (!w) return null;
  const path = partPath(doc, w);
  const last = path.length - 1;
  if (part.kind === "bend") {
    const p = path[part.index];
    return p && part.index > 0 && part.index < last ? [p] : null;
  }
  const a = path[part.index];
  const b = path[part.index + 1];
  return a && b ? [a, b] : null;
}

function withPath(doc: EditorDoc, wireId: string, path: readonly GridPoint[]): EditorDoc {
  const points = simplifyPath(squarePath(path)).slice(1, -1);
  const w = doc.wires.find((wire) => wire.id === wireId);
  const same =
    w?.points.length === points.length && w.points.every((p, i) => samePoint(p, points[i] ?? p));
  if (same) return doc;
  return {
    ...doc,
    wires: doc.wires.map((w) => (w.id === wireId ? { ...w, points } : w)),
  };
}

/**
 * Moves a wire part so it goes through `target` (grid units), keeping the wire orthogonal and its
 * ends where they are. A bend moves to `target` and its neighbouring bends follow; a segment only
 * moves across its direction (a horizontal one up or down). Where the neighbour is a wire end,
 * which cannot move, a corner is added. Useless bends are removed afterwards.
 */
export function moveWirePart(doc: EditorDoc, part: WirePart, target: GridPoint): EditorDoc {
  const w = doc.wires.find((wire) => wire.id === part.wire);
  if (!w || !wirePartPoints(doc, part)) return doc;
  const path = partPath(doc, w).map((p) => ({ ...p }));
  const last = path.length - 1;
  const isEnd = (i: number) => i === 0 || i === last;

  if (part.kind === "bend") {
    const i = part.index;
    const old = path[i] as GridPoint;
    for (const j of [i - 1, i + 1]) {
      const n = path[j] as GridPoint;
      if (isEnd(j)) continue;
      if (n.y === old.y) n.y = target.y;
      else n.x = target.x;
    }
    // A wire end cannot follow: add a corner between it and the bend, turning so the wire
    // crosses the bend at a right angle instead of folding back on itself.
    const prev = path[i - 1] as GridPoint;
    const next = path[i + 1] as GridPoint;
    let before = [prev];
    if (isDiagonal(prev, target)) {
      // Leaving horizontally: arrive vertically, and the other way round.
      const nextHorizontal = next.y === target.y && next.x !== target.x;
      before = [prev, nextHorizontal ? { x: target.x, y: prev.y } : { x: prev.x, y: target.y }];
    }
    let after = [next];
    if (isDiagonal(target, next)) {
      const arrival = before[before.length - 1] as GridPoint;
      const arrivesHorizontal = arrival.y === target.y;
      after = [arrivesHorizontal ? { x: target.x, y: next.y } : { x: next.x, y: target.y }, next];
    }
    return withPath(doc, w.id, [
      ...path.slice(0, i - 1),
      ...before,
      { ...target },
      ...after,
      ...path.slice(i + 2),
    ]);
  }

  const a = path[part.index] as GridPoint;
  const b = path[part.index + 1] as GridPoint;
  const horizontal = a.y === b.y;
  const moved = (p: GridPoint): GridPoint =>
    horizontal ? { x: p.x, y: target.y } : { x: target.x, y: p.y };
  // A segment end that is a wire end stays and gets a new bend next to it instead.
  const before = path.slice(0, part.index);
  const after = path.slice(part.index + 2);
  const start = isEnd(part.index) ? [a, moved(a)] : [moved(a)];
  const end = isEnd(part.index + 1) ? [moved(b), b] : [moved(b)];
  return withPath(doc, w.id, [...before, ...start, ...end, ...after]);
}

/**
 * Removes one segment of a wire: the wire is cut in two around it, each remaining piece keeping
 * its attached end and getting a free end where the segment was. A piece reduced to a single
 * point disappears, so removing the only segment removes the whole wire. Junctions left with
 * fewer than three wires are cleaned up (see `cleanJunctions`).
 */
export function deleteSegment(doc: EditorDoc, part: WirePart): EditorDoc {
  const w = doc.wires.find((wire) => wire.id === part.wire);
  if (!w || part.kind !== "segment" || !wirePartPoints(doc, part)) return doc;
  const path = partPath(doc, w);
  const i = part.index;
  const a = path[i] as GridPoint;
  const b = path[i + 1] as GridPoint;
  const pieces: EditorWire[] = [];
  // Before the segment: from the original start to a free end at `a`.
  if (i > 0) pieces.push({ ...w, to: { ...a }, points: path.slice(1, i).map((p) => ({ ...p })) });
  // After it: from a free end at `b` to the original end (a new id if the first piece kept it).
  if (i + 1 < path.length - 1) {
    const id = pieces.length > 0 ? nextIndexed("w", allIds(doc)) : w.id;
    const points = path.slice(i + 2, -1).map((p) => ({ ...p }));
    pieces.push({ ...w, id, from: { ...b }, points });
  }
  const cut = {
    ...doc,
    wires: doc.wires.flatMap((wire) => (wire.id === w.id ? pieces : [wire])),
  };
  return cleanJunctions(cut, junctionsOf([w]));
}

/** Ids of the junctions the ends of these wires are attached to. */
function junctionsOf(wires: readonly EditorWire[]): Set<string> {
  const ids = new Set<string>();
  for (const w of wires) {
    for (const end of [w.from, w.to]) if ("junction" in end) ids.add(end.junction);
  }
  return ids;
}

/** `w` turned around: from its `to` end to its `from` end. */
const reversed = (w: EditorWire): EditorWire => ({
  ...w,
  from: w.to,
  to: w.from,
  points: [...w.points].reverse(),
});

/**
 * Removes the junctions (among `ids`) that no longer join three wires, so no dot is left where
 * nothing meets any more. A junction with one wire end (or none) goes, and that end becomes a
 * free end in the same place. A junction between exactly two wires goes too: both wires are
 * merged into one going through its position (the first one keeps its id). A merge that would
 * give a wire looping back to where it starts is not done, and the junction is kept.
 */
export function cleanJunctions(doc: EditorDoc, ids: ReadonlySet<string>): EditorDoc {
  let out = doc;
  for (const id of ids) {
    const junction = out.junctions.find((j) => j.id === id);
    if (!junction) continue;
    const onJunction = (end: WireEnd) => "junction" in end && end.junction === id;
    const attached = out.wires.filter((w) => onJunction(w.from) || onJunction(w.to));
    const ends = attached.reduce(
      (n, w) => n + (onJunction(w.from) ? 1 : 0) + (onJunction(w.to) ? 1 : 0),
      0,
    );
    if (ends >= 3) continue;
    const position = junction.position;
    const without = out.junctions.filter((j) => j.id !== id);

    if (ends === 2 && attached.length === 2) {
      const [first, second] = attached as [EditorWire, EditorWire];
      // Orient them first -> junction -> second.
      const a = onJunction(first.to) ? first : reversed(first);
      const b = onJunction(second.from) ? second : reversed(second);
      if (sameEnd(a.from, b.to)) continue;
      const points = simplifyPath([
        endPosition(out, a.from),
        ...a.points,
        position,
        ...b.points,
        endPosition(out, b.to),
      ]).slice(1, -1);
      const merged: EditorWire = { id: first.id, from: a.from, to: b.to, points };
      out = {
        ...out,
        junctions: without,
        wires: out.wires.flatMap((w) =>
          w.id === first.id ? [merged] : w.id === second.id ? [] : [w],
        ),
      };
      continue;
    }
    // A wire with both ends on the junction (a loop) is left as it is.
    if (ends === 2) continue;
    const free = (end: WireEnd): WireEnd => (onJunction(end) ? { ...position } : end);
    out = {
      ...out,
      junctions: without,
      wires: out.wires.map((w) =>
        attached.includes(w) ? { ...w, from: free(w.from), to: free(w.to) } : w,
      ),
    };
  }
  return out;
}

const shift = (p: GridPoint, d: GridPoint): GridPoint => ({ x: p.x + d.x, y: p.y + d.y });

/**
 * Moves components, junctions and wires (by id) by `delta`, in grid units. A moved wire takes
 * its bends and free ends along. Wires attached to moved items on both sides are translated
 * whole; the others are re-aligned (see `realignedBends`) so they stay connected and orthogonal.
 */
export function moveItems(doc: EditorDoc, ids: ReadonlySet<string>, delta: GridPoint): EditorDoc {
  if ((delta.x === 0 && delta.y === 0) || ids.size === 0) return doc;
  const moveEnd = (end: WireEnd): WireEnd =>
    "comp" in end || "junction" in end ? end : shift(end, delta);
  const after: EditorDoc = {
    components: doc.components.map((c) =>
      ids.has(c.id) ? { ...c, position: shift(c.position, delta) } : c,
    ),
    junctions: doc.junctions.map((j) =>
      ids.has(j.id) ? { ...j, position: shift(j.position, delta) } : j,
    ),
    wires: doc.wires.map((w) =>
      ids.has(w.id) ? { ...w, from: moveEnd(w.from), to: moveEnd(w.to) } : w,
    ),
  };
  return {
    ...after,
    wires: after.wires.map((w, i) => {
      const old = doc.wires[i] ?? w;
      const a1 = endPosition(after, w.from);
      const b1 = endPosition(after, w.to);
      // A moved wire is first carried along whole, then re-aligned to ends that did not follow.
      const carried = ids.has(w.id);
      const offset = carried ? delta : { x: 0, y: 0 };
      const bends = old.points.map((p) => shift(p, offset));
      const a0 = shift(endPosition(doc, old.from), offset);
      const b0 = shift(endPosition(doc, old.to), offset);
      if (!carried && samePoint(a0, a1) && samePoint(b0, b1)) return w;
      return { ...w, points: realignedBends(bends, a0, b0, a1, b1) };
    }),
  };
}

export function moveComponent(doc: EditorDoc, id: string, position: GridPoint): EditorDoc {
  const moved = updateComponents(doc, new Set([id]), (c) => ({ ...c, position: { ...position } }));
  return realignWires(doc, moved);
}

export function renameComponent(doc: EditorDoc, id: string, name: string): EditorDoc {
  return updateComponents(doc, new Set([id]), (c) => ({ ...c, name }));
}

export function setParam(doc: EditorDoc, id: string, param: string, value: string): EditorDoc {
  return updateComponents(doc, new Set([id]), (c) => ({
    ...c,
    params: { ...c.params, [param]: value },
  }));
}

// --- Checks shown while editing ---------------------------------------------------------------
// The document accepts any value: the netlist module reports the same problems (MISSING_NAME,
// DUPLICATE_NAME, BAD_LABEL_NAME...). These checks only warn the user earlier. Texts in French.

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Problem with the SPICE name of `c` (whose type has `prefix`), or null if it is fine. */
export function nameProblem(doc: EditorDoc, c: PlacedComponent, prefix: string): string | null {
  const name = c.name ?? "";
  if (name === "") return "Le nom est obligatoire.";
  if (!name.toUpperCase().startsWith(prefix.toUpperCase()))
    return `Le nom doit commencer par « ${prefix} ».`;
  if (!IDENTIFIER.test(name)) return "Lettres, chiffres et _ seulement.";
  // SPICE ignores case: R1 and r1 are the same element.
  const taken = doc.components.some(
    (other) => other.id !== c.id && other.name?.toUpperCase() === name.toUpperCase(),
  );
  return taken ? `Un autre composant s'appelle déjà ${name}.` : null;
}

/** Problem with a label's node name, or null if it is fine (docs/format-schema.md). */
export function netNameProblem(net: string): string | null {
  if (net === "") return "Le nom du nœud est obligatoire.";
  if (!IDENTIFIER.test(net))
    return "Lettres, chiffres et _ seulement, en commençant par une lettre.";
  if (/^n\d+$/i.test(net)) return "Ce nom est réservé aux nœuds automatiques (n1, n2…).";
  return null;
}

export const rotateCw = (r: Rotation): Rotation => ((r + 90) % 360) as Rotation;

export function rotateComponents(doc: EditorDoc, ids: ReadonlySet<string>): EditorDoc {
  const rotated = updateComponents(doc, ids, (c) => ({ ...c, rotation: rotateCw(c.rotation) }));
  return realignWires(doc, rotated);
}

export function mirrorComponents(doc: EditorDoc, ids: ReadonlySet<string>): EditorDoc {
  return realignWires(
    doc,
    updateComponents(doc, ids, (c) => ({ ...c, mirror: !c.mirror })),
  );
}

/**
 * Cuts a wire in two at `p` (which must lie on it) and puts a junction there. A bend at `p`
 * becomes the junction. Returns the new doc and the junction id.
 */
export function splitWire(
  doc: EditorDoc,
  wireId: string,
  p: GridPoint,
): { doc: EditorDoc; junction: string } {
  const w = doc.wires.find((wire) => wire.id === wireId);
  if (!w) throw new Error(`Unknown wire ${wireId}`);
  const path = wirePath(doc, w);
  let i = 0;
  while (i + 2 < path.length && !onSegment(p, path[i] as GridPoint, path[i + 1] as GridPoint)) i++;

  const junction = nextIndexed("j", allIds(doc));
  const newWire = nextIndexed("w", [...allIds(doc), junction]);
  const notP = (q: GridPoint) => !samePoint(q, p);
  const first: EditorWire = {
    ...w,
    to: { junction },
    points: path.slice(1, i + 1).filter(notP),
  };
  const second: EditorWire = {
    id: newWire,
    from: { junction },
    to: w.to,
    points: path.slice(i + 1, -1).filter(notP),
  };
  return {
    doc: {
      ...doc,
      junctions: [...doc.junctions, { id: junction, position: { ...p } }],
      wires: doc.wires.flatMap((wire) => (wire.id === wireId ? [first, second] : [wire])),
    },
    junction,
  };
}

/**
 * Attaches a wire end dropped at `p` to whatever is there: a pin, a junction, the free end of
 * another wire (both then meet at a new junction), the middle of a wire (split, see
 * `splitWire`), or nothing (free end).
 */
export function resolveEnd(doc: EditorDoc, p: GridPoint): { doc: EditorDoc; end: WireEnd } {
  const anchor = anchorAt(doc, p);
  switch (anchor?.kind) {
    case undefined:
      return { doc, end: { ...p } };
    case "pin":
      return { doc, end: { comp: anchor.comp, pin: anchor.pin } };
    case "junction":
      return { doc, end: { junction: anchor.junction } };
    case "freeEnd": {
      // Every free end lying at `p` (there may be several) is attached to the new junction.
      const junction = nextIndexed("j", allIds(doc));
      const attach = (end: WireEnd): WireEnd =>
        !("comp" in end) && !("junction" in end) && samePoint(end, p) ? { junction } : end;
      return {
        doc: {
          ...doc,
          junctions: [...doc.junctions, { id: junction, position: { ...p } }],
          wires: doc.wires.map((w) => ({ ...w, from: attach(w.from), to: attach(w.to) })),
        },
        end: { junction },
      };
    }
    case "wire": {
      const split = splitWire(doc, anchor.wire, p);
      return { doc: split.doc, end: { junction: split.junction } };
    }
  }
}

const sameEnd = (a: WireEnd, b: WireEnd): boolean =>
  ("comp" in a && "comp" in b && a.comp === b.comp && a.pin === b.pin) ||
  ("junction" in a && "junction" in b && a.junction === b.junction);

/**
 * Adds a wire along `path` (start, bends, end, in grid units). Both ends are attached with
 * `resolveEnd`. Returns null, and changes nothing, for a wire of zero length or one that would
 * loop back to the pin or junction it starts from.
 */
export function addWire(
  doc: EditorDoc,
  path: readonly GridPoint[],
): { doc: EditorDoc; id: string } | null {
  const points = simplifyPath(path);
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end || points.length < 2) return null;

  const from = resolveEnd(doc, start);
  const to = resolveEnd(from.doc, end);
  if (sameEnd(from.end, to.end)) return null;

  const id = nextIndexed("w", allIds(to.doc));
  const wire: EditorWire = { id, from: from.end, to: to.end, points: points.slice(1, -1) };
  return { doc: { ...to.doc, wires: [...to.doc.wires, wire] }, id };
}

// --- Copy and paste ------------------------------------------------------------------------------

/** Part of a document copied with Ctrl+C, ready to be pasted (possibly several times). */
export type Clip = EditorDoc;

/**
 * The selected components and junctions, plus the wires whose two ends are inside the copy: both
 * attached to copied items, or free ends of a selected wire. Wires going outside are left out.
 */
export function copyItems(doc: EditorDoc, ids: ReadonlySet<string>): Clip {
  const components = doc.components.filter((c) => ids.has(c.id));
  const junctions = doc.junctions.filter((j) => ids.has(j.id));
  const wires = doc.wires.filter((w) => {
    const inside = (end: WireEnd) =>
      "comp" in end ? ids.has(end.comp) : "junction" in end ? ids.has(end.junction) : ids.has(w.id);
    return inside(w.from) && inside(w.to);
  });
  return structuredClone({ components, wires, junctions });
}

/**
 * Adds a copy of `clip`, moved by `offset`, with new ids and new SPICE names (R1 becomes R3 if R1
 * and R2 exist), so the netlist never gets two components with the same name. Returns the new
 * doc and the ids of the pasted items.
 */
export function pasteClip(
  doc: EditorDoc,
  clip: Clip,
  offset: GridPoint,
): { doc: EditorDoc; ids: string[] } {
  const taken = allIds(doc);
  const names = doc.components.flatMap((c) => (c.name ? [c.name] : []));
  const newId = new Map<string, string>();
  const fresh = (oldId: string, prefix: string) => {
    const id = nextIndexed(prefix, taken);
    taken.push(id);
    newId.set(oldId, id);
    return id;
  };

  const components = clip.components.map((c): PlacedComponent => {
    const copy: PlacedComponent = {
      ...structuredClone(c),
      id: fresh(c.id, "c"),
      position: shift(c.position, offset),
    };
    const prefix = getDef(c.type).prefix;
    if (prefix !== null) {
      copy.name = nextIndexed(prefix, names);
      names.push(copy.name);
    }
    return copy;
  });
  const junctions = clip.junctions.map((j) => ({
    id: fresh(j.id, "j"),
    position: shift(j.position, offset),
  }));
  const end = (e: WireEnd): WireEnd => {
    if ("comp" in e) return { comp: newId.get(e.comp) ?? e.comp, pin: e.pin };
    if ("junction" in e) return { junction: newId.get(e.junction) ?? e.junction };
    return shift(e, offset);
  };
  const wires = clip.wires.map((w) => ({
    id: fresh(w.id, "w"),
    from: end(w.from),
    to: end(w.to),
    points: w.points.map((p) => shift(p, offset)),
  }));

  return {
    doc: {
      components: [...doc.components, ...components],
      wires: [...doc.wires, ...wires],
      junctions: [...doc.junctions, ...junctions],
    },
    ids: [...components, ...wires, ...junctions].map((item) => item.id),
  };
}

/**
 * Deletes components, wires and junctions by id. Wire ends attached to a deleted component or
 * junction become free {x, y} ends at the same place, so no wire ever points to nothing. The
 * junctions the deleted wires ended on are cleaned up (see `cleanJunctions`).
 */
export function deleteItems(doc: EditorDoc, ids: ReadonlySet<string>): EditorDoc {
  const detach = (end: WireEnd): WireEnd => {
    if ("comp" in end && ids.has(end.comp)) {
      const c = doc.components.find((comp) => comp.id === end.comp);
      return c ? pinPosition(c, end.pin) : end;
    }
    if ("junction" in end && ids.has(end.junction)) {
      const j = doc.junctions.find((junction) => junction.id === end.junction);
      return j ? { ...j.position } : end;
    }
    return end;
  };
  const after = {
    components: doc.components.filter((c) => !ids.has(c.id)),
    junctions: doc.junctions.filter((j) => !ids.has(j.id)),
    wires: doc.wires
      .filter((w) => !ids.has(w.id))
      .map((w) => ({ ...w, from: detach(w.from), to: detach(w.to) })),
  };
  return cleanJunctions(after, junctionsOf(doc.wires.filter((w) => ids.has(w.id))));
}
