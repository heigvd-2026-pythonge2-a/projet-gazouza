## Résumé

<!-- Ce que fait cette PR et pourquoi, en 1 à 3 phrases. -->

Closes #

## Changements

-

## Module(s) touché(s)

<!-- Une PR = une tâche = un module. Si un autre module est touché, explique pourquoi
et mentionne son propriétaire (voir AGENTS.md). -->

- [ ] Éditeur / store (`area: editor`)
- [ ] Courbes (`area: plot`)
- [ ] Netlist, importeurs, API (`area: backend`)
- [ ] Moteur ngspice, launcher, build (`area: engine`)
- [ ] Fixtures partagées (`area: fixtures`)
- [ ] client.ts, App.tsx, CI, configs racine (`area: shared`)
- [ ] Contrat d'API `backend/app/models/` (`area: contract`, PR dédiée)

## Comment tester

<!-- Étapes pour vérifier le changement : commandes, circuit à dessiner, résultat attendu.
Une capture d'écran est la bienvenue pour un changement visuel. -->

1.

## Checklist

- [ ] Branche `type/description-courte`, commits au format Conventional Commits
- [ ] Labels `type:` et `area:` ajoutés
- [ ] Tests ajoutés ou mis à jour (Python : couverture ≥ 80 %)
- [ ] Tests, lint et formatage passent pour la partie touchée
- [ ] Aucun fichier généré modifié à la main (`openapi.json`, `schema.gen.ts`, lockfiles)
- [ ] Pas de nouvelle dépendance, ou alors elle est justifiée ci-dessous
- [ ] Si le contrat change : `export_openapi.py`, `pnpm gen:api` et `shared/fixtures/` mis à jour

## Remarques

<!-- Points d'attention pour la relecture, dépendances ajoutées, suite prévue… -->
