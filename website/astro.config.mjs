import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://heigvd-2026-pythonge2-a.github.io',
  base: '/projet-gazouza',
  integrations: [
    starlight({
      title: 'Psice',
      description: 'Simulateur de circuits électroniques inspiré de LTspice avec ngspice',
      sidebar: [
        {
          label: 'Présentation',
          items: [
            { label: 'Introduction', slug: 'index' },
          ],
        },
      ],
    }),
  ],
});
