import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { unconnectedPins, useEditorStore, type Tool } from "../store";
import { SHORTCUT_GROUPS } from "./shortcuts";
import { COLORS, UI } from "./theme";

/** Main gestures of the active tool; the full list is in the shortcuts panel. */
const HINTS: Record<Tool["kind"], string> = {
  select:
    "Clic : sélectionner · Glisser : déplacer · R : tourner · Suppr : supprimer · F : ajuster la vue",
  place: "Clic : poser · R : tourner · M : miroir · Échap : arrêter",
  wire: "Clic : coude ou fin du fil · Double-clic : finir dans le vide · Échap : dernier coude",
};

/** Panel listing every shortcut, above the status bar. Escape or a click outside closes it. */
function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Close the panel only: the editor's Escape would also clear the selection.
      e.stopPropagation();
      onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (ref.current?.contains(target) || target?.closest("[data-shortcuts-toggle]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Raccourcis"
      style={{
        position: "fixed",
        right: 8,
        bottom: 30,
        zIndex: 20,
        width: 420,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "70vh",
        overflowY: "auto",
        padding: "10px 14px",
        background: "#ffffff",
        border: `1px solid ${UI.border}`,
        borderRadius: 6,
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
        fontSize: 12,
        color: COLORS.text,
        whiteSpace: "normal",
      }}
    >
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title}>
          <h4 style={{ ...UI.heading, margin: "8px 0 4px" }}>{group.title}</h4>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 11em) 1fr",
              gap: "2px 12px",
              margin: 0,
            }}
          >
            {group.items.map((item) => (
              <Fragment key={item.keys}>
                <dt style={{ fontWeight: 600 }}>{item.keys}</dt>
                <dd style={{ margin: 0 }}>{item.action}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/**
 * Bottom bar: main shortcuts of the active tool, what is selected, and a button (or the ? key)
 * that shows every shortcut.
 */
export function StatusBar() {
  const [help, setHelp] = useState(false);
  const closeHelp = useCallback(() => setHelp(false), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      setHelp((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const tool = useEditorStore((s) => s.tool);
  const doc = useEditorStore((s) => s.doc);
  const selection = useEditorStore((s) => s.selection);
  const wirePart = useEditorStore((s) => s.wirePart);

  const unconnected = useMemo(() => unconnectedPins(doc).length, [doc]);

  let selected = "";
  if (wirePart) {
    selected = wirePart.kind === "bend" ? "Sélection : coude de fil" : "Sélection : tronçon de fil";
  } else if (selection.length === 1) {
    const c = doc.components.find((x) => x.id === selection[0]);
    selected = c ? `Sélection : ${c.name ?? c.params.net ?? "masse"}` : "Sélection : fil";
  } else if (selection.length > 1) {
    selected = `${selection.length} éléments sélectionnés`;
  }

  return (
    <footer
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        height: 24,
        flex: "none",
        padding: "0 10px",
        fontSize: 11,
        color: UI.muted,
        background: UI.panel,
        borderTop: `1px solid ${UI.border}`,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{HINTS[tool.kind]}</span>
      <span style={{ marginLeft: "auto" }}>{selected}</span>
      {unconnected > 0 && (
        <span
          title="Ces broches sont marquées en rouge sur le schéma : reliez-les avant de simuler."
          style={{ color: UI.error }}
        >
          {unconnected === 1 ? "1 broche non connectée" : `${unconnected} broches non connectées`}
        </span>
      )}
      <button
        type="button"
        data-shortcuts-toggle
        aria-expanded={help}
        title="Tous les raccourcis (touche ?)"
        onClick={() => setHelp((open) => !open)}
        style={{
          font: "inherit",
          flex: "none",
          padding: "0 8px",
          height: 18,
          border: `1px solid ${help ? COLORS.selected : UI.border}`,
          borderRadius: 4,
          background: help ? UI.activeBackground : "#ffffff",
          color: help ? COLORS.selected : UI.muted,
          cursor: "pointer",
        }}
      >
        Raccourcis (?)
      </button>
      {help && <ShortcutsPanel onClose={closeHelp} />}
    </footer>
  );
}
