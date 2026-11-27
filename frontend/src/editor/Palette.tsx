import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { useEditorStore } from "../store";
import { WIRE_LABEL, paletteLayout, searchPalette, type PaletteEntry } from "./paletteLayout";
import { SymbolIcon } from "./SymbolIcon";
import { COLORS, UI } from "./theme";

/** dataTransfer type of a component dragged from the palette; the value is its library type. */
export const DRAG_TYPE = "application/x-psice-component";

const tileStyle = (active: boolean): CSSProperties => ({
  font: "inherit",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  padding: "6px 2px 4px",
  border: `1px solid ${active ? COLORS.selected : UI.border}`,
  borderRadius: 6,
  background: active ? UI.activeBackground : UI.surface,
  color: active ? COLORS.selected : COLORS.symbol,
  lineHeight: 1.2,
  textAlign: "center",
  cursor: "pointer",
  position: "relative",
});

const keyStyle: CSSProperties = {
  position: "absolute",
  top: 2,
  left: 4,
  fontSize: 10,
  color: UI.muted,
};

function Tile(props: {
  label: string;
  active: boolean;
  onClick: () => void;
  dragType?: string;
  /** Digit key that picks this tool. */
  shortcut?: string;
  children: ReactNode;
}) {
  const { label, active, onClick, dragType, shortcut, children } = props;
  const help = dragType ? `${label} : glisser sur le schéma, ou cliquer puis poser` : label;
  return (
    <button
      type="button"
      title={shortcut ? `${help} (touche ${shortcut})` : help}
      aria-keyshortcuts={shortcut}
      style={tileStyle(active)}
      onClick={onClick}
      draggable={dragType !== undefined}
      onDragStart={(e) => {
        if (!dragType) return;
        e.dataTransfer.setData(DRAG_TYPE, dragType);
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      {shortcut && (
        <span style={keyStyle} aria-hidden>
          {shortcut}
        </span>
      )}
      {children}
      <span style={{ fontSize: 11 }}>{label}</span>
    </button>
  );
}

/** Wire tool icon: a wire with a bend. */
function WireIcon() {
  return (
    <svg width={32} height={32} viewBox="0 0 32 32" fill="none" stroke="currentColor" aria-hidden>
      <polyline points="4,22 14,22 14,10 28,10" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

/**
 * Narrowest tile, in pixels: the panel shows as many columns as fit (#331), two at its default
 * width as before, three or more when it is widened.
 */
export const TILE_MIN_WIDTH = 54;

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_MIN_WIDTH}px, 1fr))`,
  gap: 6,
};

const groupTitleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  width: "100%",
  margin: "10px 0 4px",
  padding: 0,
  border: "none",
  background: "none",
  font: "inherit",
  fontSize: 11,
  fontWeight: 600,
  color: UI.muted,
  textAlign: "left",
  cursor: "pointer",
};

/** Where the folded groups of the palette are kept between launches (#331). */
export const COLLAPSED_GROUPS_KEY = "psice.palette.collapsed";

/** The groups folded last time (unreadable: none). */
function loadCollapsed(): Set<string> {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((g) => typeof g === "string") : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(groups: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...groups]));
  } catch {
    // Storage full or refused: the groups stay folded until the window closes.
  }
}

/** Chevron of a group title: pointing down when the group is open, right when it is folded. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      aria-hidden
      style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 0.1s" }}
    >
      <polyline points="3,1 7,5 3,9" fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

const searchStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  padding: "5px 8px",
  border: `1px solid ${UI.inputBorder}`,
  borderRadius: 5,
  background: UI.surface,
  color: "inherit",
  font: "inherit",
};

/** True for Ctrl+F (Cmd+F on a Mac), the shortcut of the search field. */
const isSearchShortcut = (e: KeyboardEvent) =>
  (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f";

/**
 * Component palette, grouped by category (`category` in the library): one tile per library
 * type, to drag onto the schematic or click. The wire tool closes the "Connexions" group. Keys 1
 * to 9 pick the tiles in order (see `paletteLayout`). The search field above (Ctrl+F) narrows it
 * to the components whose name matches (#276); Enter picks the first one. A click on the title
 * of a group folds it or opens it again, and the folded groups are remembered (#331); while
 * searching, every group with a result is open. The digit keys keep their tiles, folded or not.
 */
export function Palette() {
  const tool = useEditorStore((s) => s.tool);
  const startPlacing = useEditorStore((s) => s.startPlacing);
  const startWiring = useEditorStore((s) => s.startWiring);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const searchRef = useRef<HTMLInputElement>(null);
  const groups = searchPalette(paletteLayout(), query);
  const searching = query.trim() !== "";

  const toggleGroup = (id: string) => {
    const next = new Set(collapsed);
    if (!next.delete(id)) next.add(id);
    setCollapsed(next);
    saveCollapsed(next);
  };

  const pick = (entry: PaletteEntry) => {
    if (entry.kind === "wire") startWiring();
    else startPlacing(entry.def.type);
  };

  // Ctrl+F goes to the search field from anywhere, instead of the browser's find bar.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <aside
      style={{
        // Sized by the app shell (resizable column).
        flex: 1,
        minWidth: 0,
        padding: 8,
        background: UI.panel,
        overflowY: "auto",
      }}
    >
      <h3 style={UI.heading}>Composants</h3>
      <input
        ref={searchRef}
        type="search"
        value={query}
        placeholder="Rechercher (Ctrl+F)"
        aria-label="Rechercher un composant"
        aria-keyshortcuts="Control+F"
        title="Filtrer les composants par nom. Entrée : choisir le premier, Échap : effacer"
        spellCheck={false}
        style={searchStyle}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const first = groups[0]?.entries[0];
            if (!first) return;
            e.preventDefault();
            pick(first.entry);
            // Back to the schematic: R, M, Escape... act on the tool again.
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            if (query) setQuery("");
            else e.currentTarget.blur();
          }
        }}
      />
      {groups.length === 0 && (
        <p role="status" style={{ fontSize: 12, color: UI.muted, marginTop: 8 }}>
          Aucun composant
        </p>
      )}
      {groups.map((group) => {
        const open = searching || !collapsed.has(group.id);
        const panel = `palette-group-${group.id}`;
        return (
          <section key={group.id} aria-label={group.label}>
            <h4 style={{ margin: 0 }}>
              <button
                type="button"
                style={groupTitleStyle}
                aria-expanded={open}
                aria-controls={panel}
                title={open ? "Replier ce groupe" : "Déplier ce groupe"}
                onClick={() => toggleGroup(group.id)}
              >
                <Chevron open={open} />
                {group.label}
              </button>
            </h4>
            <div id={panel} style={gridStyle} hidden={!open}>
              {group.entries.map(({ entry, shortcut }) =>
                entry.kind === "wire" ? (
                  <Tile
                    key="wire"
                    label={WIRE_LABEL}
                    active={tool.kind === "wire"}
                    onClick={startWiring}
                    shortcut={shortcut}
                  >
                    <WireIcon />
                  </Tile>
                ) : (
                  <Tile
                    key={entry.def.type}
                    label={entry.def.label}
                    active={tool.kind === "place" && tool.type === entry.def.type}
                    onClick={() => startPlacing(entry.def.type)}
                    dragType={entry.def.type}
                    shortcut={shortcut}
                  >
                    <SymbolIcon def={entry.def} />
                  </Tile>
                ),
              )}
            </div>
          </section>
        );
      })}
      <p style={{ fontSize: 12, color: UI.muted, marginTop: 8 }}>Glisser sur le schéma</p>
    </aside>
  );
}
