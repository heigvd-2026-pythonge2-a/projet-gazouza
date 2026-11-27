// Texts of a component on the schematic: its name and its value (#92).
//
// Each text is placed automatically next to the symbol, on the first free side, unless it was
// moved by hand: its offset (`name_offset`, `value_offset`) is then stored in the component's
// own frame (before mirror and rotation), so it turns with the component, while the text itself
// is always drawn upright. All the geometry is in grid units; text sizes are estimated (the font
// is not measured here).

import {
  isDiagonalRotation,
  textBounds,
  toWorld,
  toWorldExact,
  turnPoint,
  turnedRect,
  wirePath,
  type EditorDoc,
  type GridPoint,
  type GridRect,
  type PlacedComponent,
} from "./document";
import { getDef, symbolBounds, visibleParams, type ComponentDef } from "./library";

export type CaptionKind = "name" | "value";

/** Font size and line height of a component's texts (12 px at zoom 1). */
export const CAPTION_FONT_SIZE = 0.6;
/** Estimated width of one letter. */
const CAPTION_CHAR_WIDTH = 0.34;
/** Space between the symbol and its texts placed automatically. */
const CAPTION_GAP = 0.3;
/** A text moved by hand snaps to half a grid step. */
export const CAPTION_SNAP = 0.5;
/** How far from its symbol a text may go (between the two boxes), so its owner stays obvious. */
export const CAPTION_MAX_DISTANCE = 3;
/** Search radius around the wanted position for a free one, when it is taken. */
const SEARCH_RADIUS = 4;
/** Below this, two boxes that only touch do not collide. */
const EPS = 1e-6;

/** A text of a component, as drawn. */
export interface Caption {
  kind: CaptionKind;
  text: string;
  /** Centre of the text, in grid coordinates. */
  centre: GridPoint;
  /** Moved by hand (it keeps its place) or placed automatically. */
  manual: boolean;
  /** A text moved by hand that something now covers: shown, without blocking anything. */
  overlapping: boolean;
}

const OFFSET_FIELD = { name: "name_offset", value: "value_offset" } as const;

/** The stored offset of a text, if it was moved by hand. */
export function captionOffset(c: PlacedComponent, kind: CaptionKind): GridPoint | undefined {
  return c[OFFSET_FIELD[kind]];
}

/**
 * The texts of a component: its name and main value (the net name for a label, nothing for the
 * ground). A source that is not DC shows its waveform ("Impulsion"), since one value would
 * mislead. An empty text is left out.
 */
export function captionTexts(c: PlacedComponent, def: ComponentDef = getDef(c.type)) {
  const out: { kind: CaptionKind; text: string }[] = [];
  if (c.type === "ground") return out;
  if (c.type === "label") {
    if (c.params.net) out.push({ kind: "name", text: c.params.net });
    return out;
  }
  if (c.name) out.push({ kind: "name", text: c.name });
  const waveform = def.params.find((p) => p.name === "waveform");
  const selected = waveform?.options.find((o) => o.value === c.params.waveform);
  if (selected && selected.value !== "dc") {
    out.push({ kind: "value", text: selected.label });
    return out;
  }
  const main = visibleParams(def, c.params).find((p) => p.kind === "value");
  const value = main ? (c.params[main.name] ?? "") : "";
  if (value) out.push({ kind: "value", text: `${value}${main?.unit ?? ""}` });
  return out;
}

/** Estimated size of a one-line text. */
export function captionSize(text: string): { width: number; height: number } {
  return { width: Math.max(1, text.length) * CAPTION_CHAR_WIDTH, height: CAPTION_FONT_SIZE };
}

/** Box of a text centred on `centre`. */
export function captionRect(text: string, centre: GridPoint): GridRect {
  const { width, height } = captionSize(text);
  return {
    min: { x: centre.x - width / 2, y: centre.y - height / 2 },
    max: { x: centre.x + width / 2, y: centre.y + height / 2 },
  };
}

/** Box of the symbol (pins included), turned like the component, in grid coordinates. */
export function symbolRect(c: PlacedComponent, def: ComponentDef = getDef(c.type)): GridRect {
  const box = turnedRect(symbolBounds(def), c);
  if (!isDiagonalRotation(c.rotation)) return box;
  // On a diagonal the pins are put a little further out, back on the grid (`toWorld`).
  const points = [box.min, box.max, ...def.pins.map((pin) => toWorld(pin, c))];
  return {
    min: { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)) },
    max: { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)) },
  };
}

/** Grid coordinates -> the component's own frame: the inverse of `toWorld`. */
export function toLocal(
  world: GridPoint,
  c: Pick<PlacedComponent, "position" | "rotation" | "mirror">,
): GridPoint {
  // The turn back (counterclockwise), then the mirror: `toWorld` in reverse.
  const back = ((360 - c.rotation) % 360) as PlacedComponent["rotation"];
  const r = turnPoint({ x: world.x - c.position.x, y: world.y - c.position.y }, back, false);
  // `+ 0` turns a -0 into 0, so a saved offset never reads "-0".
  return { x: (c.mirror ? -r.x : r.x) + 0, y: r.y + 0 };
}

