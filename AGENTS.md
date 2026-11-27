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
| `website/` | Noé Guenin |
| `.github/` (CI, modèles), configs racine, réglages du dépôt (labels, milestones, règles) | Noé Guenin (gère le dépôt ; changement à annoncer à l'équipe) |
| `frontend/src/api/client.ts`, `frontend/src/App.tsx` | À coordonner en équipe |

[`.github/CODEOWNERS`](.github/CODEOWNERS) reprend ce tableau : GitHub demande la relecture du
propriétaire sur chaque PR qui touche son module. Garde les deux à jour ensemble.

## Documentation

Ne lis pas toute la documentation : lis seulement celle de la zone que tu vas toucher. Les
fichiers `AGENTS.md` de `backend/`, `frontend/` et `website/` sont chargés automatiquement
quand tu travailles dans ces dossiers. Le reste se lit à la demande :

| Fichier | Contenu | À lire avant de toucher |
|---|---|---|
| [`docs/format-schema.md`](docs/format-schema.md) | Format `.psice.json` (v2), traduction en netlist, erreurs (`Diagnostic`), réponse du backend, questions ouvertes | `backend/app/models/`, `netlist/`, `importers/`, la sérialisation dans `frontend/src/store/` |
| [`docs/exemples-netlist.md`](docs/exemples-netlist.md) | Exemples complets entrée → netlist → réponse, dont un circuit faux | `backend/app/netlist/`, une nouvelle fixture |
| [`shared/fixtures/README.md`](shared/fixtures/README.md) | Circuits de référence et producteur de chaque fichier | `shared/fixtures/`, les tests qui s'en servent |
| [`docs/plan-damien.md`](docs/plan-damien.md) | Plan du backend par phase, décisions à prendre en équipe | une tâche backend, pour savoir ce qui est déjà prévu |
| [`docs/logo.md`](docs/logo.md) | Fichiers, couleurs et animation du logo | une icône, le logo, l'animation de démarrage |

Le site (`website/src/content/docs/`) décrit l'application à l'utilisateur. Quand ta tâche change
ce qu'il décrit, mets la page à jour **dans la même PR** :

| Page | Quand ta tâche change… |
|---|---|
| `guide/composants.md` | un composant, ses broches ou ses paramètres |
| `guide/erreurs.md` | un message d'erreur ou d'avertissement, ou son code |
| `guide/editeur.mdx`, `guide/raccourcis.md` | un geste ou un raccourci de l'éditeur |
| `guide/analyses.mdx`, `guide/courbes-et-sondes.md` | une analyse, le visualiseur, les sondes ou les mesures |
| `guide/valeurs-et-unites.md`, `guide/import-ltspice.md` | la saisie des valeurs, l'import `.asc` |
| `developpeurs/api.md`, `developpeurs/format-schema.md` | une route de l'API, le format de schéma (résumé de `docs/format-schema.md`) |
| `developpeurs/environnement.mdx`, `developpeurs/contribuer.md` | une commande, un outil, une convention de ce fichier |

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
   Côté frontend, la logique pure (`src/store/`, `src/layout/`) est testée avec vitest
   (fichiers `*.test.ts` à côté du code) : ajoute des tests quand tu la modifies.
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
- **Milestones** : chaque jalon du cahier des charges (S1-2 … S11-12) est une milestone
  GitHub. Toute issue ou PR reçoit la milestone du jalon dont elle fait avancer l'objectif
  (par l'objectif, pas par la date) ; une PR reprend celle de l'issue qu'elle ferme. Avec `gh`,
  utilise `--milestone "<titre exact>"` (liste : `gh api repos/{owner}/{repo}/milestones`).
  En cas de doute entre deux jalons, demande à l'humain. Chaque tâche prévue d'un jalon a son
  issue dans la milestone dès le début du jalon, sinon le pourcentage d'avancement est faux.
- **Assignation** : toute issue est assignée dès sa création à la ou aux personnes qui feront
  le travail. Par défaut, c'est le propriétaire du module concerné (tableau « Qui possède
  quoi ») ; si l'issue touche plusieurs modules, assigne chaque propriétaire concerné, et une
  question va à qui doit y répondre. Logins GitHub (aussi dans
  [`.github/CODEOWNERS`](.github/CODEOWNERS)) : Noé Guenin `Guenin04`, Noémi Voélin
  `VOELINNOEMI`, Damien Bignens `Bignensdamien`, Antoine Bezençon `AntoineBezencon`. Avec
  `gh` : `gh issue create --assignee <login>`, ou `gh issue edit <N> --add-assignee <login>`
  (`--remove-assignee` si quelqu'un d'autre reprend la tâche). En cas de doute (`area: shared`,
  tâche d'équipe), demande à l'humain.
- **Releases** : le workflow [`release.yml`](.github/workflows/release.yml) construit
  l'application Windows sur un runner Windows (`build.ps1 -Verify`, qui lance aussi le
  `--self-check` du zip). Il ne tourne ni sur les PR ni sur `main`, seulement :
  - **lancé à la main** (onglet Actions, « Application Windows », « Run workflow ») : il garde
    l'application comme artefact du workflow et ne publie rien. C'est le moyen de tester le
    build avant une livraison ou après un changement de `build.ps1` ;
  - **sur un tag `vX.Y.Z`** poussé (SemVer, `0.x` avant la livraison finale) : il publie
    `Psice.zip` dans la release GitHub du tag. Un suffixe (`v1.0.0-rc.1`) en fait une
    pré-version. Le tag se pose sur un commit de `main` dont la CI est verte
    (`git tag v0.2.0 origin/main ; git push origin v0.2.0`).

  Une release est publique dès que le tag est poussé : annonce-la à l'équipe avant, et ne pousse
  jamais de tag sans l'accord explicite de l'humain.
- **Partir des issues ouvertes** : avant de commencer une tâche, cherche une issue ouverte qui
  la couvre (`gh issue list --state open --search "<mots-clés>"`, ou
  `gh issue list --milestone "<titre>"`). Si elle existe, travaille dessus : mentionne-la à
  l'humain, ferme-la depuis la PR (`Closes #N`) et reprends sa milestone ; si ta tâche n'en
  couvre qu'une partie, écris `Refs #N` et indique ce qui reste. N'ouvre une nouvelle issue que
  si aucune ne correspond, et ne crée jamais de doublon.
- **Statut des issues** : les issues ont un statut GitHub (`Todo`, `In progress`, `In review`,
  `Done`…, onglet « Active » de la liste). Dès qu'une session commence à travailler sur une
  branche qui traite une ou plusieurs issues, passe chacune en `In progress`, avant le premier
  commit, pour que l'équipe voie ce qui est pris. Ensuite, le workflow
  [`issue-status.yml`](.github/workflows/issue-status.yml) s'occupe des issues fermées par la
  PR (`Closes #N`, lu aussi dans la description pour une PR empilée sur une autre branche,
  que GitHub ne relie pas à l'issue) : `In review` quand la PR est ouverte, `In progress` si elle repasse en
  brouillon, `Todo` si elle est fermée sans fusion ; la fusion ferme l'issue et la passe en
  `Done`. Il ne voit pas les issues seulement citées (`Refs #N`) : remets-les en `Todo` toi-même
  si personne ne continue la suite, ou si tu abandonnes la branche avant d'ouvrir une PR.
  `gh issue edit` ne sait pas changer ce statut, il faut passer par l'API :

  ```powershell
  gh api graphql -f query='mutation($i:ID!,$s:ID!){setIssueStatus(input:{issueId:$i,statusId:$s}){clientMutationId}}' -f i=$(gh issue view <N> --json id -q .id) -f s=<statut>
  ```

  avec `<statut>` = `IS_kgAD` (Todo), `IS_kgAE` (In progress) ou `IS_kgAI` (In review). La
  liste complète :
  `gh api graphql -f query='query($o:String!,$r:String!){repository(owner:$o,name:$r){planningStatuses(first:20){nodes{id name}}}}' -f o=heigvd-2026-pythonge2-a -f r=projet-gazouza`.
  Ne mets pas `Done` à la main : c'est la PR fusionnée qui termine l'issue.
- **Modèles d'issue et de PR** : quand tu crées une issue ou une PR (par ex. avec `gh`),
  suis la structure du modèle correspondant et remplis toutes ses sections :
  - issues : `.github/ISSUE_TEMPLATE/` (`1-bug.yml`, `2-feature.yml`, `3-contract.yml`,
    `4-task.yml`, `5-question.yml`). Ce sont des formulaires : avec `gh issue create`,
    reprends leurs champs comme titres `###` dans le corps et pose toi-même les labels
    indiqués dans le modèle, plus le label `area:`, la milestone et l'assignation ;
  - PR : `.github/pull_request_template.md`. Avec `gh pr create --body-file`, pars d'une
    copie de ce fichier, coche la checklist honnêtement (ne coche pas ce qui n'a pas été
    vérifié) et lie l'issue avec `Closes #N`.
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
pnpm test                                     # tests unitaires (vitest)
pnpm test:coverage                            # tests + couverture (rapport dans coverage/)
pnpm lint ; pnpm format                       # lint + formatage
pnpm build                                    # vérification de types + build
pnpm build:demo                               # démo en ligne du site (website/public/demo/)
pnpm gen:api                                  # régénérer les types depuis shared/openapi.json

# Site web et documentation (dans website/)
pnpm install
pnpm dev                                      # http://localhost:4321/projet-gazouza/
pnpm build                                    # build du site statique (Astro)
pnpm format                                   # formatage (Prettier, sauf les pages .mdx)
```

Avant de considérer une tâche terminée : tests, lint et formatage doivent passer pour la partie
touchée (ce sont les mêmes vérifications que la CI).
