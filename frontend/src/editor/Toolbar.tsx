import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { isUnsaved, useEditorStore, useThemeStore } from "../store";
import {
  exportImage,
  exportTransparent,
  newFile,
  openFile,
  saveFile,
  saveFileAs,
  setExportTransparent,
} from "./fileActions";
import { exportNetlist } from "./simulationActions";
import { COLORS, UI } from "./theme";
import { fitView, zoomIn, zoomOut } from "./viewCommands";

const SOON = "Bientôt disponible";

/** Outline icons drawn on a 16×16 grid, in the button's text colour. */
const ICONS = {
  new: "M4 1.5h5.5l3 3v10H4z M9.5 1.5v3h3",
  open: "M1.5 3.5h4.5l1.5 1.5h7v8.5h-13z",
  save: "M2.5 2.5h9l2 2v9h-11z M5 2.5v3.5h5V2.5 M5 13.5v-4h6v4",
  saveAs: "M2.5 2.5h9l2 2v3 M2.5 2.5v11h5 M5 2.5v3.5h5V2.5 M9.5 13.5l4-4 1 1-4 4h-1z",
  import: "M8 1.5v8 M5 6.5l3 3 3-3 M2.5 10.5v3h11v-3",
  export: "M8 9.5v-8 M5 4.5l3-3 3 3 M2.5 10.5v3h11v-3",
  netlist: "M3.5 1.5h6l3 3v10h-9z M5.5 7.5h5 M5.5 9.5h5 M5.5 11.5h3",
  undo: "M5.5 3.5l-3 3 3 3 M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7",
  redo: "M10.5 3.5l3 3-3 3 M13.5 6.5H6a3.5 3.5 0 0 0 0 7h3",
  delete: "M2.5 4h11 M6 4V2.5h4V4 M4 4l.8 9.5h6.4L12 4 M6.8 6.5V11 M9.2 6.5V11",
  rotate: "M13 8a5 5 0 1 1-1.5-3.5 M13 2v3h-3",
  mirror: "M8 1.5v13 M6 4.5l-4 7.5h4z M10 4.5l4 7.5h-4z",
  copy: "M5.5 5.5h8v8h-8z M10.5 5.5v-3h-8v8h3",
  paste: "M5 2.5H2.5v12h11v-12H11 M5.5 1.5h5v2.5h-5z",
  duplicate: "M2.5 2.5h8v8h-8z M13.5 5.5v8h-8 M6.5 4.5v4 M4.5 6.5h4",
  zoomIn: "M7 2.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z M10.2 10.2l3.8 3.8 M5 7h4 M7 5v4",
  zoomOut: "M7 2.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z M10.2 10.2l3.8 3.8 M5 7h4",
  fit: "M2 5.5V2h3.5 M10.5 2H14v3.5 M14 10.5V14h-3.5 M5.5 14H2v-3.5",
  moon: "M13.5 9.5A6 6 0 1 1 6.5 2.5a4.8 4.8 0 0 0 7 7z",
  sun: "M8 5a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M8 1v1.5 M8 13.5V15 M1 8h1.5 M13.5 8H15 M3 3l1 1 M12 12l1 1 M3 13l1-1 M12 4l1-1",
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" style={{ display: "block" }}>
      <path
        d={ICONS[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Icon button. `label` is its tooltip and accessible name, and says the keyboard shortcut; a
 * disabled button keeps its tooltip so the user learns why (or that it is coming).
 */
function ToolButton(props: {
  label: string;
  icon: keyof typeof ICONS;
  disabled?: boolean;
  /** Small dot on the button, e.g. unsaved changes on "Enregistrer". */
  badge?: boolean;
  /** Set for a button that opens a panel: whether it is open. */
  expanded?: boolean;
  onClick?: () => void;
}) {
  const { label, icon, disabled = false, badge = false, expanded, onClick } = props;
  return (
    // The wrapper shows the tooltip even when the button is disabled (no mouse events then).
    <span title={label} style={{ display: "inline-flex", position: "relative" }}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        aria-haspopup={expanded === undefined ? undefined : "dialog"}
        aria-expanded={expanded}
        onClick={onClick}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 26,
          padding: 0,
          border: `1px solid ${UI.border}`,
          borderRadius: 5,
          background: expanded ? UI.activeBackground : UI.surface,
          color: COLORS.text,
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? "default" : "pointer",
        }}
      >
        <Icon name={icon} />
      </button>
      {badge && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            width: 6,
            height: 6,
            borderRadius: 3,
            background: COLORS.highlight,
            pointerEvents: "none",
          }}
        />
      )}
    </span>
  );
}

/**
 * "Exporter" button: opens a small panel with the export options (transparent background, #195)
 * and the button that asks where to save the PNG. Closes on Escape or a press outside it.
 */
