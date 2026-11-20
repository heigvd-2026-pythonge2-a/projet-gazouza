import { useEffect, useState } from "react";

import { getHealth } from "./api/client";
import { Inspector, Palette, SchematicCanvas, StatusBar } from "./editor";
import {
  DEFAULT_SIZES,
  MaximizeButton,
  Splitter,
  clampPaletteWidth,
  clampSideWidth,
  inspectorHeight,
  useElementSize,
  type PanelSizes,
} from "./layout";
import { useEditorStore } from "./store";

/** Panel shown in full screen; the schematic keeps the palette beside it to stay editable. */
type Maximized = "schematic" | "results" | null;

const BORDER = "1px solid #e5e7eb";

// App shell, layout "C" chosen in issue #3: palette | schematic | results above the inspector.
export default function App() {
  const [backend, setBackend] = useState("connexion…");
  const [sizes, setSizes] = useState<PanelSizes>(DEFAULT_SIZES);
  const [rowRef, row] = useElementSize<HTMLDivElement>();
  const [columnRef, column] = useElementSize<HTMLDivElement>();

  // Stored sizes are what the user asked for; clamp them to what fits the window right now.
  const paletteWidth = clampPaletteWidth(sizes.paletteWidth);
  const sideWidth = clampSideWidth(sizes.sideWidth, row.width, paletteWidth);
  const inspector = inspectorHeight(sizes.inspectorFraction, column.height);
  const update = (patch: Partial<PanelSizes>) => setSizes((s) => ({ ...s, ...patch }));

  const [maximized, setMaximized] = useState<Maximized>(null);
  const toggle = (panel: Exclude<Maximized, null>) =>
    setMaximized((m) => (m === panel ? null : panel));
  // Hidden panels stay mounted (display: none) so they keep their state (zoom, selection, curves).
  const shown = (visible: boolean) => (visible ? "flex" : "none");
  const normal = maximized === null;

  // Escape leaves full screen, unless the editor uses it (placing a component, drawing a wire).
  useEffect(() => {
    if (normal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      if (useEditorStore.getState().tool.kind !== "select") return;
      // Capture phase + stop: the editor must not also see it (it would clear the selection).
      e.stopPropagation();
      setMaximized(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [normal]);

  useEffect(() => {
    getHealth()
      .then((health) => setBackend(health.status))
      .catch(() => setBackend("injoignable"));
  }, []);

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: 13,
        color: "#1f2937",
        background: "#ffffff",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          height: 30,
          flex: "none",
          padding: "0 12px",
          background: "#1f2937",
          color: "#e5e7eb",
          fontSize: 12,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 13, color: "#ffffff" }}>Psice</h1>
        <span style={{ marginLeft: "auto" }}>Backend : {backend}</span>
      </header>

      <div
        role="toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flex: "none",
          padding: "6px 10px",
          borderBottom: BORDER,
        }}
      >
        {/* Wired to POST /api/simulate in a later PR (simulation panel). */}
        <button
          type="button"
          disabled
          title="Bientôt disponible"
          style={{
            padding: "5px 12px",
            border: "1px solid #16a34a",
            borderRadius: 5,
            background: "#16a34a",
            color: "#ffffff",
            fontWeight: 600,
            font: "inherit",
            opacity: 0.5,
            cursor: "not-allowed",
          }}
        >
          ▶ Simuler
        </button>
      </div>

      <div ref={rowRef} style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ display: shown(maximized !== "results"), width: paletteWidth, flex: "none" }}>
          <Palette />
        </div>
        {maximized !== "results" && (
          <Splitter
            orientation="vertical"
            label="Redimensionner la palette"
            value={paletteWidth}
            direction={1}
            onChange={(w) => update({ paletteWidth: clampPaletteWidth(w) })}
            onReset={() => update({ paletteWidth: DEFAULT_SIZES.paletteWidth })}
          />
        )}
        <div
          style={{
            display: shown(maximized !== "results"),
            flex: 1,
            minWidth: 0,
            position: "relative",
          }}
        >
          <SchematicCanvas />
          <div style={{ position: "absolute", top: 8, right: 8 }}>
            <MaximizeButton
              panel="le schéma"
              maximized={maximized === "schematic"}
              onClick={() => toggle("schematic")}
            />
          </div>
        </div>
        {normal && (
          <Splitter
            orientation="vertical"
            label="Redimensionner le panneau de droite"
            value={sideWidth}
            direction={-1}
            onChange={(w) => update({ sideWidth: clampSideWidth(w, row.width, paletteWidth) })}
            onReset={() => update({ sideWidth: DEFAULT_SIZES.sideWidth })}
          />
        )}
        <div
          ref={columnRef}
          style={{
            display: shown(maximized !== "schematic"),
            flexDirection: "column",
            ...(maximized === "results"
              ? { flex: 1, minWidth: 0 }
              : { width: sideWidth, flex: "none" }),
          }}
        >
          {/* Slot for the plot module (src/plot). */}
          <section aria-label="Résultats" style={{ flex: 1, minHeight: 0, padding: "8px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <b>Résultats</b>
              <MaximizeButton
                panel="les résultats"
                maximized={maximized === "results"}
                onClick={() => toggle("results")}
              />
            </div>
            <p style={{ color: "#6b7280" }}>Les courbes s'afficheront ici après une simulation.</p>
          </section>
          {normal && (
            <Splitter
              orientation="horizontal"
              label="Redimensionner les propriétés"
              value={inspector}
              direction={-1}
              onChange={(h) => {
                if (column.height <= 0) return;
                const clamped = inspectorHeight(h / column.height, column.height);
                update({ inspectorFraction: clamped / column.height });
              }}
              onReset={() => update({ inspectorFraction: DEFAULT_SIZES.inspectorFraction })}
            />
          )}
          <div style={{ display: shown(normal), height: inspector, flex: "none" }}>
            <Inspector />
          </div>
        </div>
      </div>

      <StatusBar />
    </main>
  );
}
