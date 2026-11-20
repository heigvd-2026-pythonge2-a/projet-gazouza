// What the palette shows, in order, and the digit key of each tool. Shared by the palette (which
// draws the digits) and the keyboard shortcuts of the canvas, so both always agree.

import { paletteGroups, type Category, type ComponentDef } from "../store";

/** A palette tile: place a library component, or draw wires. */
export type PaletteEntry = { kind: "place"; def: ComponentDef } | { kind: "wire" };

export interface PaletteGroup {
  id: Category;
  label: string;
  entries: PaletteEntry[];
}

/** Palette groups in display order; the wire tool closes the "Connexions" group. */
export function paletteLayout(): PaletteGroup[] {
  return paletteGroups().map((g) => ({
    id: g.id,
    label: g.label,
    entries: [
      ...g.defs.map((def): PaletteEntry => ({ kind: "place", def })),
      ...(g.id === "connection" ? [{ kind: "wire" } as const] : []),
    ],
  }));
}

/** Digit key of the entry at this position in the palette (0-based), if it has one. */
export const shortcutKey = (position: number): string | undefined =>
  position < 9 ? String(position + 1) : undefined;

/** Palette entry chosen by a digit key ("1" to "9"), in the order the palette shows them. */
export function entryForKey(key: string): PaletteEntry | undefined {
  const entries = paletteLayout().flatMap((g) => g.entries);
  return entries.find((_, i) => shortcutKey(i) === key);
}