function ExportButton() {
  const [open, setOpen] = useState(false);
  const [transparent, setTransparent] = useState(exportTransparent);
  const ref = useRef<HTMLSpanElement>(null);
  const checkbox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    checkbox.current?.focus();
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // The editor's shortcuts must not also see the keys typed in the panel.
    e.stopPropagation();
    if (e.key === "Escape") setOpen(false);
  };

  const run = () => {
    setOpen(false);
    void exportImage({ transparent });
  };

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <ToolButton
        label="Exporter le schéma en image PNG…"
        icon="export"
        expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div
          role="dialog"
          aria-label="Exporter en image PNG"
          onKeyDown={onKeyDown}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 20,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            width: 230,
            padding: 10,
            background: UI.surface,
            border: `1px solid ${UI.border}`,
            borderRadius: 6,
            boxShadow: `0 4px 12px ${UI.shadow}`,
            fontSize: 13,
            color: COLORS.symbol,
          }}
        >
          <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
            <input
              ref={checkbox}
              type="checkbox"
              checked={transparent}
              onChange={(e) => {
                setTransparent(e.target.checked);
                setExportTransparent(e.target.checked);
              }}
              style={{ margin: "2px 0 0" }}
            />
            <span>
              Fond transparent
              <span style={{ display: "block", fontSize: 12, color: UI.muted }}>
                Pour poser le schéma sur n'importe quel fond, dans un rapport. Sinon, fond blanc.
              </span>
            </span>
          </label>
          <button
            type="button"
            onClick={run}
            style={{
              alignSelf: "flex-end",
              padding: "4px 10px",
              border: `1px solid ${COLORS.selected}`,
              borderRadius: 5,
              background: COLORS.selected,
              color: UI.onAccent,
              font: "inherit",
              cursor: "pointer",
            }}
          >
            Exporter…
          </button>
        </div>
      )}
    </span>
  );
}

/** Buttons of one kind of action, separated from the next group by a thin line. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        display: "flex",
        gap: 3,
        paddingRight: 8,
        marginRight: 2,
        borderRight: `1px solid ${UI.border}`,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Editor buttons of the app toolbar: file, edit and view actions. Each one does the same as its
 * keyboard shortcut and is greyed out when it cannot apply (nothing selected, nothing to undo…).
 */
export function EditorToolbar() {
  const unsaved = useEditorStore(isUnsaved);
  const canUndo = useEditorStore((s) => s.history.past.length > 0);
  const canRedo = useEditorStore((s) => s.history.future.length > 0);
  const hasSelection = useEditorStore((s) => s.selection.length > 0);
  const canDelete = useEditorStore(
    (s) => s.selection.length > 0 || s.wirePart !== null || s.segments.length > 0,
  );
  // Turning applies to the selected components, or to the one about to be placed.
  const canTurn = useEditorStore(
    (s) =>
      s.tool.kind === "place" ||
      s.selection.some((id) => s.doc.components.some((c) => c.id === id)),
  );
  const canPaste = useEditorStore((s) => s.clipboard !== null);
  const dark = useThemeStore((t) => t.theme === "dark");
  const s = useEditorStore.getState;

  return (
    <>
      <Group label="Fichier">
        <ToolButton label="Nouveau schéma (Ctrl+N)" icon="new" onClick={newFile} />
        <ToolButton label="Ouvrir un schéma (Ctrl+O)" icon="open" onClick={openFile} />
        <ToolButton
          label={
            unsaved
              ? "Enregistrer le schéma (Ctrl+S) — modifications non enregistrées"
              : "Enregistrer le schéma (Ctrl+S)"
          }
          icon="save"
          badge={unsaved}
          onClick={() => saveFile()}
        />
        <ToolButton label="Enregistrer sous… (Ctrl+Maj+S)" icon="saveAs" onClick={saveFileAs} />
        <ToolButton label={`Importer un fichier LTspice (.asc) — ${SOON}`} icon="import" disabled />
        <ExportButton />
        <ToolButton
          label="Exporter la netlist SPICE (.cir), avec l'analyse choisie"
          icon="netlist"
          onClick={() => void exportNetlist()}
        />
      </Group>
      <Group label="Édition">
        <ToolButton
          label="Annuler (Ctrl+Z)"
          icon="undo"
          disabled={!canUndo}
          onClick={() => s().undo()}
        />
        <ToolButton
          label="Rétablir (Ctrl+Y)"
          icon="redo"
          disabled={!canRedo}
          onClick={() => s().redo()}
        />
        <ToolButton
          label="Supprimer (Suppr)"
          icon="delete"
          disabled={!canDelete}
          onClick={() => s().deleteSelection()}
        />
        <ToolButton
          label="Tourner (R)"
          icon="rotate"
          disabled={!canTurn}
          onClick={() => s().rotate()}
        />
        <ToolButton
          label="Miroir (M)"
          icon="mirror"
          disabled={!canTurn}
          onClick={() => s().mirror()}
        />
        <ToolButton
          label="Copier (Ctrl+C)"
          icon="copy"
          disabled={!hasSelection}
          onClick={() => s().copy()}
        />
        <ToolButton
          label="Coller (Ctrl+V)"
          icon="paste"
          disabled={!canPaste}
          onClick={() => s().paste()}
        />
        <ToolButton
          label="Dupliquer (Ctrl+D)"
          icon="duplicate"
          disabled={!hasSelection}
          onClick={() => s().duplicate()}
        />
      </Group>
      <Group label="Vue">
        <ToolButton label="Zoom avant (molette)" icon="zoomIn" onClick={zoomIn} />
        <ToolButton label="Zoom arrière (molette)" icon="zoomOut" onClick={zoomOut} />
        <ToolButton label="Ajuster la vue au circuit (F)" icon="fit" onClick={fitView} />
        <ToolButton
          label={dark ? "Passer au thème clair" : "Passer au thème bleu nuit"}
          icon={dark ? "sun" : "moon"}
          onClick={() => useThemeStore.getState().toggle()}
        />
      </Group>
    </>
  );
}
