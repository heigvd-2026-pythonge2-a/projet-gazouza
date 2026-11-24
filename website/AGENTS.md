# Site web — instructions pour les assistants IA

Complète le fichier [`AGENTS.md`](../AGENTS.md) à la racine.

## Périmètre

Ce dossier contient le site de documentation Starlight (Astro).
Toutes les commandes sont à lancer avec **pnpm** depuis `website/`.

- `pnpm dev` : lance le serveur local de prévisualisation (http://localhost:4321/projet-gazouza/).
- `pnpm build` : vérifie la compilation du site avant commit ou PR.

Les pages de documentation sont rédigées en français dans `src/content/docs/` (Markdown / MDX).
Le déploiement est assuré automatiquement par [`.github/workflows/pages.yml`](../.github/workflows/pages.yml).
