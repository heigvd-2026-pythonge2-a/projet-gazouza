import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const REPO = 'https://github.com/heigvd-2026-pythonge2-a/projet-gazouza';

export default defineConfig({
  site: 'https://heigvd-2026-pythonge2-a.github.io',
  base: '/projet-gazouza',
  integrations: [
    starlight({
      title: 'Psice',
      description:
        'Psice, le simulateur de circuits électroniques pour débutants : dessiner un circuit, le simuler avec ngspice et lire tensions et courants en quelques clics.',
      // Single French locale at the root: Starlight's own texts (search, table of contents,
      // previous / next) are shown in French.
      defaultLocale: 'root',
      locales: { root: { label: 'Français', lang: 'fr' } },
      logo: {
        light: './src/assets/psice-logo.svg',
        dark: './src/assets/psice-logo-dark.svg',
        alt: 'Psice',
        replacesTitle: true,
      },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/custom.css'],
      social: [{ icon: 'github', label: 'Dépôt GitHub', href: REPO }],
      editLink: { baseUrl: `${REPO}/edit/main/website/` },
      head: [
        { tag: 'meta', attrs: { name: 'theme-color', content: '#2563EB' } },
      ],
      sidebar: [
        {
          label: 'Démarrer',
          items: [
            { label: 'Pourquoi Psice ?', slug: 'demarrer/presentation' },
            { label: 'Installation', slug: 'demarrer/installation' },
            { label: 'Premier circuit', slug: 'demarrer/premier-circuit' },
          ],
        },
        {
          label: "Guide d'utilisation",
          items: [
            { label: "L'éditeur de schéma", slug: 'guide/editeur' },
            { label: 'Composants', slug: 'guide/composants' },
            { label: 'Valeurs et unités', slug: 'guide/valeurs-et-unites' },
            { label: 'Analyses', slug: 'guide/analyses' },
            {
              label: 'Courbes et sondes',
              slug: 'guide/courbes-et-sondes',
              badge: { text: 'En cours', variant: 'caution' },
            },
            {
              label: 'Import LTspice (.asc)',
              slug: 'guide/import-ltspice',
              badge: { text: 'En cours', variant: 'caution' },
            },
            { label: "Messages d'erreur", slug: 'guide/erreurs' },
            { label: 'Raccourcis clavier', slug: 'guide/raccourcis' },
          ],
        },
        {
          label: 'Développeurs',
          items: [
            { label: 'Architecture', slug: 'developpeurs/architecture' },
            { label: 'Environnement de développement', slug: 'developpeurs/environnement' },
            { label: 'Contribuer', slug: 'developpeurs/contribuer' },
            { label: 'Format de schéma', slug: 'developpeurs/format-schema' },
            { label: 'API du backend', slug: 'developpeurs/api' },
            { label: 'Circuits de référence', slug: 'developpeurs/circuits-de-reference' },
          ],
        },
        {
          label: 'Projet',
          items: [
            { label: 'Équipe', slug: 'projet/equipe' },
            { label: 'Feuille de route', slug: 'projet/feuille-de-route' },
            { label: 'Logo', slug: 'projet/logo' },
            { label: 'Licences', slug: 'projet/licences' },
          ],
        },
      ],
    }),
  ],
});