function overlaps(a: GridRect, b: GridRect): boolean {
  return (
    a.min.x < b.max.x - EPS &&
    b.min.x < a.max.x - EPS &&
    a.min.y < b.max.y - EPS &&
    b.min.y < a.max.y - EPS
  );
}

/**
 * Whether a wire segment (horizontal or vertical) crosses the inside of a box. A segment is a
 * box with no thickness, so `overlaps` already tells it: a wire along the edge does not count.
 */
function segmentCrosses(p: GridPoint, q: GridPoint, r: GridRect): boolean {
  const segment = {
    min: { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y) },
    max: { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y) },
  };
  return overlaps(segment, r);
}

/** What a text must not cover: symbols, wires, free texts and the texts already placed. */
class Obstacles {
  private boxes: GridRect[] = [];
  private segments: [GridPoint, GridPoint][] = [];

  constructor(doc: EditorDoc) {
    for (const c of doc.components) this.boxes.push(symbolRect(c));
    for (const t of doc.texts) this.boxes.push(textBounds(t));
    for (const w of doc.wires) {
      const path = wirePath(doc, w);
      for (let i = 0; i + 1 < path.length; i++) {
        const p = path[i];
        const q = path[i + 1];
        if (p && q) this.segments.push([p, q]);
      }
    }
  }

  add(r: GridRect) {
    this.boxes.push(r);
  }

  hits(r: GridRect): boolean {
    return (
      this.boxes.some((b) => overlaps(b, r)) ||
      this.segments.some(([p, q]) => segmentCrosses(p, q, r))
    );
  }
}

type Side = "right" | "left" | "above" | "below";

/**
 * The automatic places of a component's texts, one set per side to try, in order: right of a
 * vertical symbol (then left, above, below), above a horizontal one (then below, right, left).
 * The texts are stacked, name first. A label's net name follows the tip of its flag.
 */
function autoCandidates(
  c: PlacedComponent,
  def: ComponentDef,
  texts: { kind: CaptionKind; text: string }[],
): GridPoint[][] {
  if (c.type === "label") {
    const bounds = symbolBounds(def);
    const tip = toWorldExact({ x: bounds.max.x + CAPTION_GAP, y: 0 }, c);
    const right = tip.x >= c.position.x - 0.01;
    return [
      texts.map(({ text }) => {
        const half = captionSize(text).width / 2;
        return { x: tip.x + (right ? half : -half), y: tip.y };
      }),
    ];
  }
  const r = symbolRect(c, def);
  const cx = (r.min.x + r.max.x) / 2;
  const cy = (r.min.y + r.max.y) / 2;
  const h = CAPTION_FONT_SIZE;
  const n = texts.length;
  const place = (side: Side) =>
    texts.map(({ text }, i) => {
      const half = captionSize(text).width / 2;
      switch (side) {
        case "right":
          return { x: r.max.x + CAPTION_GAP + half, y: cy - (n * h) / 2 + h * (i + 0.5) };
        case "left":
          return { x: r.min.x - CAPTION_GAP - half, y: cy - (n * h) / 2 + h * (i + 0.5) };
        case "above":
          return { x: cx, y: r.min.y - CAPTION_GAP - n * h + h * (i + 0.5) };
        case "below":
          return { x: cx, y: r.max.y + CAPTION_GAP + h * (i + 0.5) };
      }
    });
  const vertical = r.max.y - r.min.y >= r.max.x - r.min.x;
  const sides: Side[] = vertical
    ? ["right", "left", "above", "below"]
    : ["above", "below", "right", "left"];
  return sides.map(place);
}

/**
 * Where the texts of every component are drawn. The texts moved by hand keep their place;
 * the others go on the first side of their symbol where they cover nothing (symbols, wires,
 * free texts, other component texts), or on the first side if none is free.
 */
