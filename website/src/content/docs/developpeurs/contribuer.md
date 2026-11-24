---
title: Contribuer
description: Le flux de travail de l'équipe Psice — issues, branches, commits, pull requests, labels et milestones.
---

Les règles complètes sont dans
[`AGENTS.md`](https://github.com/heigvd-2026-pythonge2-a/projet-gazouza/blob/main/AGENTS.md)
(lu aussi par les assistants IA) et dans le
[README](https://github.com/heigvd-2026-pythonge2-a/projet-gazouza#readme). Voici l'essentiel.

## Le cycle d'une tâche

1. **Partir d'une issue.** Cherche l'issue ouverte qui couvre ta tâche
   (`gh issue list --state open --search "mots-clés"`). S'il n'y en a pas, crée-la avec le bon
   modèle, sans doublon.
2. **Créer une branche** `type/description-courte` depuis `main`, par exemple
   `feat/netlist-resistor` ou `fix/plot-zoom`. Jamais de push direct sur `main`. Dès qu'on
   commence, on passe l'issue au statut **In progress** (menu « Status » de l'issue, ou la
   commande donnée dans `AGENTS.md`) : l'équipe voit ce qui est pris dans l'onglet « Active ».
3. **Rester dans son module.** Si la tâche demande de toucher le module de quelqu'un d'autre,
   on en parle d'abord avec son propriétaire (voir [Architecture](/projet-gazouza/developpeurs/architecture/#qui-possède-quoi)).
4. **Tester.** Tests, lint et formatage doivent passer pour la partie touchée.
5. **Ouvrir une petite PR**, une par tâche, avec le modèle de PR rempli honnêtement, `Closes #N`
   pour fermer l'issue, et la milestone de l'issue. L'issue passe alors en **In review**. Si on
   abandonne la branche, on la remet en **Todo**.
6. **Fusionner quand la CI est verte.** `main` n'accepte que des PR, et une PR ne peut être
   fusionnée que si le check **CI OK** passe : il résume les tests du backend, du frontend et
   du site, selon ce que la PR touche. La relecture n'est pas obligatoire, mais GitHub demande
   celle du propriétaire du module (`.github/CODEOWNERS`) : demande-la pour tout ce qui sort de
   ton module.

## Règles importantes

- **Le contrat d'API est sacré.** `backend/app/models/` ne se modifie que dans une PR dédiée,
  relue par les modules qui le consomment.
- **Ne jamais modifier les fichiers générés** : `shared/openapi.json`,
  `frontend/src/api/schema.gen.ts`, `uv.lock`, `pnpm-lock.yaml`.
- **Pas de nouvelle dépendance sans en parler** à l'équipe.
- **Développer contre les fixtures** : `shared/fixtures/` donne des entrées et sorties de
  référence, pour ne pas attendre les autres modules.
- **Pas de refactoring hors du périmètre** de la tâche.

## Conventions

| Sujet | Règle |
|---|---|
| Langue | Code, identifiants, commentaires en **anglais** ; documentation et textes affichés en **français** |
| Commits | [Conventional Commits](https://www.conventionalcommits.org/) en anglais : `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:` |
| Formatage | ruff (Python) et Prettier (TypeScript) : on lance l'outil, on ne discute pas le style |
| Fins de ligne | LF partout, sauf `.ps1` / `.bat` (géré par `.gitattributes`) |
| Unités | Nombres en SI (`float`) dans le contrat ; suffixes SPICE seulement pour les saisies utilisateur |

## Labels

Chaque issue et chaque PR reçoit un label `type:` et un label `area:`.

| Famille | Labels | Usage |
|---|---|---|
| `type:` | `bug`, `feat`, `docs`, `test`, `chore`, `question` | Nature du travail |
| `area:` | `editor`, `plot`, `backend`, `engine`, `fixtures`, `shared` | Module concerné ; `shared` = à coordonner en équipe |
| `area:` | `contract` | Modification du contrat d'API |
| `prio:` | `haute`, `basse` | `haute` = bloque une démo ou d'autres modules |
| `status:` | `bloqué`, `à discuter`, `abandonné` | Attente, décision d'équipe, ou ne sera pas traité |

## Milestones

Chaque jalon du cahier des charges est une
[milestone GitHub](https://github.com/heigvd-2026-pythonge2-a/projet-gazouza/milestones). Toute
issue et toute PR reçoit la milestone du jalon **dont elle fait avancer l'objectif** (par
l'objectif, pas par la date). Chaque tâche prévue d'un jalon a son issue dès le début du jalon,
sinon le pourcentage d'avancement est faux. Voir la
[feuille de route](/projet-gazouza/projet/feuille-de-route/).

## Modèles

- **Issues** : Bug, Fonctionnalité, Contrat d'API, Tâche technique et Question. Ils posent le
  label `type:` ; le label `area:` s'ajoute à la main.
- **PR** : le modèle pré-remplit le résumé, l'issue liée, le module touché, la façon de tester et
  la checklist de relecture.
