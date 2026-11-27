// SI prefix formatting for axes, cursor readouts and operating-point values.

const PREFIXES: readonly [number, string][] = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
  [1e-9, "n"],
  [1e-12, "p"],
];

/** Units that are never scaled with SI metric prefixes (e.g. decibels, degrees). */
const NO_PREFIX_UNITS = new Set(["dB", "°"]);

/** Pick the SI prefix and scale factor for `value` (returns `1, ""` for zero). */
function pickPrefix(value: number): [number, string] {
  const abs = Math.abs(value);
  if (abs === 0 || !Number.isFinite(abs)) return [1, ""];
  return PREFIXES.find(([scale]) => abs >= scale * 0.999999) ?? [1e-12, "p"];
}

/**
 * Format a numeric value with an appropriate SI prefix (unless the unit is `dB` or `°`),
 * e.g. `1,25 ms`, `-5 mA`, `-3,01 dB`, or `-45°`.
 * Uses `fr-CH` number formatting to match the rest of the application.
 */
export function formatSI(value: number, unit: string, maxFractionDigits = 3): string {
  if (!Number.isFinite(value)) return "—";
  if (NO_PREFIX_UNITS.has(unit)) {
    const clean = Object.is(value, -0) ? 0 : value;
    const formatted = clean.toLocaleString("fr-CH", { maximumFractionDigits: maxFractionDigits });
    return unit === "°" ? `${formatted}°` : `${formatted} ${unit}`;
  }
  if (value === 0) return unit ? `0 ${unit}` : "0";
  const [scale, prefix] = pickPrefix(value);
  const scaled = value / scale;
  const formatted = scaled.toLocaleString("fr-CH", {
    maximumFractionDigits: maxFractionDigits,
  });
  return unit ? `${formatted} ${prefix}${unit}` : `${formatted}${prefix}`;
}

/** Format a signed difference (`Δ`), prefixing positive values with `+`. */
export function formatSignedSI(value: number, unit: string, maxFractionDigits = 3): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return formatSI(0, unit, maxFractionDigits);
  const body = formatSI(value, unit, maxFractionDigits);
  return value > 0 ? `+${body}` : body;
}

/**
 * Format a compact tick label for chart axes (keeps tick labels short so they do not overlap).
 */
export function formatAxisTick(value: number, unit: string): string {
  return formatSI(value, unit, 2);
}