export function layoutCaptions(doc: EditorDoc): Map<string, Caption[]> {
  const obstacles = new Obstacles(doc);
  const out = new Map<string, Caption[]>();
  const pending: {
    c: PlacedComponent;
    def: ComponentDef;
    texts: ReturnType<typeof captionTexts>;
  }[] = [];

  // Texts placed by hand first: the automatic ones avoid them.
  for (const c of doc.components) {
    const def = getDef(c.type);
    const texts = captionTexts(c, def);
    const captions: Caption[] = [];
    for (const { kind, text } of texts) {
      const offset = captionOffset(c, kind);
      if (!offset) continue;
      const centre = toWorldExact(offset, c);
      captions.push({ kind, text, centre, manual: true, overlapping: false });
    }
    out.set(c.id, captions);
    if (texts.length > captions.length) pending.push({ c, def, texts });
  }
  // Checked once all of them are known: each against everything else.
  const manual = [...out.entries()].flatMap(([id, list]) =>
    list.map((caption) => ({ id, caption })),
  );
  for (const { caption } of manual) {
    const box = captionRect(caption.text, caption.centre);
    caption.overlapping =
      obstacles.hits(box) ||
      manual.some(
        (o) =>
          o.caption !== caption && overlaps(captionRect(o.caption.text, o.caption.centre), box),
      );
  }
  for (const { caption } of manual) obstacles.add(captionRect(caption.text, caption.centre));

  for (const { c, def, texts } of pending) {
    const candidates = autoCandidates(c, def, texts);
    const isAuto = texts.map(({ kind }) => !captionOffset(c, kind));
    const free = candidates.find((centres) =>
      centres.every((centre, i) => {
        const t = texts[i];
        return !isAuto[i] || !t || !obstacles.hits(captionRect(t.text, centre));
      }),
    );
    const chosen = free ?? candidates[0] ?? [];
    const captions = out.get(c.id) ?? [];
    texts.forEach(({ kind, text }, i) => {
      const centre = chosen[i];
      if (!isAuto[i] || !centre) return;
      captions.push({ kind, text, centre, manual: false, overlapping: false });
      obstacles.add(captionRect(text, centre));
    });
    // Same order as the texts (name first), whichever were moved by hand.
    captions.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "name" ? -1 : 1));
    out.set(c.id, captions);
  }
  return out;
}

/** Distance between the boxes of a text and of its symbol (0 when they touch or overlap). */
function distance(a: GridRect, b: GridRect): number {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  return Math.max(dx, dy);
}

const snap = (v: number) => Math.round(v / CAPTION_SNAP) * CAPTION_SNAP;

/** Half-grid steps around a point, nearest first (computed once). */
const SEARCH_STEPS: GridPoint[] = (() => {
  const n = Math.round(SEARCH_RADIUS / CAPTION_SNAP);
  const steps: GridPoint[] = [];
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) steps.push({ x: i * CAPTION_SNAP, y: j * CAPTION_SNAP });
  }
  return steps.sort((a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y));
})();

/**
 * Where a text dragged to `wanted` (its centre) lands: snapped to half a grid step, on the
 * nearest place that covers nothing and stays close to its symbol. Null when there is none
 * nearby (the text then stays where it was).
 */
export function resolveCaptionDrop(
  doc: EditorDoc,
  id: string,
  kind: CaptionKind,
  wanted: GridPoint,
): GridPoint | null {
  const c = doc.components.find((x) => x.id === id);
  if (!c) return null;
  const text = captionTexts(c).find((t) => t.kind === kind)?.text;
  if (text === undefined) return null;
  const own = symbolRect(c);
  const obstacles = new Obstacles(doc);
  for (const [other, captions] of layoutCaptions(doc)) {
    for (const caption of captions) {
      if (other === id && caption.kind === kind) continue;
      obstacles.add(captionRect(caption.text, caption.centre));
    }
  }
  const start = { x: snap(wanted.x), y: snap(wanted.y) };
  for (const step of SEARCH_STEPS) {
    const centre = { x: start.x + step.x, y: start.y + step.y };
    const box = captionRect(text, centre);
    if (distance(box, own) > CAPTION_MAX_DISTANCE + EPS) continue;
    if (!obstacles.hits(box)) return centre;
  }
  return null;
}

/** Sets where a text is drawn (its centre, in grid coordinates): it is then placed by hand. */
export function moveCaption(
  doc: EditorDoc,
  id: string,
  kind: CaptionKind,
  centre: GridPoint,
): EditorDoc {
  const field = OFFSET_FIELD[kind];
  let changed = false;
  const components = doc.components.map((c) => {
    if (c.id !== id) return c;
    const offset = toLocal(centre, c);
    const old = c[field];
    if (old && old.x === offset.x && old.y === offset.y) return c;
    changed = true;
    return { ...c, [field]: offset };
  });
  return changed ? { ...doc, components } : doc;
}

/** Puts the texts of the given components back to their automatic place. */
export function resetCaptions(doc: EditorDoc, ids: ReadonlySet<string>): EditorDoc {
  let changed = false;
  const components = doc.components.map((c) => {
    if (!ids.has(c.id) || (!c.name_offset && !c.value_offset)) return c;
    changed = true;
    const copy = { ...c };
    delete copy.name_offset;
    delete copy.value_offset;
    return copy;
  });
  return changed ? { ...doc, components } : doc;
}

/**
 * After the given components were turned or mirrored: a text moved by hand that now covers
 * something goes back to its automatic place.
 */
export function releaseCoveredCaptions(doc: EditorDoc, ids: ReadonlySet<string>): EditorDoc {
  const layout = layoutCaptions(doc);
  let out = doc;
  for (const id of ids) {
    for (const caption of layout.get(id) ?? []) {
      if (!caption.manual || !caption.overlapping) continue;
      out = {
        ...out,
        components: out.components.map((c) => {
          if (c.id !== id) return c;
          const copy = { ...c };
          delete copy[OFFSET_FIELD[caption.kind]];
          return copy;
        }),
      };
    }
  }
  return out;
}
