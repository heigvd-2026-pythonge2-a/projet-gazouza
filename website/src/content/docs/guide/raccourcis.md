---
title: Raccourcis clavier
description: Tous les gestes de souris et raccourcis clavier de l'éditeur de Psice.
---

Dans Psice, appuie sur <kbd>?</kbd> (ou clique sur **Raccourcis (?)** dans la barre d'état) pour
afficher cette liste à tout moment.

## Fichier

| Raccourci | Action |
|---|---|
| <kbd>Ctrl+N</kbd> | Nouveau schéma |
| <kbd>Ctrl+O</kbd> | Ouvrir un schéma |
| <kbd>Ctrl+S</kbd> | Enregistrer le schéma |

## Sélection

| Geste | Action |
|---|---|
| Clic | Sélectionner |
| <kbd>Maj</kbd> + clic | Ajouter ou retirer de la sélection |
| Glisser dans le vide | Sélectionner ce qui est entièrement dans la zone (tronçons de fil compris) |
| <kbd>Maj</kbd> + glisser dans le vide | Ajouter ce qui touche la zone, retirer ce qui était déjà sélectionné |
| <kbd>Ctrl+A</kbd> | Tout sélectionner |
| <kbd>Échap</kbd> | Vider la sélection |

## Modifier

| Geste | Action |
|---|---|
| Glisser | Déplacer la sélection (les fils suivent) |
| <kbd>Ctrl</kbd> + glisser | Déplacer sans que les fils suivent |
| Flèches | Déplacer la sélection d'un pas |
| <kbd>R</kbd> | Tourner |
| <kbd>M</kbd> | Miroir |
| <kbd>Suppr</kbd> | Supprimer |
| <kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd> | Copier / coller (avec de nouveaux noms) |
| <kbd>Ctrl+D</kbd> | Dupliquer la sélection |
| Clic (après coller ou dupliquer) | Poser la copie qui suit la souris |
| <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> | Annuler / rétablir |
| Clic droit sur un composant | Menu des actions |

## Composants

| Geste | Action |
|---|---|
| <kbd>1</kbd> à <kbd>8</kbd> | Choisir l'outil de la palette |
| Clic (outil composant) | Poser le composant |
| <kbd>Échap</kbd> ou clic droit | Arrêter de poser |

## Fils

| Geste | Action |
|---|---|
| <kbd>W</kbd>, ou tirer depuis une broche | Tracer un fil |
| Clic (outil fil) | Coude, ou fin du fil sur une broche ou un fil |
| Double-clic (outil fil) | Finir le fil dans le vide |
| <kbd>Échap</kbd> (outil fil) | Enlever le dernier coude |
| Clic sur un fil | Sélectionner un coude ou un tronçon, à glisser |
| Double-clic sur un fil | Sélectionner le fil entier |

## Vue

| Geste | Action |
|---|---|
| Molette | Zoom |
| <kbd>F</kbd> | Ajuster la vue au circuit |
| Clic droit ou molette maintenus | Déplacer la vue |

:::tip[Pour les développeurs]
Cette liste est la copie de `frontend/src/editor/shortcuts.ts`, qui alimente le panneau
<kbd>?</kbd> de l'application. Si tu ajoutes un raccourci, mets les deux à jour.
:::
