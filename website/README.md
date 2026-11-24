# Site web et documentation — Psice

Ce dossier contient le site vitrine et la documentation publique de **Psice**, construits avec [Astro](https://astro.build) et [Starlight](https://starlight.astro.build).

Le site est automatiquement compilé et déployé sur GitHub Pages à chaque commit sur `main` via le workflow [`.github/workflows/pages.yml`](../.github/workflows/pages.yml).

URL de publication : https://heigvd-2026-pythonge2-a.github.io/projet-gazouza/

## Commandes

Toutes les commandes sont à lancer depuis le dossier `website/` :

```powershell
pnpm install     # installe les dépendances
pnpm dev         # lance le serveur de développement local (http://localhost:4321/projet-gazouza/)
pnpm build       # compile le site statique dans ./dist/
pnpm preview     # prévisualise le build localement
```

## Structure du site

```
website/
├── public/              fichiers statiques (favicon, icônes)
├── src/
│   ├── assets/          images et ressources multimédias
│   └── content/
│       └── docs/        pages de documentation (Markdown / MDX)
│           ├── guides/  guides d'utilisation
│           ├── reference/ pages de référence
│           └── index.mdx page d'accueil
├── astro.config.mjs     configuration du thème Starlight et du chemin de base
├── package.json
└── tsconfig.json
```
