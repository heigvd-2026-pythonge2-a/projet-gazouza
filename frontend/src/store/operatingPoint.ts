// Arrows of an operating point (.op) drawn on the schematic (#290): the direction of the current
// through each two-pin component, and the voltage across components, pointing at the more positive
// terminal (French convention: opposite to the current in a receiver, the same way in a source).
// V_CE / V_DS of the transistors are computed here from the node voltages (ground = 0 V).

import type { SimulationResult } from "../api/client";
import { pinPosition, type EditorDoc, type GridPoint, type PlacedComponent } from "./document";
import { getDef } from "./library";
import { netItem } from "./netNames";
import { nodeIndex } from "./nodes";
import { formatSI, type OperatingPointLabel } from "./simulation";

/** An arrow with its value, in grid units. */
export interface ValueArrow {
  key: string;
  kind: "current" | "voltage";
  /** The arrow goes from `from` to `to` (its head). */
  from: GridPoint;
  to: GridPoint;
  /** The value, placed beside the arrow. */
  label: OperatingPointLabel;
}

const pinKey = (comp: string, pin: string) => `${comp}/${pin}`;

/**
 * Potential of every pin of `doc` the result gives (key "comp/pin", in volts): the voltage of the
 * node each one is on, 0 for the ground node. Pins of a node the result does not give are left out.
 */
export function pinPotentials(
  doc: EditorDoc,
  result: SimulationResult,
  nets: Record<string, string[]>,
): Map<string, number> {
  const index = nodeIndex(doc);
  const out = new Map<string, number>();
  const setNode = (item: Parameters<typeof index>[0] | null, value: number) => {
    const node = item && index(item);
    for (const p of node?.pins ?? []) out.set(pinKey(p.comp, p.pin), value);
  };
  const ground = doc.components.find((c) => c.type === "ground");
  if (ground) setNode({ comp: ground.id, pin: getDef(ground.type).pins[0]?.name ?? "1" }, 0);
  for (const trace of result.traces ?? []) {
    const value = trace.values[0];
    if (trace.kind !== "voltage" || !trace.net || value === undefined) continue;
    setNode(netItem(doc, nets[trace.net] ?? []), value);
  }
  return out;
}

const sub = (a: GridPoint, b: GridPoint): GridPoint => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: GridPoint, b: GridPoint): GridPoint => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: GridPoint, k: number): GridPoint => ({ x: a.x * k, y: a.y * k });
const unit = (a: GridPoint): GridPoint => {
  const length = Math.hypot(a.x, a.y);
  return length === 0 ? { x: 0, y: 0 } : scale(a, 1 / length);
};
const lerp = (a: GridPoint, b: GridPoint, t: number): GridPoint => add(a, scale(sub(b, a), t));

/** Side of a point a text goes to when it is pushed away along `direction`. */
function sideOf(direction: GridPoint): OperatingPointLabel["side"] {
  if (Math.abs(direction.x) >= Math.abs(direction.y)) return direction.x >= 0 ? "right" : "left";
  return direction.y >= 0 ? "below" : "above";
}

/**
 * Side of a two-pin component away from its caption: the caption is right of a vertical symbol
 * and above a horizontal one (see `captions.ts`), the values go left or below.
 */
function freeSide(a: GridPoint, b: GridPoint): GridPoint {
  return a.x === b.x ? { x: -1, y: 0 } : { x: 0, y: 1 };
}

/** Distance between a component's axis and the arrow of its voltage, in grid units. */
const VOLTAGE_OFFSET = 1;
/** Distance between an arrow and its value, in grid units. */
const TEXT_GAP = 0.15;

/**
 * Current arrow of each two-pin component: a head on the lead of its first pin, in the actual
 * direction of the current, with the value without sign beside it (on the side away from the
 * caption). A positive SPICE current goes from the first pin to the second through the component.
 */
export function currentArrows(doc: EditorDoc, result: SimulationResult): ValueArrow[] {
  if (result.analysis !== "op") return [];
  const arrows: ValueArrow[] = [];
  for (const trace of result.traces ?? []) {
    const value = trace.values[0];
    if (trace.kind !== "current" || !trace.component_id || value === undefined) continue;
    const c = doc.components.find((x) => x.id === trace.component_id);
    const [first, second] = c ? getDef(c.type).pins : [];
    if (!c || !first || !second || getDef(c.type).pins.length !== 2) continue;
    const p1 = pinPosition(c, first.name);
    const p2 = pinPosition(c, second.name);
    const inward = unit(sub(p2, p1));
    const outer = add(p1, scale(inward, 0.2));
    const inner = add(p1, scale(inward, 0.9));
    const [from, to] = value >= 0 ? [outer, inner] : [inner, outer];
    const side = freeSide(p1, p2);
    arrows.push({
      key: `i:${c.id}`,
      kind: "current",
      from,
      to,
      label: {
        key: `i:${c.id}`,
        kind: "current",
        text: formatSI(Math.abs(value), "A"),
        position: add(lerp(outer, inner, 0.5), scale(side, TEXT_GAP + 0.15)),
        side: sideOf(side),
      },
    });
  }
  return arrows;
}

