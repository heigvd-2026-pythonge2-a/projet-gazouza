import type { CSSProperties, ReactNode } from "react";

import { useEditorStore } from "../store";
import { paletteLayout, shortcutKey } from "./paletteLayout";
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

const gridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 };

const groupTitleStyle: CSSProperties = {
  margin: "10px 0 4px",
  fontSize: 11,
  fontWeight: 600,
  color: UI.muted,
};

/**
 * Component palette, grouped by category (`category` in the library): one tile per library
 * type, to drag onto the schematic or click. The wire tool closes the "Connexions" group. Keys 1
 * to 9 pick the tiles in order (see `paletteLayout`).
 */
export function Palette() {
  const tool = useEditorStore((s) => s.tool);
  const startPlacing = useEditorStore((s) => s.startPlacing);
  const startWiring = useEditorStore((s) => s.startWiring);
  /** Position of each tile in the whole palette, for its digit key. */
  let position = 0;

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
      {paletteLayout().map((group) => (
        <section key={group.id} aria-label={group.label}>
          <h4 style={groupTitleStyle}>{group.label}</h4>
          <div style={gridStyle}>
            {group.entries.map((entry) => {
              const shortcut = shortcutKey(position++);
              return entry.kind === "wire" ? (
                <Tile
                  key="wire"
                  label="Fil"
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
              );
            })}
          </div>
        </section>
      ))}
      <p style={{ fontSize: 12, color: UI.muted, marginTop: 8 }}>Glisser sur le schéma</p>
    </aside>
  );
}
