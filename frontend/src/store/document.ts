// Editor-internal document model and pure operations on it (doc -> new doc).
//
// These are NOT the API contract types: they follow what was agreed on PR #2 (explicit wires,
// junctions, free wire ends as {x, y}) so the editor can move forward before the contract PR
// lands. Once it does, a single `toSchematic()` serializer typed against `src/api/client.ts`
// will convert this model to the contract format.
//
// Every operation returns a new document and never mutates its input, so undo/redo can later
// be implemented by keeping snapshots.

import { getDef } from "./library";

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

/** Removes repeated points and bends lying on the straight line between their neighbours. */
export function simplifyPath(path: readonly GridPoint[]): GridPoint[] {
  const out: GridPoint[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (last && samePoint(last, p)) continue;
    const prev = out[out.length - 2];
    if (prev && last && onSegment(last, prev, p)) out.pop();
    out.push({ ...p });
  }
  return out;
}

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

export function moveComponent(doc: EditorDoc, id: string, position: GridPoint): EditorDoc {
  return updateComponents(doc, new Set([id]), (c) => ({ ...c, position: { ...position } }));
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
  return updateComponents(doc, ids, (c) => ({ ...c, rotation: rotateCw(c.rotation) }));
}

export function mirrorComponents(doc: EditorDoc, ids: ReadonlySet<string>): EditorDoc {
  return updateComponents(doc, ids, (c) => ({ ...c, mirror: !c.mirror }));
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

/**
 * Deletes components, wires and junctions by id. Wire ends attached to a deleted component or
 * junction become free {x, y} ends at the same place, so no wire ever points to nothing.
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
  return {
    components: doc.components.filter((c) => !ids.has(c.id)),
    junctions: doc.junctions.filter((j) => !ids.has(j.id)),
    wires: doc.wires
      .filter((w) => !ids.has(w.id))
      .map((w) => ({ ...w, from: detach(w.from), to: detach(w.to) })),
  };
}
