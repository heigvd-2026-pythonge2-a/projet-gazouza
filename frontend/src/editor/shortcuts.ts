// Every mouse gesture and keyboard shortcut of the editor, shown in the shortcuts panel of the
// status bar. Texts in French. Keep in sync with the handlers in `Editor.tsx`.

export interface Shortcut {
  keys: string;
  action: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Fichier",
    items: [
      { keys: "Ctrl+N", action: "Nouveau schéma" },
      { keys: "Ctrl+O", action: "Ouvrir un schéma" },
      { keys: "Ctrl+S", action: "Enregistrer le schéma" },
    ],
  },
  {
    title: "Sélection",
    items: [
      { keys: "Clic", action: "Sélectionner" },
      { keys: "Maj + clic", action: "Ajouter ou retirer de la sélection" },
      {
        keys: "Glisser dans le vide",
        action: "Sélectionner ce qui est entièrement dans la zone (tronçons de fil compris)",
      },
      {
        keys: "Maj + glisser dans le vide",
        action: "Ajouter ce qui touche la zone, retirer ce qui était déjà sélectionné",
      },
      { keys: "Ctrl+A", action: "Tout sélectionner" },
      { keys: "Échap", action: "Vider la sélection" },
    ],
  },
  {
    title: "Modifier",
    items: [
      { keys: "Glisser", action: "Déplacer la sélection (les fils suivent)" },
      { keys: "Ctrl + glisser", action: "Déplacer sans que les fils suivent" },
      { keys: "Flèches", action: "Déplacer la sélection d'un pas" },
      { keys: "R", action: "Tourner" },
      { keys: "M", action: "Miroir" },
      { keys: "Suppr", action: "Supprimer" },
      { keys: "Ctrl+C / Ctrl+V", action: "Copier / coller (avec de nouveaux noms)" },
      { keys: "Ctrl+D", action: "Dupliquer la sélection" },
      { keys: "Clic (après coller ou dupliquer)", action: "Poser la copie qui suit la souris" },
      { keys: "Ctrl+Z / Ctrl+Y", action: "Annuler / rétablir" },
      { keys: "Double-clic sur un composant", action: "Changer sa valeur sur le schéma" },
      { keys: "Clic droit sur un composant", action: "Menu des actions" },
    ],
  },
  {
    title: "Composants",
    items: [
      { keys: "1 à 8", action: "Choisir l'outil de la palette" },
      { keys: "Clic (outil composant)", action: "Poser le composant" },
      { keys: "Échap ou clic droit", action: "Arrêter de poser" },
    ],
  },
  {
    title: "Fils",
    items: [
      { keys: "W, ou tirer depuis une broche", action: "Tracer un fil" },
      { keys: "Clic (outil fil)", action: "Coude, ou fin du fil sur une broche ou un fil" },
      { keys: "Double-clic (outil fil)", action: "Finir le fil dans le vide" },
      { keys: "Échap (outil fil)", action: "Enlever le dernier coude" },
      { keys: "Clic sur un fil", action: "Sélectionner un coude ou un tronçon, à glisser" },
      { keys: "Double-clic sur un fil", action: "Sélectionner le fil entier" },
      {
        keys: "Suppr (coude / tronçon)",
        action: "Supprimer le fil entier / couper le fil à cet endroit",
      },
    ],
  },
  {
    title: "Vue",
    items: [
      { keys: "Molette", action: "Zoom" },
      { keys: "F", action: "Ajuster la vue au circuit" },
      { keys: "Clic droit ou molette maintenus", action: "Déplacer la vue" },
    ],
  },
  {
    title: "Aide",
    items: [{ keys: "?", action: "Afficher ou masquer cette liste" }],
  },
];
