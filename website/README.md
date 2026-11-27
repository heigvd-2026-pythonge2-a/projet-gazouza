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
├── public/
│   └── favicon.svg        icône du site (copie de assets/brand/psice-icon-small.svg)
├── src/
│   ├── assets/            logo (clair et sombre)
│   ├── components/        composants Astro de la page d'accueil (aperçu, feuille de route, équipe)
│   ├── styles/custom.css  thème aux couleurs du logo
│   └── content/docs/      pages (Markdown / MDX)
│       ├── index.mdx      page d'accueil
│       ├── demarrer/      présentation, installation, premier circuit
│       ├── guide/         guide d'utilisation
│       ├── developpeurs/  architecture, environnement, contribuer, format, API
│       └── projet/        équipe, feuille de route, logo, licences
├── astro.config.mjs       configuration Starlight : menu, logo, langue, chemin de base
├── package.json
└── tsconfig.json
```

## Ajouter une page

1. Crée un fichier `.md` (ou `.mdx` pour utiliser des composants) dans le bon dossier de
   `src/content/docs/`, avec un `title` et une `description` en tête.
2. Ajoute-le au menu dans `astro.config.mjs` (`sidebar`).
3. Écris les liens internes avec le chemin de base : `[Analyses](/projet-gazouza/guide/analyses/)`.
4. Vérifie avec `pnpm build`.

Les pages décrivent ce que l'application fait **aujourd'hui** : une fonctionnalité pas encore
livrée est signalée comme « en cours » (badge dans le menu, encadré en haut de page).
