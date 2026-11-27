// Which attachment points are joined by wires alone (#257, #259): pins and junctions, with the
// wires as the only links. Components do not conduct here, and each free wire end is a point of
// its own. Two points in the same group are already connected: a wire between them is useless.

import type { EditorWire, WireEnd } from "./document";

/** Key of a wire end: its pin or junction, or the free end itself (`side` of wire `wireId`). */
export function endKey(end: WireEnd, wireId: string, side: "from" | "to"): string {
  if ("comp" in end) return `pin:${end.comp}/${end.pin}`;
  if ("junction" in end) return `junction:${end.junction}`;
  return `free:${wireId}:${side}`;
}

/** Key of a pin, as `endKey` gives it. */
export const pinKey = (comp: string, pin: string): string => `pin:${comp}/${pin}`;

/** Disjoint sets of keys: `union(a, b)` joins two groups, `find(a)` names the group of `a`. */
export class WireGroups {
  private parent = new Map<string, string>();

  find(key: string): string {
    let root = key;
    for (let up = this.parent.get(root); up !== undefined && up !== root;) {
      root = up;
      up = this.parent.get(root);
    }
    // Path compression: point every visited key straight to the root.
    for (let k = key; k !== root;) {
      const next = this.parent.get(k) as string;
      this.parent.set(k, root);
      k = next;
    }
    return root;
  }

  /** Joins the groups of `a` and `b`; false if they were already one. */
  union(a: string, b: string): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent.set(ra, rb);
    return true;
  }

  same(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }

  /** Joins the two ends of `w`; false if they were already in the same group. */
  addWire(w: EditorWire): boolean {
    return this.union(endKey(w.from, w.id, "from"), endKey(w.to, w.id, "to"));
  }
}

/** The groups of the points joined by `wires` (all of them, or all but `except`). */
export function wireGroups(wires: readonly EditorWire[], except?: string): WireGroups {
  const groups = new WireGroups();
  for (const w of wires) if (w.id !== except) groups.addWire(w);
  return groups;
}
