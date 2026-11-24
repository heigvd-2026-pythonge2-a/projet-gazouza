// Answers of the online demo (`vite build --mode demo`, shown on the website): there is no
// backend there, so the client asks this module instead of calling fetch. The component library
// is the reference fixture, which a backend test keeps equal to the real GET /api/library.
// Only imported in demo mode, so the fixture is not bundled in the app.
import library from "../../../shared/fixtures/library.json";

/** Message shown when the demo is asked for something only the real backend can do. */
export const DEMO_UNAVAILABLE =
  "La démo en ligne ne simule pas les circuits : installez Psice pour simuler les vôtres.";

/** The demo's answer to `method path`, or `undefined` when the demo cannot answer it. */
export function demoAnswer(method: string, path: string): unknown {
  if (method !== "GET") return undefined;
  if (path === "/api/health") return { status: "démo" };
  if (path === "/api/library") return library;
  return undefined;
}
