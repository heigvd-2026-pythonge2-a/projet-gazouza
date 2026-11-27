# Site web — instructions pour les assistants IA

Complète le fichier [`AGENTS.md`](../AGENTS.md) à la racine.

## Périmètre

Ce dossier contient le site de documentation Starlight (Astro).
Toutes les commandes sont à lancer avec **pnpm** depuis `website/`.

- `pnpm dev` : lance le serveur local de prévisualisation (http://localhost:4321/projet-gazouza/).
- `pnpm build` : vérifie la compilation du site avant commit ou PR.
- `pnpm format` : formate le site avec Prettier, comme la CI le vérifie (`pnpm format:check`).
  Les pages `.mdx` ne sont pas formatées : Prettier lit le MDX dans une version plus ancienne
  qu'Astro et casserait leurs listes ou leurs paragraphes. Les blocs de code ne sont pas touchés.
- La page « Essayer en ligne » affiche l'app construite dans `public/demo/` (ignoré par git) par
  `pnpm build:demo` dans `frontend/` : lance-le avant `pnpm dev` pour voir la démo en local.

Les pages de documentation sont rédigées en français dans `src/content/docs/` (Markdown / MDX).
Le déploiement est assuré automatiquement par [`.github/workflows/pages.yml`](../.github/workflows/pages.yml).
