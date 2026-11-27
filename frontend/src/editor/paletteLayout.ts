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

/** A palette entry with its digit key, numbered in the whole palette (not in a search result). */
export interface NumberedEntry {
  entry: PaletteEntry;
  shortcut?: string;
}

/** A palette group as shown, possibly narrowed by a search. */
export interface ShownGroup {
  id: Category;
  label: string;
  entries: NumberedEntry[];
}

/** Lower case without accents, so that "resist" finds "Résistance". */
export const foldText = (text: string): string =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Label of the wire tool in the palette. */
export const WIRE_LABEL = "Fil";

/** Texts a search can match for an entry: its label, type, designator and category. */
function searchTexts(entry: PaletteEntry, groupLabel: string): string[] {
  const own =
    entry.kind === "wire"
      ? [WIRE_LABEL, "wire"]
      : [entry.def.label, entry.def.type, entry.def.prefix ?? ""];
  return [...own, groupLabel].map(foldText);
}

/**
 * The palette narrowed to the entries matching `query` (#276): each word of the query must be in
 * the label, type, designator or category of the entry, case and accents ignored. Groups left
 * empty are dropped. Digit keys stay those of the whole palette, as the keyboard uses them.
 */
export function searchPalette(groups: PaletteGroup[], query: string): ShownGroup[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  let position = 0;
  return groups
    .map((g) => ({
      id: g.id,
      label: g.label,
      entries: g.entries
        .map((entry) => ({ entry, shortcut: shortcutKey(position++) }))
        .filter(({ entry }) => {
          const texts = searchTexts(entry, g.label);
          return words.every((w) => texts.some((t) => t.includes(w)));
        }),
    }))
    .filter((g) => g.entries.length > 0);
}

/** Palette entry chosen by a digit key ("1" to "9"), in the order the palette shows them. */
export function entryForKey(key: string): PaletteEntry | undefined {
  const entries = paletteLayout().flatMap((g) => g.entries);
  return entries.find((_, i) => shortcutKey(i) === key);
}
