// LEDs on the schematic (#294): their colour comes from the model chosen (the "Couleur"
// parameter), and after a simulation they light up, brighter as their forward current grows.

import type { SimulationResult } from "../api/client";
import { componentCurrents } from "./currents";
import type { EditorDoc } from "./document";

/** Display colour of each LED model; the colours of #293 are ready for when it lands. */
const LED_COLORS: Record<string, string> = {
  D_LED_RED: "#ef4444",
  D_LED_GREEN: "#22c55e",
  D_LED_YELLOW: "#eab308",
  D_LED_BLUE: "#3b82f6",
  // Light grey rather than white, so it stays visible on the light theme.
  D_LED_WHITE: "#cbd5e1",
};

/** Colour of an LED with these parameters; an unknown model is drawn red, the default one. */
export function ledColor(params: Readonly<Record<string, string>>): string {
  return LED_COLORS[params.model ?? ""] ?? (LED_COLORS.D_LED_RED as string);
}

/** Forward current under which an LED looks off, and from which it is fully lit, in amperes. */
export const LED_DIM_CURRENT = 1e-4;
export const LED_FULL_CURRENT = 20e-3;

/**
 * How lit an LED is, from 0 (off) to 1, for a current from anode to cathode (A, SPICE sign): on a
 * logarithmic scale, as the eye sees brightness, from ~0.1 mA to ~20 mA. Off in reverse.
 */
export function ledIntensity(current: number): number {
  if (!(current > LED_DIM_CURRENT)) return 0;
  if (current >= LED_FULL_CURRENT) return 1;
  return Math.log(current / LED_DIM_CURRENT) / Math.log(LED_FULL_CURRENT / LED_DIM_CURRENT);
}

/**
 * Intensity of each LED of `doc` (id -> 0..1) for a result, at time `t` of a transient one. An LED
 * the result gives no current for is left out.
 */
export function ledIntensities(
  doc: EditorDoc,
  result: SimulationResult,
  t = 0,
): Map<string, number> {
  const currents = componentCurrents(result, t);
  const out = new Map<string, number>();
  for (const c of doc.components) {
    if (c.type !== "led") continue;
    const current = currents.get(c.id);
    if (current !== undefined) out.set(c.id, ledIntensity(current));
  }
  return out;
}
