// Readable names of the nodes of the schematic (#292), for display only: the netlist keeps its
// own names ("n1", "n2"…), which mean nothing on the schematic. A node is named after a node label
// placed by the user, else after its most telling pin ("Base de Q1", "Borne + de V1"), else after
// the components it joins ("Entre R1 et C1"). Texts in French.

import { normalizeContacts, type EditorDoc } from "./document";
import { nodeIndex, type CircuitNode, type NodeItem } from "./nodes";

/** How a pin is named, and how telling it is (lower first). */
interface PinWording {
  rank: number;
  text: string;
}

const TRANSISTOR = 1;
const OUTPUT = 2;
const SOURCE = 3;
const INPUT = 4;
const DIODE = 5;

const BJT: Record<string, PinWording> = {
  B: { rank: TRANSISTOR, text: "Base" },
  C: { rank: TRANSISTOR, text: "Collecteur" },
  E: { rank: TRANSISTOR, text: "Émetteur" },
};
const MOSFET: Record<string, PinWording> = {
  D: { rank: TRANSISTOR, text: "Drain" },
  G: { rank: TRANSISTOR, text: "Grille" },
  S: { rank: TRANSISTOR, text: "Source" },
};
const OPAMP: Record<string, PinWording> = {
  out: { rank: OUTPUT, text: "Sortie" },
  "+": { rank: INPUT, text: "Entrée +" },
  "-": { rank: INPUT, text: "Entrée −" },
  "V+": { rank: INPUT, text: "Alimentation +" },
  "V-": { rank: INPUT, text: "Alimentation −" },
};
const TWO_TERMINAL_SOURCE: Record<string, PinWording> = {
  "+": { rank: SOURCE, text: "Borne +" },
  "-": { rank: SOURCE, text: "Borne −" },
};
const DIODE_PINS: Record<string, PinWording> = {
  A: { rank: DIODE, text: "Anode" },
  K: { rank: DIODE, text: "Cathode" },
};

/** Wording of the pins worth naming a node after, by component type. */
const PIN_WORDING: Record<string, Record<string, PinWording>> = {
  npn: BJT,
  pnp: BJT,
  nmos: MOSFET,
  pmos: MOSFET,
  opamp: OPAMP,
  opamp_real: OPAMP,
  voltage_source: TWO_TERMINAL_SOURCE,
  current_source: TWO_TERMINAL_SOURCE,
  diode: DIODE_PINS,
  led: DIODE_PINS,
  zener: DIODE_PINS,
};

/** Name shown for the ground node. */
export const GROUND_NAME = "Masse";

/**
 * Readable name of a node of `doc`: the name of a node label on it, "Masse" for the ground, else
 * its most telling pin (transistors, then op-amp outputs, sources, op-amp inputs, diodes, the
 * first one drawn on a tie), else the components it joins. Null for a node with no component.
 */
export function describeNode(doc: EditorDoc, node: CircuitNode): string | null {
  const comps = new Map(doc.components.map((c, i) => [c.id, { c, order: i }]));
  const pins = node.pins
    .flatMap((p) => {
      const entry = comps.get(p.comp);
      return entry ? [{ ...entry, pin: p.pin }] : [];
    })
    .sort((a, b) => a.order - b.order);

  const label = pins.find(({ c }) => c.type === "label" && (c.params.net ?? "").trim() !== "");
  if (label) return (label.c.params.net ?? "").trim();
  if (pins.some(({ c }) => c.type === "ground")) return GROUND_NAME;

  let best: { rank: number; text: string } | null = null;
  for (const { c, pin } of pins) {
    const wording = PIN_WORDING[c.type]?.[pin];
    if (wording && (!best || wording.rank < best.rank)) {
      best = { rank: wording.rank, text: `${wording.text} de ${c.name ?? c.id}` };
    }
  }
  if (best) return best.text;

  const names = [
    ...new Set(pins.filter(({ c }) => c.type !== "label").map(({ c }) => c.name ?? c.id)),
  ];
  const [first, second] = names;
  if (first && second) return `Entre ${first} et ${second}`;
  const only = pins.find(({ c }) => c.type !== "label");
  return only ? `Borne ${only.pin} de ${only.c.name ?? only.c.id}` : null;
}

/**
 * Something of `doc` on the node formed by `wireIds` (the wires the netlist lists for it, see
 * `nets` in the netlist response): one of its wires, or, for a node only made of the contact
 * wires added by `normalizeContacts` (two pins touching), a pin at one end of them.
 */
export function netItem(doc: EditorDoc, wireIds: readonly string[]): NodeItem | null {
  const shown = wireIds.find((id) => doc.wires.some((w) => w.id === id));
  if (shown) return { wire: shown };
  const normalized = normalizeContacts(doc);
  for (const id of wireIds) {
    const w = normalized.wires.find((x) => x.id === id);
    const end = w && [w.from, w.to].find((e) => "comp" in e);
    if (end && "comp" in end) return { comp: end.comp, pin: end.pin };
  }
  return null;
}

/** A node of the netlist as shown to the user. */
export interface NetDescription {
  /** Readable name ("Base de Q1"), or "Nœud n3" when nothing better is found. */
  name: string;
  /** Something on the node, to highlight it on the schematic; null if it cannot be found. */
  item: NodeItem | null;
}

/** Readable name of the netlist node `net`, made of the wires `wireIds` (see `nets`). */
export function describeNet(
  doc: EditorDoc,
  net: string,
  wireIds: readonly string[] = [],
): NetDescription {
  const item = netItem(doc, wireIds);
  const node = item && nodeIndex(doc)(item);
  const name = (node && describeNode(doc, node)) ?? (net === "0" ? GROUND_NAME : `Nœud ${net}`);
  return { name, item };
}
