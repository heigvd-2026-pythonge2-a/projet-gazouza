import { useEffect, useState } from "react";

import { getHealth } from "./api/client";
import { Editor } from "./editor";

// App shell. The plots (src/plot) will be mounted next to the editor.
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
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 16,
          padding: "4px 12px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <h1 style={{ fontSize: 18, margin: 0 }}>Psice</h1>
        <p style={{ fontSize: 12, margin: 0 }}>Backend : {backend}</p>
      </header>
      <Editor />
    </main>
  );
}
