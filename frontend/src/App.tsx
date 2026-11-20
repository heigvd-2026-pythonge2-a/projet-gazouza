import { useEffect, useState, type CSSProperties } from "react";

import { getHealth } from "./api/client";
import { Inspector, Palette, SchematicCanvas, StatusBar } from "./editor";
import {
  DEFAULT_LAYOUT,
  MaximizeButton,
  Splitter,
  clampPaletteWidth,
  clampSideWidth,
  inspectorHeight,
  loadLayout,
  resultsHeight,
  saveLayout,
  useElementSize,
  type Layout,
} from "./layout";
import { useEditorStore } from "./store";

/** Panel shown in full screen; the schematic keeps the palette beside it to stay editable. */
type Maximized = "schematic" | "results" | null;

const BORDER = "1px solid #e5e7eb";

const TOOL_BUTTON: CSSProperties = {
  padding: "4px 10px",
  border: BORDER,
  borderRadius: 5,
  background: "#ffffff",
  color: "#374151",
  font: "inherit",
  fontSize: 12,
  cursor: "pointer",
};

// App shell, layout "C" chosen in issue #3: palette | schematic | results above the inspector.
// The results can also go under the schematic; the layout is remembered between launches.
export default function App() {
  const [backend, setBackend] = useState("connexion…");
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [rowRef, row] = useElementSize<HTMLDivElement>();
  const [centerRef, center] = useElementSize<HTMLDivElement>();
  const [sideRef, side] = useElementSize<HTMLDivElement>();
  const right = layout.resultsPosition === "right";

  useEffect(() => saveLayout(layout), [layout]);

  // Stored sizes are what the user asked for; clamp them to what fits the window right now.
  const paletteWidth = clampPaletteWidth(layout.paletteWidth);
  const sideWidth = clampSideWidth(layout.sideWidth, row.width, paletteWidth);
  const inspector = inspectorHeight(layout.inspectorFraction, side.height);
  const results = resultsHeight(layout.resultsFraction, center.height);
  const update = (patch: Partial<Layout>) => setLayout((l) => ({ ...l, ...patch }));

  const [maximized, setMaximized] = useState<Maximized>(null);
  const toggle = (panel: Exclude<Maximized, null>) =>
    setMaximized((m) => (m === panel ? null : panel));
  // Hidden panels stay mounted (display: none) so they keep their state (zoom, selection, curves).
  // Exception: moving the results between right and bottom remounts them.
  const shown = (visible: boolean) => (visible ? "flex" : "none");
  const normal = maximized === null;
  const showSchematic = maximized !== "results";
  const showResults = maximized !== "schematic";

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

  /** Results panel: a slot for the plot module (src/plot). */
  const resultsPanel = (style: CSSProperties) => (
    <section
      aria-label="Résultats"
      style={{ ...style, boxSizing: "border-box", padding: "8px 10px", overflow: "auto" }}
    >
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
  );

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
        <button
          type="button"
          title={right ? "Placer les résultats sous le schéma" : "Placer les résultats à droite"}
          style={{ ...TOOL_BUTTON, marginLeft: "auto" }}
          onClick={() => update({ resultsPosition: right ? "bottom" : "right" })}
        >
          Résultats : {right ? "à droite" : "en bas"}
        </button>
        <button
          type="button"
          title="Revenir à la disposition et aux tailles par défaut"
          style={TOOL_BUTTON}
          onClick={() => {
            setLayout(DEFAULT_LAYOUT);
            setMaximized(null);
          }}
        >
          Réinitialiser la disposition
        </button>
      </div>

      <div ref={rowRef} style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ display: shown(showSchematic), width: paletteWidth, flex: "none" }}>
          <Palette />
        </div>
        {showSchematic && (
          <Splitter
            orientation="vertical"
            label="Redimensionner la palette"
            value={paletteWidth}
            direction={1}
            onChange={(w) => update({ paletteWidth: clampPaletteWidth(w) })}
            onReset={() => update({ paletteWidth: DEFAULT_LAYOUT.paletteWidth })}
          />
        )}
        {/* Centre column. The schematic stays its first child, so it is never remounted. */}
        <div
          ref={centerRef}
          style={{
            display: shown(showSchematic || !right),
            flexDirection: "column",
            flex: 1,
            minWidth: 0,
          }}
        >
          <div
            style={{ display: shown(showSchematic), flex: 1, minHeight: 0, position: "relative" }}
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
          {!right && normal && (
            <Splitter
              orientation="horizontal"
              label="Redimensionner les résultats"
              value={results}
              direction={-1}
              onChange={(h) => {
                if (center.height <= 0) return;
                const clamped = resultsHeight(h / center.height, center.height);
                update({ resultsFraction: clamped / center.height });
              }}
              onReset={() => update({ resultsFraction: DEFAULT_LAYOUT.resultsFraction })}
            />
          )}
          {!right &&
            resultsPanel({
              display: showResults ? "block" : "none",
              ...(normal ? { height: results, flex: "none" } : { flex: 1, minHeight: 0 }),
            })}
        </div>
        {normal && (
          <Splitter
            orientation="vertical"
            label="Redimensionner le panneau de droite"
            value={sideWidth}
            direction={-1}
            onChange={(w) => update({ sideWidth: clampSideWidth(w, row.width, paletteWidth) })}
            onReset={() => update({ sideWidth: DEFAULT_LAYOUT.sideWidth })}
          />
        )}
        {/* Side column. The inspector stays its last child, so it is never remounted. */}
        <div
          ref={sideRef}
          style={{
            display: shown(right ? showResults : normal),
            flexDirection: "column",
            ...(maximized === "results"
              ? { flex: 1, minWidth: 0 }
              : { width: sideWidth, flex: "none" }),
          }}
        >
          {/* Hidden with its column when the schematic is in full screen, but still mounted. */}
          {right && resultsPanel({ flex: 1, minHeight: 0 })}
          {right && normal && (
            <Splitter
              orientation="horizontal"
              label="Redimensionner les propriétés"
              value={inspector}
              direction={-1}
              onChange={(h) => {
                if (side.height <= 0) return;
                const clamped = inspectorHeight(h / side.height, side.height);
                update({ inspectorFraction: clamped / side.height });
              }}
              onReset={() => update({ inspectorFraction: DEFAULT_LAYOUT.inspectorFraction })}
            />
          )}
          <div
            style={{
              display: shown(normal),
              ...(right ? { height: inspector, flex: "none" } : { flex: 1, minHeight: 0 }),
            }}
          >
            <Inspector />
          </div>
        </div>
      </div>

      <StatusBar />
    </main>
  );
}
