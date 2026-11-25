---
title: Composants
description: Les composants disponibles dans Psice, leurs broches et leurs paramètres.
---

Les composants de Psice sont décrits dans une **bibliothèque** : un fichier JSON par type, avec
ses broches, ses paramètres et sa ligne SPICE. Ajouter un composant ne demande donc aucune ligne
de code. Les symboles suivent la norme **CEI 60617**.

## Disponibles

| Composant | Préfixe | Broches | Paramètres (valeur par défaut) |
|---|---|---|---|
| Résistance | `R` | `1`, `2` | Résistance (`1k` Ω) |
| Condensateur | `C` | `1`, `2` | Capacité (`1u` F) |
| Bobine | `L` | `1`, `2` | Inductance (`1m` H) |
| Source de tension | `V` | `+`, `-` | Forme d'onde (voir ci-dessous) |
| Source de courant | `I` | `+`, `-` | Forme d'onde (voir ci-dessous) |
| Masse | — | `1` | — |
| Étiquette de nœud | — | `1` | Nom du nœud (`out`), direction |

Le **préfixe** est la première lettre du nom du composant (`R1`, `Rcharge`). Tu peux renommer
un composant, mais son nom doit garder ce préfixe et rester unique.

### Masse

La masse relie son nœud à la **référence 0 V**. Tout circuit en a besoin. Tu peux en poser
autant que tu veux : elles sont toutes reliées entre elles.

### Étiquette de nœud

Une étiquette donne un **nom** au fil sur lequel elle est posée, par exemple `in` ou `out`. Ce
nom apparaît dans les courbes (`v(out)`). Deux étiquettes portant le même nom relient leurs fils,
même sans fil dessiné entre eux.

Un nom d'étiquette ne contient que des lettres, des chiffres et `_`, et commence par une lettre.
Les majuscules ne comptent pas : `Out` et `out` désignent le même nœud.

La **direction** (panneau Propriétés) change seulement la forme du drapeau, pas la simulation :

| Direction | Drapeau |
|---|---|
| Aucune | Rectangle |
| Entrée | Pointe vers la broche : le signal entre dans le circuit |
| Sortie | Pointe à l'opposé de la broche : le signal sort du circuit |
| Bidirectionnelle | Pointe des deux côtés |

## Formes d'onde des sources

Une source de tension ou de courant a une **forme d'onde**. L'inspecteur n'affiche que les
paramètres de celle que tu as choisie.

| Forme d'onde | Paramètres | Usage typique |
|---|---|---|
| **Continue** | Tension (ou courant) continue | Alimentation, polarisation |
| **Impulsion** | Valeur basse, valeur haute, retard, temps de montée, temps de descente, durée haute, période | Échelon, signal carré, réponse indicielle |
| **Sinusoïde** | Décalage, amplitude, fréquence, retard, amortissement, phase | Signal alternatif, redressement |

:::note[Analyse fréquentielle]
Il n'y a pas d'amplitude « AC » à régler sur la source. Pour une analyse `.ac`, tu choisis la
source d'entrée dans la fenêtre d'analyse, et Psice la configure automatiquement. Un oubli ne
peut donc pas casser le diagramme de Bode.
:::

:::caution[Sens du courant d'une source de courant]
Comme en SPICE, un courant positif circule **dans la source** de la broche `+` vers la broche
`-` : il **sort** donc par la broche `-` dans le circuit. La flèche du symbole va de `+` vers
`-`.
:::

## Prévus

Le cahier des charges prévoit d'ajouter les composants suivants (jalon S6-8). Leurs broches
sont déjà fixées dans le format de schéma.

| Famille | Composants | Broches |
|---|---|---|
| Diodes | Signal, redressement, Zener, LED | `A` (anode), `K` (cathode) |
| Amplis-op | Idéal | `+`, `-`, `out` |
| Amplis-op | Réel | `+`, `-`, `out`, `V+`, `V-` |
| Transistors bipolaires | NPN, PNP | `C`, `B`, `E` |
| MOSFET | Canal N | `D`, `G`, `S` |

Leurs modèles SPICE (`.model`, `.subckt`) sont stockés directement dans la bibliothèque.
