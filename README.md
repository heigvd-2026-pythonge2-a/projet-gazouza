# Psice 

Simulateur de circuits électroniques inspiré de LTspice, avec une interface moderne
et ngspice comme moteur de simulation.

Projet de groupe de 2ᵉ année — HEIG-VD.

> ⚠️ Projet en cours de démarrage : ce README décrit les objectifs et l'architecture prévue.

---

## Objectifs

- Dessiner un schéma électronique dans un éditeur graphique (composants, fils, masse).
- Simuler le circuit avec **ngspice** : point de fonctionnement (.op) et temporel (.tran) en priorité MVP (analyses AC et balayage DC prévues en phase « Important »).
- Afficher les résultats avec une **sonde interactive** : cliquer sur un fil affiche sa tension,
  cliquer sur un composant affiche son courant.
- Livrer une **application Windows** lançable d'un double-clic, sans installation.

### Fonctionnalités prévues

| Priorité | Fonctionnalité |
|---|---|
| MVP | Éditeur de schéma : placement, rotation, fils, grille, zoom |
| MVP | Composants de base : R, C, L, sources de tension et de courant (DC, PULSE, SIN), masse |
| MVP | Génération de netlist SPICE et simulation via ngspice |
| MVP | Visualiseur de courbes avec sonde interactive |
| MVP | Sauvegarde et ouverture des schémas |
| Important | Diodes, amplis-op, transistors (BJT, MOSFET), modèles `.model` / `.subckt` |
| Important | Analyses AC (diagramme de Bode) et DC, balayage de paramètres |
| Important | Animation du courant sur le schéma, annuler / rétablir, copier-coller |
| Important | Import des schémas LTspice (.asc) (restreint aux composants supportés du périmètre) |
| Important | Mesures sur les courbes (crête, moyenne, temps de montée) et export (PNG, CSV, netlist) |
| Bonus | FFT d'une courbe temporelle |

---

## Architecture

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

- Le **frontend** ne fait que l'affichage et l'édition. Toute la logique de simulation est dans le backend.
- Le **contrat d'API** (format du schéma et résultats) est défini en Python avec Pydantic.
  Les types TypeScript du front sont générés à partir du schéma OpenAPI de FastAPI
  (`openapi-typescript`), pour que les deux côtés restent synchronisés.
- Tout tourne **en local** : aucun hébergement nécessaire.

### Stack technique

| Partie | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite, Konva (ou SVG), uPlot, Zustand (géré avec **pnpm**) |
| Backend | Python 3, FastAPI, Pydantic, NumPy / SciPy (géré avec **uv**) |
| Simulation | ngspice (binaires Windows inclus dans le projet) |
| Application | pywebview (fenêtre native), PyInstaller (packaging) |
| Qualité | pytest, ESLint, GitHub Actions |

---

## Structure du repo

```
projet-gazouza/
├── backend/
│   ├── app/
│   │   ├── api/          routes FastAPI
│   │   ├── models/       modèles Pydantic (contrat d'API)
│   │   ├── netlist/      génération de netlist SPICE
│   │   ├── importers/    import .asc LTspice
│   │   └── engines/      intégration ngspice
│   ├── vendor/ngspice/   binaires ngspice Windows
│   ├── launcher.py       démarre le serveur et ouvre la fenêtre
│   ├── tests/
│   ├── pyproject.toml
│   └── uv.lock
├── frontend/
│   ├── src/
│   │   ├── editor/       éditeur de schéma
│   │   ├── plot/         courbes et sondes
│   │   ├── store/        état de l'application, annuler/rétablir
│   │   └── api/          client vers le backend
│   ├── package.json
│   └── pnpm-lock.yaml
├── build.ps1             build complet → application Windows
└── README.md
```

---

## Développement

### Prérequis

- Windows 10 ou 11
- Python 3.12+ & **uv** (`powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`)
- Node.js 20+ & **pnpm** (`corepack enable` ou `npm install -g pnpm`)
- ngspice placé dans `backend/vendor/ngspice/` *(procédure à compléter)*

### Lancer en mode développement

```powershell
# Terminal 1 — backend
cd backend
uv sync
uv run uvicorn app.main:app --reload

# Terminal 2 — frontend
cd frontend
pnpm install
pnpm dev
```

Puis ouvrir http://localhost:5173.

### Tests

```powershell
cd backend
uv run pytest
```

---

## Build de l'application Windows

```powershell
.\build.ps1
```

Le script :
1. compile le frontend (`pnpm build`) ;
2. copie le résultat dans le backend ;
3. lance PyInstaller avec ngspice et le front inclus (`uv run pyinstaller ...`).

Résultat : `dist/Psice/Psice.exe`, à distribuer sous forme de dossier zippé.
Aucune installation n'est nécessaire sur la machine cible.

> Au premier lancement, Windows SmartScreen peut afficher un avertissement car l'exécutable
> n'est pas signé : cliquer sur « Informations complémentaires » puis « Exécuter quand même ».

---

## Organisation

4 personnes, environ 90 h chacune.

- **Antoine Bezençon** (chef de projet)
- Damien Bignens
- Noé Guenin 
- Noémi Voélin

| Rôle | Responsabilité | Personne |
|---|---|---|
| Éditeur de schéma | Canvas, placement, fils, sélection, zoom, annuler/rétablir | *à définir* |
| Courbes et sondes | Visualiseur, sonde interactive, curseurs, mesures | *à définir* |
| Bibliothèque et netlist | Composants, modèles SPICE, génération de netlist, import `.asc`, API | *à définir* |
| Simulation | Intégration ngspice, analyses, packaging | *à définir* |

### Jalons

| Semaines | Objectif |
|---|---|
| S1–2 | Repo, CI, contrat d'API, ngspice validé sur toutes les machines, prototype netlist → courbe |
| S3–5 | Éditeur basique de bout en bout : dessiner un circuit RC et le simuler |
| S6–8 | Analyses AC et DC, sonde interactive, diodes, amplis-op et transistors, sauvegarde |
| S9–10 | Import `.asc`, annuler/rétablir, mesures et export |
| S11–12 | Tests, stabilisation, build final, rapport et démo |

---

## Licence

Ce projet est distribué sous les termes de la **licence MIT**. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

### Logiciels tiers et dépendances

Psice intègre ou utilise des composants externes soumis à leurs propres licences :
- **ngspice** (inclus dans les binaires Windows) : distribué sous licence **BSD 3-Clause**. Les mentions de copyright et les termes de la licence ngspice doivent être conservés lors de la distribution.
- **Dépendances logicielles** : Les bibliothèques tierces (écosystèmes Python et Node.js, `pywebview`, etc.) sont régies par leurs licences respectives (MIT, Apache-2.0, ISC, etc.).