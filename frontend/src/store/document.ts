// Editor-internal document model and pure operations on it (doc -> new doc).
//
// These are NOT the API contract types: they follow what was agreed on PR #2 (explicit wires,
// junctions, free wire ends as {x, y}) so the editor can move forward before the contract PR
// lands. Once it does, a single `toSchematic()` serializer typed against `src/api/client.ts`
// will convert this model to the contract format.
//
// Every operation returns a new document and never mutates its input, so undo/redo can later
// be implemented by keeping snapshots.

import { getDef, UNNAMED_TYPES } from "./library";

export interface GridPoint {
  x: number;
  y: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface PlacedComponent {
  id: string;
  type: string;
  name: string;
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
  if (!pin) throw new Error(`${c.name} has no pin ${pinName}`);
  return toWorld(pin, c);
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
  const name = UNNAMED_TYPES.has(def.type)
    ? def.prefix
    : nextIndexed(
        def.prefix,
        doc.components.map((c) => c.name),
      );
  const params = Object.fromEntries(def.params.map((param) => [param.name, param.default]));
  const component: PlacedComponent = { id, name, params, ...p, position: { ...p.position } };
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

export const rotateCw = (r: Rotation): Rotation => ((r + 90) % 360) as Rotation;

export function rotateComponents(doc: EditorDoc, ids: ReadonlySet<string>): EditorDoc {
  return updateComponents(doc, ids, (c) => ({ ...c, rotation: rotateCw(c.rotation) }));
}

export function mirrorComponents(doc: EditorDoc, ids: ReadonlySet<string>): EditorDoc {
  return updateComponents(doc, ids, (c) => ({ ...c, mirror: !c.mirror }));
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
