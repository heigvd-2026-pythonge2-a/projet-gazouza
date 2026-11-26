---
title: Format de schéma
description: Vue d'ensemble du format de fichier .psice.json (version 2) — composants, fils, jonctions, bibliothèque.
---

:::note[Source de référence]
Cette page résume le format. La spécification complète, avec tous les cas particuliers, est
[`docs/format-schema.md`](https://github.com/heigvd-2026-pythonge2-a/projet-gazouza/blob/main/docs/format-schema.md),
et la vérité exécutable est dans les modèles Pydantic de `backend/app/models/`.
:::

Un schéma Psice est un **graphe** : des **composants** qui ont des **broches**, et des **fils**
qui relient deux extrémités. **Chaque fil dit explicitement à quoi il est accroché** : le backend
n'a aucun calcul géométrique à faire, et un composant déplacé garde ses fils.

## Structure d'un fichier

```json
{
  "version": 2,
  "title": "Circuit RC",
  "components": [ ... ],
  "junctions": [ ... ],
  "wires": [ ... ],
  "texts": [ ... ]
}
```

| Clé | Contenu |
|---|---|
| `version` | `2`, augmentée à chaque changement incompatible |
| `title` | Facultatif ; devient l'en-tête de la netlist (`* Circuit RC`) |
| `components` | Les composants posés, y compris masses et étiquettes |
| `junctions` | Les points où des fils se rejoignent hors d'une broche (un « T ») |
| `wires` | Les fils |
| `texts` | Facultatif ; texte libre décoratif, ignoré par la netlist |

L'**analyse** n'est pas dans le schéma : elle est envoyée à côté
(`{ schematic, analysis }`, voir [API du backend](/projet-gazouza/developpeurs/api/)).

Les clés inconnues sont **ignorées** sans erreur, pour qu'un fichier enregistré par une version
plus récente de l'éditeur s'ouvre quand même.

## Composants

```json
{
  "id": "c2",
  "type": "resistor",
  "name": "R1",
  "position": { "x": 4, "y": 2 },
  "rotation": 90,
  "mirror": false,
  "params": { "resistance": "1k" }
}
```

| Champ | Règle |
|---|---|
| `id` | Identifiant interne, unique et stable (`c1`, `c2`…), jamais affiché |
| `type` | Un type de la bibliothèque (`resistor`, `voltage_source`, `ground`, `label`…) |
| `name` | Nom SPICE unique qui commence par le préfixe du type ; absent pour `ground` et `label` |
| `position` | En unités de grille (entiers), l'axe *y* vers le bas |
| `rotation` | `0`, `90`, `180` ou `270`, sens horaire |
| `mirror` | Miroir horizontal, appliqué **avant** la rotation |
| `params` | Valeurs **telles que tapées** (`"10k"`, `"1u"`) ; l'éditeur écrit tous les défauts à la pose |
| `name_offset`, `value_offset` | Facultatifs : position du nom et de la valeur placés à la main (centre du texte, en cases, décimales permises, dans le repère du composant). Absents : placement automatique |

## Fils et jonctions

Une extrémité de fil (`from`, `to`) a l'une de ces trois formes :

| Forme | Exemple |
|---|---|
| Broche | `{ "comp": "c1", "pin": "+" }` |
| Jonction | `{ "junction": "j1" }` |
| Bout libre | `{ "x": 6, "y": 2 }` (avertissement `WIRE_DANGLING`) |

```json
{ "id": "w7", "from": { "comp": "c3", "pin": "1" }, "to": { "junction": "j1" },
  "points": [ { "x": 6, "y": 4 } ] }
```

`points` ne contient que les **coudes**, pour le dessin ; la netlist l'ignore. Un fil lâché au
milieu d'un autre est **coupé en deux** par l'éditeur, avec une jonction : le backend ne voit
jamais de « fil sur fil ».

## Texte libre

```json
{ "id": "t1", "position": { "x": 2, "y": -4 }, "content": "Entrée\n10 V" }
```

Texte décoratif (titre, note…) : `position` est son coin haut gauche, `content` le texte tapé
(retours à la ligne compris, 2000 caractères au plus). La netlist l'ignore complètement.

## Bibliothèque

Chaque type de composant est décrit **une seule fois**, dans
`backend/app/netlist/library/<type>.json`, et servi à l'éditeur par `GET /api/library` :

```json
{
  "type": "resistor",
  "label": "Résistance",
  "prefix": "R",
  "pins": [ { "name": "1", "x": 0, "y": -2 }, { "name": "2", "x": 0, "y": 2 } ],
  "params": [ { "name": "resistance", "label": "Résistance", "unit": "Ω", "default": "1k" } ],
  "spice": "{name} {pin:1} {pin:2} {resistance}"
}
```

- `spice` est le modèle de ligne : `{name}`, `{pin:X}` (nœud de la broche X), `{param}`.
- Les sources ont en plus des `waveforms` (`dc`, `pulse`, `sin`), et chaque paramètre indique les
  formes d'onde qui l'utilisent.
- Les modèles SPICE (`.model`, `.subckt`) sont écrits **dans** la bibliothèque (`models`) :
  jamais de `.include`.

## De schéma à netlist

1. **Vérifier** le schéma et collecter toutes les erreurs.
2. **Regrouper les broches en nœuds** (union-find sur les fils ; deux étiquettes de même nom
   sont reliées).
3. **Nommer les nœuds** : `0` pour la masse, puis le nom d'étiquette, sinon `n1`, `n2`… dans
   l'ordre des composants et de leurs broches.
4. **Écrire** l'en-tête, une ligne par composant, les modèles utilisés, la ligne d'analyse, puis
   `.end`.

```
* Circuit RC
V1 in 0 PULSE(0 5 0 1n 1n 10m 20m)
R1 in out 1k
C1 out 0 1u
.tran 10u 5m 0 10u
.end
```

Les exemples complets, entrée et sortie, sont dans
[`docs/exemples-netlist.md`](https://github.com/heigvd-2026-pythonge2-a/projet-gazouza/blob/main/docs/exemples-netlist.md)
et dans les [circuits de référence](/projet-gazouza/developpeurs/circuits-de-reference/).
