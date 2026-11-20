import { useEffect, useState } from "react";

import { getHealth } from "./api/client";
import { Inspector, Palette, SchematicCanvas, StatusBar } from "./editor";

const BORDER = "1px solid #e5e7eb";

// App shell, layout "C" chosen in issue #3: palette | schematic | results above the inspector.
export default function App() {
  const [backend, setBackend] = useState("connexion…");

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

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Palette />
        <SchematicCanvas />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 440,
            flex: "none",
            borderLeft: BORDER,
          }}
        >
          {/* Slot for the plot module (src/plot). */}
          <section aria-label="Résultats" style={{ flex: 1, minHeight: 0, padding: "8px 10px" }}>
            <b>Résultats</b>
            <p style={{ color: "#6b7280" }}>Les courbes s'afficheront ici après une simulation.</p>
          </section>
          <Inspector />
        </div>
      </div>

      <StatusBar />
    </main>
  );
}
