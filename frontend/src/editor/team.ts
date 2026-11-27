// The authors of Psice and the shortcut that summons them (#363), shown by TeamDialog.tsx.

export const REPOSITORY_URL = "https://github.com/heigvd-2026-pythonge2-a/projet-gazouza";

/** The authors and what each one built, in the order of the issue. Texts in French. */
export const TEAM: readonly { name: string; role: string }[] = [
  { name: "Noé Guenin", role: "Éditeur de schéma, site web, gestion du dépôt" },
  { name: "Noémi Voélin", role: "Courbes et mesures" },
  { name: "Damien Bignens", role: "Format du schéma, bibliothèque, netlist et import LTspice" },
  { name: "Antoine Bezençon", role: "Moteur ngspice, application de bureau et build" },
];

/** Ctrl+Shift+E (Cmd on macOS), the shortcut that summons the team. */
export function isTeamShortcut(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "e";
}
