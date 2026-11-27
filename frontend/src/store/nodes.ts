// Electrical nodes of the schematic, as the editor shows them (#278): hovering a wire or a pin
// highlights everything connected to it. Same rules as the backend (backend/app/netlist/
// connectivity.py): wires join what their ends are attached to, touching pins are connected
// (`normalizeContacts`, #256), every ground is the same node, and so are labels with the same
// name. Wires only connect at their ends: two wires crossing without a junction stay apart.

import { getDef } from "./library";
import { normalizeContacts, type EditorDoc } from "./document";
import { endKey, pinKey, wireGroups } from "./wireGroups";

/** What can be hovered to show its node. */
export type NodeItem = { wire: string } | { comp: string; pin: string };

/** A node: the wires and the component pins it is made of. */
export interface CircuitNode {
  wires: ReadonlySet<string>;
  pins: readonly { comp: string; pin: string }[];
}

/** Finds the node of an item; null for an item that is not in the document. */
export type NodeIndex = (item: NodeItem) => CircuitNode | null;

/** Indexes already built, by document (documents are immutable, see the store). */
const cache = new WeakMap<EditorDoc, NodeIndex>();

/**
 * The nodes of `doc`, computed once per document: hovering over a large schematic only looks the
 * answer up.
 */
export function nodeIndex(doc: EditorDoc): NodeIndex {
  const cached = cache.get(doc);
  if (cached) return cached;
  const index = buildIndex(doc);
  cache.set(doc, index);
  return index;
}

function buildIndex(doc: EditorDoc): NodeIndex {
  const normalized = normalizeContacts(doc);
  const groups = wireGroups(normalized.wires);

  // Grounds are all node 0; labels with the same name (case ignored) are the same node.
  let ground: string | null = null;
  const labels = new Map<string, string>();
  for (const c of normalized.components) {
    for (const pin of getDef(c.type).pins) {
      const key = pinKey(c.id, pin.name);
      if (c.type === "ground") {
        if (ground) groups.union(key, ground);
        ground = key;
      } else if (c.type === "label") {
        const net = (c.params.net ?? "").trim().toLowerCase();
        if (!net) continue;
        const other = labels.get(net);
        if (other) groups.union(key, other);
        labels.set(net, key);
      }
    }
  }

  const nodes = new Map<string, { wires: Set<string>; pins: { comp: string; pin: string }[] }>();
  const nodeAt = (root: string) => {
    let node = nodes.get(root);
    if (!node) {
      node = { wires: new Set(), pins: [] };
      nodes.set(root, node);
    }
    return node;
  };
  const shownWires = new Set(doc.wires.map((w) => w.id));
  const wireRoot = new Map<string, string>();
  for (const w of normalized.wires) {
    const root = groups.find(endKey(w.from, w.id, "from"));
    // Contact wires added by the normalization are not on screen: only their pins are shown.
    if (!shownWires.has(w.id)) continue;
    wireRoot.set(w.id, root);
    nodeAt(root).wires.add(w.id);
  }
  for (const c of normalized.components) {
    for (const pin of getDef(c.type).pins) {
      nodeAt(groups.find(pinKey(c.id, pin.name))).pins.push({ comp: c.id, pin: pin.name });
    }
  }
  const pinRoot = (comp: string, pin: string) => groups.find(pinKey(comp, pin));
  const pinExists = (comp: string, pin: string) =>
    normalized.components.some(
      (c) => c.id === comp && getDef(c.type).pins.some((p) => p.name === pin),
    );

  return (item) => {
    const root =
      "wire" in item
        ? wireRoot.get(item.wire)
        : pinExists(item.comp, item.pin)
          ? pinRoot(item.comp, item.pin)
          : undefined;
    return root === undefined ? null : (nodes.get(root) ?? null);
  };
}
