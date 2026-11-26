---
title: Architecture
description: Comment Psice est construit — frontend React dans pywebview, backend FastAPI, ngspice embarqué.
---

Psice est une **application de bureau** faite de deux parties qui tournent sur la même machine :
une interface web affichée dans une fenêtre native, et un serveur Python local qui fait tout le
travail de simulation.

```
┌──────────────────────────── Fenêtre pywebview ─────────────────────────────┐
│  Frontend React + TypeScript                                               │
│  ┌──────────────────────┐   ┌────────────────────────┐                     │
│  │ Éditeur de schéma    │   │ Courbes + sondes       │                     │
│  │ (Konva / SVG)        │   │ (uPlot)                │                     │
│  └──────────┬───────────┘   └───────────▲────────────┘                     │
└─────────────┼───────────────────────────┼──────────────────────────────────┘
              │  schéma (JSON)            │  résultats (JSON)
              ▼                           │
┌─────────────────────────── Backend Python (FastAPI) ───────────────────────┐
│  netlist/     schéma JSON → netlist SPICE                                  │
│  importers/   import .asc LTspice                                          │
│  engines/     ngspice                                                      │
└────────────────────────────────────────────────────────────────────────────┘
```

## Principes

- Le **frontend** ne fait que l'affichage et l'édition. Toute la logique de simulation est
  dans le backend.
- Le **contrat d'API** (format du schéma et des résultats) est défini **une seule fois**, en
  Python, avec Pydantic. Les types TypeScript du frontend sont **générés** depuis le schéma
  OpenAPI de FastAPI (`openapi-typescript`) : les deux côtés ne peuvent pas diverger.
- Tout tourne **en local** : aucun hébergement, aucune connexion Internet.
- Le backend ne fait **aucun calcul géométrique** : chaque fil dit explicitement à quelle broche
  ou jonction il est accroché. Les coordonnées ne servent qu'à l'affichage.

## Le trajet d'une simulation

1. L'éditeur envoie `{ schematic, analysis }` à `POST /api/simulate`.
2. `netlist/` vérifie le schéma, regroupe les broches en nœuds (union-find), nomme les nœuds et
   écrit la netlist SPICE à partir des modèles de la bibliothèque.
3. `engines/` passe la netlist à ngspice, avec des garde-fous (pas de `.include`, taille et
   durée limitées), puis lit le fichier de résultats.
4. Le frontend reçoit des **traces** (tensions de nœuds, courants de composants) et les affiche ;
   la correspondance `nets` / `components` permet à la sonde de passer d'un clic sur un fil à la
   bonne trace.

## Stack technique

| Partie | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite, Konva (ou SVG), uPlot, Zustand — géré avec **pnpm** |
| Backend | Python 3.12+, FastAPI, Pydantic, NumPy / SciPy — géré avec **uv** |
| Simulation | ngspice, binaires Windows inclus dans le dépôt |
| Application | pywebview (fenêtre native), PyInstaller (packaging) |
| Qualité | pytest, vitest, ruff, ESLint, Prettier, GitHub Actions |
| Site web | Astro + Starlight, déployé sur GitHub Pages |

## Structure du dépôt

```
projet-gazouza/
├── backend/
│   ├── app/
│   │   ├── api/             routes FastAPI
│   │   ├── models/          modèles Pydantic (contrat d'API)
│   │   ├── netlist/         génération de netlist SPICE, bibliothèque de composants
│   │   ├── importers/       import .asc LTspice
│   │   └── engines/         intégration ngspice, lanceur de l'application
│   ├── vendor/ngspice/      binaires ngspice Windows
│   └── tests/
├── frontend/
│   └── src/
│       ├── editor/          éditeur de schéma
│       ├── plot/            courbes et sondes
│       ├── store/           état de l'application, annuler / rétablir
│       ├── layout/          disposition des panneaux
│       └── api/             client vers le backend (types générés)
├── shared/
│   ├── openapi.json         contrat d'API exporté (généré)
│   └── fixtures/            circuits de référence partagés front / back
├── website/                 ce site (Astro Starlight)
├── assets/brand/            sources du logo et des icônes
├── docs/                    documents de conception
└── build.ps1                build complet → application Windows
```

## Qui possède quoi

Chaque module a un propriétaire. Une modification hors de son module se coordonne avec son
propriétaire.

| Chemin | Propriétaire |
|---|---|
| `frontend/src/editor/`, `frontend/src/store/` | Noé Guenin |
| `frontend/src/plot/` | Noémi Voélin |
| `backend/app/models/`, `netlist/`, `importers/`, `api/` | Damien Bignens |
| `backend/app/engines/`, `backend/vendor/ngspice/`, `launcher.py`, `build.ps1` | Antoine Bezençon |
| `shared/fixtures/` | Tous (chaque fichier a un producteur) |
| `website/` | Noé Guenin |
| `.github/` (CI, modèles), configs racine, réglages du dépôt (labels, milestones, règles) | Noé Guenin (gère le dépôt ; changement à annoncer à l'équipe) |
| `frontend/src/api/client.ts`, `frontend/src/App.tsx` | À coordonner en équipe |
