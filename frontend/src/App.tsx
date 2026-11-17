import { useEffect, useState } from "react";

import { getHealth } from "./api/client";

// Placeholder shell. The editor (src/editor) and plots (src/plot) will be mounted here.
export default function App() {
  const [backend, setBackend] = useState("connexion…");

  useEffect(() => {
    getHealth()
      .then((health) => setBackend(health.status))
      .catch(() => setBackend("injoignable"));
  }, []);

  return (
    <main>
      <h1>Psice</h1>
      <p>Backend : {backend}</p>
    </main>
  );
}
