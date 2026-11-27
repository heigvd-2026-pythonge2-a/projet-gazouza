# Frontend — instructions pour les agents IA

Complète le fichier [`AGENTS.md`](../AGENTS.md) à la racine.

## Structure

- `src/editor/` : éditeur de schéma (canvas, placement, fils, sélection, zoom).
- `src/plot/` : courbes, sondes, curseurs, mesures.
- `src/store/` : état global de l'application, annuler/rétablir.
- `src/api/client.ts` : seul endroit qui appelle le backend (`fetch`).
- `src/api/schema.gen.ts` : **généré** depuis le contrat Python (`pnpm gen:api`), ne pas éditer.
- `src/App.tsx` : assemble les modules ; modifications à coordonner en équipe.

## Conventions

- TypeScript strict, composants fonctionnels React, pas de `any`.
- Les types d'échange avec le backend viennent **uniquement** de `src/api/client.ts`
  (réexportés depuis `schema.gen.ts`). Ne redéfinis jamais à la main un type du contrat.
- Le frontend ne fait aucun calcul de simulation : il affiche et édite.
- Pour développer sans backend, importe les fichiers de `shared/fixtures/` comme données.
- Tests : `pnpm test` (vitest). Un fichier `*.test.ts` à côté du module testé ; les circuits
  de `shared/fixtures/` sont disponibles via `src/store/testFixtures.ts`.
- Composants : Testing Library (`render`, `screen`, `userEvent`) dans un DOM simulé (jsdom).
  Cherche les éléments par rôle et par libellé, comme l'utilisateur les voit. `src/test/editorStore.ts`
  remet le store à zéro. jsdom n'a pas de `<canvas>` : pour tester le canvas Konva, appelle
  `installFakeCanvas()` (`src/test/canvas.ts`) en tête du fichier de test, puis inspecte et
  déclenche les nœuds Konva (voir `editor/Editor.test.tsx`). Pour tester ce qui entoure le
  canvas, remplace plutôt `SchematicCanvas` par un `vi.mock` (voir `App.test.tsx`).
- Un module n'importe pas les fichiers internes d'un autre module : passer par `src/store/`
  ou par une fonction exportée explicitement.
