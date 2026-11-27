// Direction of the node labels left on "Automatique" (#295), worked out from the circuit rather
// than from the side their wire comes from: a signal goes from where it is produced to where it
// is used.
//
// Each label sits on a piece of circuit: what its pin is connected to by wires and touching pins,
// WITHOUT the merging of the labels of the same name (grounds are still all one node). A piece
// produces the signal when it holds a driving pin (`drivers` in the editor's table of parts: the
// terminals of a source, the output of an op-amp) and is not the ground: the ground is not a
// signal. Then, for a label whose name is also on another piece:
// - its piece produces the signal, and no other piece of that name does: output;
// - its piece does not, another one does: input (the signal comes from the other label);
// - its piece and another one both produce it: bidirectional.
// Otherwise (no partner on another piece, or no piece produces the signal): no direction.

import { normalizeContacts, type EditorDoc } from "./document";
import { getDef } from "./library";
import { pinKey, wireGroups } from "./wireGroups";

/** The drawn direction of a label. */
export type LabelDirection = "none" | "input" | "output" | "bidir";

/** Value of the `direction` parameter that lets the editor choose (the library's default). */
export const AUTO_DIRECTION = "auto";

/** Directions already worked out, by document (documents are immutable, see the store). */
const cache = new WeakMap<EditorDoc, ReadonlyMap<string, LabelDirection>>();

/** Key of the name of a label: names are compared without case, like the backend does. */
const netKey = (net: string | undefined) => (net ?? "").trim().toLowerCase();

/**
 * The direction of every label of `doc` whose `direction` is "auto", by label id. Labels with a
 * direction chosen by hand are not in the map (they keep it), but they count as partners.
 */
export function autoLabelDirections(doc: EditorDoc): ReadonlyMap<string, LabelDirection> {
  const cached = cache.get(doc);
  if (cached) return cached;
  const directions = computeDirections(doc);
  cache.set(doc, directions);
  return directions;
}

function computeDirections(doc: EditorDoc): Map<string, LabelDirection> {
  const out = new Map<string, LabelDirection>();
  const auto = doc.components.filter(
    (c) => c.type === "label" && c.params.direction === AUTO_DIRECTION,
  );
  if (auto.length === 0) return out;

  const normalized = normalizeContacts(doc);
  const groups = wireGroups(normalized.wires);
  let ground: string | null = null;
  for (const c of normalized.components) {
    if (c.type !== "ground") continue;
    const key = pinKey(c.id, getDef(c.type).pins[0]?.name ?? "1");
    if (ground) groups.union(key, ground);
    ground = key;
  }
  const groundRoot = ground === null ? null : groups.find(ground);

  const producing = new Set<string>();
  for (const c of normalized.components) {
    for (const pin of getDef(c.type).drivers ?? []) {
      const root = groups.find(pinKey(c.id, pin));
      if (root !== groundRoot) producing.add(root);
    }
  }

  // The pieces of each name.
  const labelRoot = new Map<string, string>();
  const piecesByNet = new Map<string, Set<string>>();
  for (const c of normalized.components) {
    if (c.type !== "label") continue;
    const net = netKey(c.params.net);
    if (!net) continue;
    const root = groups.find(pinKey(c.id, "1"));
    labelRoot.set(c.id, root);
    let pieces = piecesByNet.get(net);
    if (!pieces) piecesByNet.set(net, (pieces = new Set()));
    pieces.add(root);
  }

  for (const label of auto) {
    const root = labelRoot.get(label.id);
    const pieces = piecesByNet.get(netKey(label.params.net));
    if (root === undefined || !pieces || pieces.size < 2) {
      out.set(label.id, "none");
      continue;
    }
    const producers = [...pieces].filter((p) => producing.has(p)).length;
    const mine = producing.has(root);
    out.set(
      label.id,
      producers === 0 ? "none" : !mine ? "input" : producers > 1 ? "bidir" : "output",
    );
  }
  return out;
}
