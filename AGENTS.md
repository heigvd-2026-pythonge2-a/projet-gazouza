# Instructions pour les agents IA — Psice

Ce fichier est lu par tous les assistants IA de l'équipe (Claude Code via `CLAUDE.md`, Codex,
Cursor, Copilot…). Il complète le [README](README.md) et le
[cahier des charges](cahier-des-charges-psice.md), qui font foi pour le périmètre.

## Le projet en bref

Simulateur de circuits pour débutants. Frontend React + TypeScript (éditeur de schéma, courbes)
affiché dans pywebview ; backend Python FastAPI (netlist SPICE, ngspice embarqué). Tout tourne
en local sous Windows.

## Qui possède quoi

Chaque tâche appartient à un module. **Ne modifie pas un module qui n'est pas celui de la tâche.**
Si c'est nécessaire, arrête-toi et signale-le à l'humain (il en parlera au propriétaire).

| Chemin | Propriétaire |
|---|---|
| `frontend/src/editor/`, `frontend/src/store/` | Noé Guenin |
| `frontend/src/plot/` | Noémi Voélin |
| `backend/app/models/`, `netlist/`, `importers/`, `api/` | Damien Bignens |
| `backend/app/engines/`, `backend/vendor/ngspice/`, `launcher.py`, `build.ps1` | Antoine Bezençon |
| `shared/fixtures/` | Tous (chaque fichier a un producteur, voir `shared/fixtures/README.md`) |
| `frontend/src/api/client.ts`, `frontend/src/App.tsx`, CI, configs racine | À coordonner en équipe |

## Règles importantes

1. **Le contrat d'API est sacré.** `backend/app/models/` définit le format de tous les échanges.
   Ne le modifie jamais en passant au milieu d'une autre tâche. Une modification du contrat =
   une PR dédiée, relue par les modules qui consomment ce format. Après une modification :
   `uv run python scripts/export_openapi.py` (dans `backend/`) puis `pnpm gen:api` (dans
   `frontend/`), et mettre à jour `shared/fixtures/`.
2. **Ne modifie jamais les fichiers générés** : `shared/openapi.json`,
   `frontend/src/api/schema.gen.ts`, `uv.lock`, `pnpm-lock.yaml` (ceux-ci changent uniquement
   via les commandes ci-dessus ou `uv add` / `pnpm add`).
3. **Pas de nouvelle dépendance sans le dire.** Si tu en as besoin, propose-la à l'humain avec
   la raison, ne l'ajoute pas d'office.
4. **Développe contre les fixtures.** Pas besoin d'attendre les autres modules : utilise
   `shared/fixtures/*` comme entrées et sorties de référence, et dans les tests.
5. **Tests obligatoires** pour le code Python (`backend/tests/`). La CI exige 80 % de couverture.
6. **Petites PR**, une par tâche, sur une branche `type/description-courte`
   (ex. `feat/netlist-resistor`, `fix/plot-zoom`). Jamais de push direct sur `main`.
7. Ne fais pas de refactoring ou de reformatage hors du périmètre de la tâche.

## Conventions

- **Langue** : code, identifiants, commentaires et docstrings en anglais ; documentation
  (`*.md`) et textes affichés à l'utilisateur en français.
- **Commits** : [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`), message court en anglais.
- **Labels** : toute issue ou PR reçoit un label `type:` et un label `area:` (liste et usage
  dans la section « Issues et labels » du [README](README.md)).
- **Unités** : valeurs numériques en SI (`float`) dans le contrat ; les suffixes SPICE (`1k`,
  `10u`) ne servent que pour les paramètres saisis par l'utilisateur.
- **Formatage** : ruff (Python) et Prettier (TS). Ne discute pas le style, lance l'outil.
- **Fins de ligne** : LF partout (géré par `.gitattributes`), sauf `.ps1` / `.bat`.

## Commandes

```powershell
# Backend (dans backend/)
uv sync                                       # installer
uv run uvicorn app.main:app --reload          # lancer l'API (port 8000)
uv run pytest                                 # tests
uv run ruff check --fix . ; uv run ruff format .   # lint + formatage
uv run python scripts/export_openapi.py       # régénérer shared/openapi.json

# Frontend (dans frontend/)
pnpm install
pnpm dev                                      # http://localhost:5173 (proxy /api -> 8000)
pnpm lint ; pnpm format                       # lint + formatage
pnpm build                                    # vérification de types + build
pnpm gen:api                                  # régénérer les types depuis shared/openapi.json
```

Avant de considérer une tâche terminée : tests, lint et formatage doivent passer pour la partie
touchée (ce sont les mêmes vérifications que la CI).
