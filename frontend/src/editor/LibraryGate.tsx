import { useCallback, useEffect, useState, type ReactNode } from "react";

import { isLibraryLoaded, loadLibrary } from "../store";

type Status = "loading" | "ready" | "error";

const screenStyle = {
  position: "fixed",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  fontFamily: '"Segoe UI", system-ui, sans-serif',
  fontSize: 13,
  color: "#1f2937",
} as const;

/**
 * Shows its children once the component library has come from the backend (GET /api/library).
 * Every part of the editor needs it (palette, symbols, files), so nothing is shown before.
 */
export function LibraryGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(() => (isLibraryLoaded() ? "ready" : "loading"));

  // The status only changes once the request is over (the first render already says "loading").
  const fetchLibrary = useCallback(() => {
    loadLibrary().then(
      () => setStatus("ready"),
      () => setStatus("error"),
    );
  }, []);

  useEffect(fetchLibrary, [fetchLibrary]);

  const retry = () => {
    setStatus("loading");
    fetchLibrary();
  };

  if (status === "ready") return <>{children}</>;
  if (status === "loading") {
    return (
      <main style={screenStyle} aria-busy="true">
        <p>Chargement de la bibliothèque de composants…</p>
      </main>
    );
  }
  return (
    <main style={screenStyle}>
      <p role="alert">
        Impossible de charger la bibliothèque de composants : le simulateur ne répond pas.
      </p>
      <button type="button" onClick={retry}>
        Réessayer
      </button>
    </main>
  );
}