/** Pins between which a transistor's main voltage is shown, and its name. */
const MAIN_VOLTAGE: Record<string, { plus: string; minus: string; away: string; name: string }> = {
  npn: { plus: "C", minus: "E", away: "B", name: "V_CE" },
  pnp: { plus: "C", minus: "E", away: "B", name: "V_CE" },
  nmos: { plus: "D", minus: "S", away: "G", name: "V_DS" },
  pmos: { plus: "D", minus: "S", away: "G", name: "V_DS" },
};
/** Its control voltage, shown in the detail only. */
const CONTROL_VOLTAGE: Record<string, { plus: string; minus: string; away: string; name: string }> =
  {
    npn: { plus: "B", minus: "E", away: "C", name: "V_BE" },
    pnp: { plus: "B", minus: "E", away: "C", name: "V_BE" },
    nmos: { plus: "G", minus: "S", away: "D", name: "V_GS" },
    pmos: { plus: "G", minus: "S", away: "D", name: "V_GS" },
  };

/**
 * Voltage arrow between pins `plus` and `minus` of `c`: along them, shortened, moved aside by
 * `offset` (away from `away`, a point the text must not cover), pointing at the more positive pin.
 * `name` prefixes the value ("V_CE = 4,3 V"). Null if a potential is unknown.
 */
function voltageArrow(
  c: PlacedComponent,
  pins: { plus: string; minus: string; name?: string },
  potentials: ReadonlyMap<string, number>,
  side: GridPoint,
): ValueArrow | null {
  const vPlus = potentials.get(pinKey(c.id, pins.plus));
  const vMinus = potentials.get(pinKey(c.id, pins.minus));
  if (vPlus === undefined || vMinus === undefined) return null;
  const u = vPlus - vMinus;
  const a = pinPosition(c, pins.plus);
  const b = pinPosition(c, pins.minus);
  const shift = scale(side, VOLTAGE_OFFSET);
  const nearPlus = add(lerp(a, b, 0.2), shift);
  const nearMinus = add(lerp(a, b, 0.8), shift);
  const [from, to] = u >= 0 ? [nearMinus, nearPlus] : [nearPlus, nearMinus];
  const text = formatSI(Math.abs(u), "V");
  const key = `u:${c.id}:${pins.plus}-${pins.minus}`;
  return {
    key,
    kind: "voltage",
    from,
    to,
    label: {
      key,
      kind: "voltage",
      text: pins.name ? `${pins.name} = ${text}` : text,
      position: add(lerp(nearPlus, nearMinus, 0.5), scale(side, TEXT_GAP)),
      side: sideOf(side),
    },
  };
}

/** Unit vector across segment [a, b], on the side away from point `p`. */
function awayFrom(a: GridPoint, b: GridPoint, p: GridPoint): GridPoint {
  const d = unit(sub(b, a));
  const normal = { x: -d.y, y: d.x };
  const toP = sub(p, lerp(a, b, 0.5));
  return normal.x * toP.x + normal.y * toP.y > 0 ? scale(normal, -1) : normal;
}

/**
 * Voltage arrows of the operating point: V_CE (or V_DS) of every transistor, always; and for the
 * components of `detail` (hovered or selected), the voltage across a two-pin component, or V_BE
 * (V_GS) of a transistor. Nothing for a component whose pin potentials are unknown.
 */
export function voltageArrows(
  doc: EditorDoc,
  result: SimulationResult,
  nets: Record<string, string[]>,
  detail: ReadonlySet<string> = new Set(),
): ValueArrow[] {
  if (result.analysis !== "op") return [];
  const potentials = pinPotentials(doc, result, nets);
  const arrows: ValueArrow[] = [];
  for (const c of doc.components) {
    const main = MAIN_VOLTAGE[c.type];
    const pins = getDef(c.type).pins;
    if (main) {
      const side = awayFrom(
        pinPosition(c, main.plus),
        pinPosition(c, main.minus),
        pinPosition(c, main.away),
      );
      const arrow = voltageArrow(c, main, potentials, side);
      if (arrow) arrows.push(arrow);
      const control = CONTROL_VOLTAGE[c.type];
      if (control && detail.has(c.id)) {
        const side = awayFrom(
          pinPosition(c, control.plus),
          pinPosition(c, control.minus),
          pinPosition(c, control.away),
        );
        const arrow = voltageArrow(c, control, potentials, side);
        if (arrow) arrows.push(arrow);
      }
      continue;
    }
    const [first, second] = pins;
    if (!detail.has(c.id) || pins.length !== 2 || !first || !second) continue;
    if (c.type === "ground" || c.type === "label") continue;
    const side = freeSide(pinPosition(c, first.name), pinPosition(c, second.name));
    const arrow = voltageArrow(c, { plus: first.name, minus: second.name }, potentials, side);
    if (arrow) arrows.push({ ...arrow, ...pushedAside(arrow, side) });
  }
  return arrows;
}

/**
 * A two-pin component's voltage arrow moved further aside than its current value, whose text
 * lies along the same side near the first pin.
 */
function pushedAside(
  arrow: ValueArrow,
  side: GridPoint,
): Pick<ValueArrow, "from" | "to" | "label"> {
  const extra = scale(side, 0.4);
  return {
    from: add(arrow.from, extra),
    to: add(arrow.to, extra),
    label: { ...arrow.label, position: add(arrow.label.position, extra) },
  };
}
