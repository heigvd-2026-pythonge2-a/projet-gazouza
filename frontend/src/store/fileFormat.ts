// Schematic files saved and opened by the editor (File > Save / Open). This is the editor's own
// format, not the API contract: it stores the editor document as it is.

import {
  TEXT_MAX_LENGTH,
  type EditorDoc,
  type EditorJunction,
  type EditorText,
  type EditorWire,
  type GridPoint,
  type PlacedComponent,
  type WireEnd,
} from "./document";
import { getDef } from "./library";

/** Marks a Psice schematic file; `version` changes if the format changes. */
const FORMAT = "psice-schematic";
const VERSION = 1;

/** Name proposed when saving. */
export const DEFAULT_FILE_NAME = "schema.psice.json";

/** The schematic file content for `doc` (readable JSON). */
export function serializeDoc(doc: EditorDoc): string {
  return `${JSON.stringify({ format: FORMAT, version: VERSION, doc }, null, 2)}\n`;
}

/** A file that cannot be opened; the message is shown to the user. */
export class FileFormatError extends Error {}

const fail = (detail: string): never => {
  throw new FileFormatError(`Ce fichier n'est pas un schéma Psice valide (${detail}).`);
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function point(v: unknown, what: string): GridPoint {
  if (!isObject(v) || !Number.isInteger(v.x) || !Number.isInteger(v.y)) {
    return fail(`${what} : position invalide`);
  }
  return { x: v.x as number, y: v.y as number };
}

/** Where a text of a component was moved by hand: absent (or unreadable) means automatic. */
function offset(v: unknown): GridPoint | undefined {
  if (!isObject(v) || typeof v.x !== "number" || typeof v.y !== "number") return undefined;
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return undefined;
  return { x: v.x, y: v.y };
}

function component(v: unknown): PlacedComponent {
  if (!isObject(v) || typeof v.id !== "string" || typeof v.type !== "string") {
    return fail("composant sans identifiant ou sans type");
  }
  const def = (() => {
    try {
      return getDef(v.type as string);
    } catch {
      return fail(`type de composant inconnu « ${String(v.type)} »`);
    }
  })();
  const rotation = v.rotation;
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
    return fail(`${v.id} : rotation invalide`);
  }
  const params: Record<string, string> = {};
  if (v.params !== undefined) {
    if (!isObject(v.params)) return fail(`${v.id} : paramètres invalides`);
    for (const [k, value] of Object.entries(v.params)) {
      if (typeof value !== "string") return fail(`${v.id} : paramètre ${k} invalide`);
      params[k] = value;
    }
  }
  return {
    id: v.id as string,
    type: def.type,
    ...(typeof v.name === "string" ? { name: v.name } : {}),
    position: point(v.position, v.id as string),
    rotation,
    mirror: v.mirror === true,
    params,
    ...offsets(v),
  };
}

function offsets(
  v: Record<string, unknown>,
): Pick<PlacedComponent, "name_offset" | "value_offset"> {
  const name = offset(v.name_offset);
  const value = offset(v.value_offset);
  return { ...(name ? { name_offset: name } : {}), ...(value ? { value_offset: value } : {}) };
}

function wireEnd(v: unknown, doc: { comps: Map<string, string>; junctions: Set<string> }): WireEnd {
  if (isObject(v) && typeof v.comp === "string" && typeof v.pin === "string") {
    const type = doc.comps.get(v.comp);
    if (type === undefined) return fail(`fil relié à un composant absent (${v.comp})`);
    if (!getDef(type).pins.some((p) => p.name === v.pin)) {
      return fail(`fil relié à une broche inconnue (${v.comp}.${v.pin})`);
    }
    return { comp: v.comp, pin: v.pin };
  }
  if (isObject(v) && typeof v.junction === "string") {
    if (!doc.junctions.has(v.junction)) return fail(`fil relié à une jonction absente`);
    return { junction: v.junction };
  }
  return point(v, "extrémité de fil");
}

/** Reads a schematic file. Throws `FileFormatError` if it is not a valid one. */
export function parseDoc(text: string): EditorDoc {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail("ce n'est pas du JSON");
  }
  if (!isObject(data) || data.format !== FORMAT) return fail("format inconnu");
  if (data.version !== VERSION) return fail(`version ${String(data.version)} non prise en charge`);
  const raw = data.doc;
  if (
    !isObject(raw) ||
    !Array.isArray(raw.components) ||
    !Array.isArray(raw.wires) ||
    !Array.isArray(raw.junctions)
  ) {
    return fail("contenu incomplet");
  }

  const components = raw.components.map(component);
  const junctions: EditorJunction[] = raw.junctions.map((j: unknown) => {
    if (!isObject(j) || typeof j.id !== "string") return fail("jonction sans identifiant");
    return { id: j.id, position: point(j.position, j.id) };
  });
  const ids = {
    comps: new Map(components.map((c) => [c.id, c.type])),
    junctions: new Set(junctions.map((j) => j.id)),
  };
  const wires: EditorWire[] = raw.wires.map((w: unknown) => {
    if (!isObject(w) || typeof w.id !== "string" || !Array.isArray(w.points)) {
      return fail("fil invalide");
    }
    return {
      id: w.id,
      from: wireEnd(w.from, ids),
      to: wireEnd(w.to, ids),
      points: w.points.map((p: unknown) => point(p, w.id as string)),
    };
  });
  // Files saved before the free texts (#123) have none.
  if (raw.texts !== undefined && !Array.isArray(raw.texts)) return fail("textes invalides");
  const texts: EditorText[] = (raw.texts ?? []).map((t: unknown) => {
    if (!isObject(t) || typeof t.id !== "string" || typeof t.content !== "string") {
      return fail("texte invalide");
    }
    if (t.content.length > TEXT_MAX_LENGTH) return fail(`${t.id} : texte trop long`);
    return { id: t.id, position: point(t.position, t.id), content: t.content };
  });
  const all = [
    ...ids.comps.keys(),
    ...ids.junctions,
    ...wires.map((w) => w.id),
    ...texts.map((t) => t.id),
  ];
  if (new Set(all).size !== all.length) return fail("identifiants en double");
  return { components, wires, junctions, texts };
}
