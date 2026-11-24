import { useEffect, useState, type CSSProperties } from "react";

import { getHealth } from "./api/client";
import {
  AnimateButton,
  EditorToolbar,
  Inspector,
  Palette,
  SHOW_INSPECTOR_EVENT,
  SchematicCanvas,
  SimulationControls,
  SimulationReport,
  StatusBar,
  saveRescueCopy,
} from "./editor";
import {
  DEFAULT_LAYOUT,
  MaximizeButton,
  PanelErrorBoundary,
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

/** How long the full screen waits, once the properties panel lost the focus, to come back (#95). */
const FULL_SCREEN_RETURN_MS = 3000;

// App shell, layout "C" chosen in issue #3: palette | schematic | results above the inspector.
// The results can also go under the schematic; the layout is remembered between launches. The
// results only show once there is something to show (#96), the properties can be closed (#164).
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
  /**
   * The schematic left full screen only to show the properties (#95): it comes back once the
   * user is done with them (the focus left the panel a while ago, or Escape there), unless they
   * left full screen themselves meanwhile.
   */
  const [returnPending, setReturnPending] = useState(false);
  const [focusInInspector, setFocusInInspector] = useState(false);
  /** Counts the requests for the properties: each one gives the user time again. */
  const [inspectorRequests, setInspectorRequests] = useState(0);
  /** The user changes the full screen themselves: no automatic return any more. */
  const setFullScreen = (m: Maximized) => {
    setReturnPending(false);
    setMaximized(m);
  };
  const toggle = (panel: Exclude<Maximized, null>) =>
    setFullScreen(maximized === panel ? null : panel);
  const returnToFullScreen = () => setFullScreen("schematic");

  useEffect(() => {
    if (!returnPending || focusInInspector) return;
    const timer = window.setTimeout(() => {
      setReturnPending(false);
      setMaximized("schematic");
    }, FULL_SCREEN_RETURN_MS);
    return () => window.clearTimeout(timer);
  }, [returnPending, focusInInspector, inspectorRequests]);

  // Hidden panels stay mounted (display: none) so they keep their state (zoom, selection, curves).
  // Exception: moving the results between right and bottom remounts them.
  const shown = (visible: boolean) => (visible ? "flex" : "none");
  const normal = maximized === null;
  const showSchematic = maximized !== "results";
  const resultsShown = maximized === "results" || (normal && layout.resultsVisible);
  const inspectorShown = normal && layout.inspectorVisible;
  const sideShown = right ? resultsShown || inspectorShown : inspectorShown;

  // The editor asks for the properties panel (double-click on a component, "Propriétés…"): show
  // it, leaving full screen for as long as the user edits there.
  useEffect(() => {
    const onShowInspector = () => {
      if (maximized === "schematic") setReturnPending(true);
      setMaximized(null);
      setInspectorRequests((n) => n + 1);
      setLayout((l) => (l.inspectorVisible ? l : { ...l, inspectorVisible: true }));
    };
    window.addEventListener(SHOW_INSPECTOR_EVENT, onShowInspector);
    return () => window.removeEventListener(SHOW_INSPECTOR_EVENT, onShowInspector);
  }, [maximized]);

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

  // The results show at the end of every simulation, even if they were hidden by hand, and hide
  // again for a new or opened schematic (#96).
  useEffect(
    () =>
      useEditorStore.subscribe((s, prev) => {
        const ended =
          (s.simulation !== null && s.simulation !== prev.simulation) ||
          (s.simulationError !== null && s.simulationError !== prev.simulationError);
        const fresh =
          s.doc !== prev.doc &&
          s.history.past.length === 0 &&
          s.history.future.length === 0 &&
          s.simulation === null;
        if (ended || fresh) {
          setLayout((l) => (l.resultsVisible === ended ? l : { ...l, resultsVisible: ended }));
        }
      }),
    [],
  );

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
        <div style={{ display: "flex", gap: 4 }}>
          <MaximizeButton
            panel="les résultats"
            maximized={maximized === "results"}
            onClick={() => toggle("results")}
          />
          <CloseButton
            label="Masquer les résultats"
            onClick={() => {
              setFullScreen(null);
              update({ resultsVisible: false });
            }}
          />
        </div>
      </div>
      <PanelErrorBoundary panel="les résultats">
        <SimulationReport />
      </PanelErrorBoundary>
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
          // A narrow window wraps the groups onto a second line instead of hiding buttons.
          flexWrap: "wrap",
          gap: 6,
          flex: "none",
          padding: "6px 10px",
          borderBottom: BORDER,
        }}
      >
        <PanelErrorBoundary panel="la barre d'outils" onRescue={saveRescueCopy} compact>
          <EditorToolbar />
        </PanelErrorBoundary>
        <PanelErrorBoundary panel="la simulation" compact>
          <SimulationControls />
        </PanelErrorBoundary>
        <AnimateButton style={TOOL_BUTTON} />
        <button
          type="button"
          aria-pressed={layout.resultsVisible}
          title={
            layout.resultsVisible
              ? "Masquer le panneau des résultats"
              : "Afficher le panneau des résultats"
          }
          style={{ ...TOOL_BUTTON, marginLeft: "auto", ...(layout.resultsVisible ? PRESSED : {}) }}
          onClick={() => {
            if (maximized === "results") setFullScreen(null);
            update({ resultsVisible: !layout.resultsVisible });
          }}
        >
          Résultats
        </button>
        <button
          type="button"
          aria-pressed={layout.inspectorVisible}
          title={
            layout.inspectorVisible
              ? "Masquer le panneau des propriétés"
              : "Afficher le panneau des propriétés"
          }
          style={{ ...TOOL_BUTTON, ...(layout.inspectorVisible ? PRESSED : {}) }}
          onClick={() => update({ inspectorVisible: !layout.inspectorVisible })}
        >
          Propriétés
        </button>
        <button
          type="button"
          title={right ? "Placer les résultats sous le schéma" : "Placer les résultats à droite"}
          style={TOOL_BUTTON}
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
            setFullScreen(null);
          }}
        >
          Réinitialiser la disposition
        </button>
      </div>

      <div ref={rowRef} style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ display: shown(showSchematic), width: paletteWidth, flex: "none" }}>
          <PanelErrorBoundary panel="la palette">
            <Palette />
          </PanelErrorBoundary>
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
            <PanelErrorBoundary panel="le schéma" onRescue={saveRescueCopy}>
              <SchematicCanvas />
            </PanelErrorBoundary>
            <div style={{ position: "absolute", top: 8, right: 8 }}>
              <MaximizeButton
                panel="le schéma"
                maximized={maximized === "schematic"}
                onClick={() => toggle("schematic")}
              />
            </div>
          </div>
          {!right && normal && resultsShown && (
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
              display: resultsShown ? "block" : "none",
              ...(normal ? { height: results, flex: "none" } : { flex: 1, minHeight: 0 }),
            })}
        </div>
        {normal && sideShown && (
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
            display: shown(sideShown),
            flexDirection: "column",
            ...(maximized === "results"
              ? { flex: 1, minWidth: 0 }
              : { width: sideWidth, flex: "none" }),
          }}
        >
          {right &&
            resultsPanel({ display: resultsShown ? "block" : "none", flex: 1, minHeight: 0 })}
          {right && resultsShown && inspectorShown && (
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
            // While full screen waits (#95): back to it once the focus has left for a while, or
            // at once with Escape (after the field has used it to take back the typing).
            onFocus={() => setFocusInInspector(true)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setFocusInInspector(false);
              }
            }}
            onKeyDownCapture={(e) => {
              if (e.key === "Escape" && returnPending) window.setTimeout(returnToFullScreen);
            }}
            style={{
              display: shown(inspectorShown),
              position: "relative",
              ...(right && resultsShown
                ? { height: inspector, flex: "none" }
                : { flex: 1, minHeight: 0 }),
            }}
          >
            <PanelErrorBoundary panel="les propriétés" onRescue={saveRescueCopy}>
              <Inspector />
            </PanelErrorBoundary>
            <div style={{ position: "absolute", top: 6, right: 8 }}>
              <CloseButton
                label="Masquer les propriétés"
                onClick={() => update({ inspectorVisible: false })}
              />
            </div>
          </div>
        </div>
      </div>

      <PanelErrorBoundary panel="la barre d'état" compact>
        <StatusBar />
      </PanelErrorBoundary>
    </main>
  );
}

/** Look of a toggle button of the toolbar while it is on. */
const PRESSED: CSSProperties = { background: "#eff6ff", color: "#2563eb", borderColor: "#bfdbfe" };

/** Small × button in a panel's corner, to hide the panel. */
function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      style={{
        display: "grid",
        placeItems: "center",
        width: 24,
        height: 24,
        padding: 0,
        border: BORDER,
        borderRadius: 5,
        background: "#ffffff",
        color: "#4b5563",
        cursor: "pointer",
        fontSize: 16,
        lineHeight: 1,
      }}
    >
      ×
    </button>
  );
}
