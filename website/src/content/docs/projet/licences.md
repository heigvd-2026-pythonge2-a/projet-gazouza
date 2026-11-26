---
title: Licences
description: La licence de Psice et celles des logiciels qu'il utilise.
---

## Psice

Psice est distribué sous la **licence MIT** : tu peux l'utiliser, le modifier et le
redistribuer librement, à condition de conserver la mention de copyright. Le texte complet est
dans le fichier
[`LICENSE`](https://github.com/heigvd-2026-pythonge2-a/projet-gazouza/blob/main/LICENSE).

## Logiciels tiers

Psice intègre ou utilise des composants externes, soumis à leurs propres licences. Le détail
des mentions de copyright est dans
[`THIRD_PARTY_LICENSES.md`](https://github.com/heigvd-2026-pythonge2-a/projet-gazouza/blob/main/THIRD_PARTY_LICENSES.md).

| Composant | Rôle | Licence |
|---|---|---|
| ngspice | Moteur de simulation (binaires inclus) | BSD 3-Clause |
| NumPy, SciPy | Calcul numérique | BSD 3-Clause |
| FastAPI, Pydantic | API du backend | MIT |
| pywebview | Fenêtre native | BSD 3-Clause |
| PyInstaller | Packaging de l'application | GPL v2 avec exception (l'exécutable produit peut être distribué sous toute licence) |
| React, Vite | Interface | MIT |
| Konva, React-Konva | Dessin du schéma | MIT |
| uPlot | Courbes | MIT |
| Zustand | État de l'application | MIT |
| Astro, Starlight | Ce site | MIT |

:::note[ngspice]
Les mentions de copyright et les termes de la licence BSD de ngspice doivent être conservés à
chaque redistribution de l'application.
:::

## Logo

Le dessin du logo (le P, le point, la borne, la tuile de l'icône), le script `make_brand.py` et
les icônes sont sous la licence MIT du dépôt.

**Exception** : les lettres « sice » du logo sont des contours issus de la police
**Segoe UI Semibold**, propriété de Microsoft. Ces contours sont utilisés uniquement pour le
logo ; ils ne sont pas couverts par la licence MIT, et la police elle-même n'est pas distribuée.
