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
| Diode | `D` | `A` (anode), `K` (cathode) | Modèle (Signal) |
| Diode Zener | `D` | `A`, `K` | Tension Zener (`5,1 V`) |
| LED | `D` | `A`, `K` | Couleur (Rouge) |
| Ampli-op idéal | `X` | `+`, `-`, `out` | Modèle (Idéal) |
| Ampli-op réel | `X` | `+`, `-`, `out`, `V+`, `V-` | Modèle (Générique) |
| Transistor NPN | `Q` | `C`, `B`, `E` | Modèle (Usage général) |
| Transistor PNP | `Q` | `C`, `B`, `E` | Modèle (Usage général) |
| MOSFET canal N | `M` | `D`, `G`, `S` | Modèle (Usage général) |

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

Le drapeau se place tout seul **du côté opposé au fil** (ou au composant) branché sur l'étiquette,
pour que son nom ne cache jamais le fil : l'étiquette tourne autour de sa broche, rien ne se
débranche. `R` fait le tour des côtés libres seulement.

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

## Semi-conducteurs et amplis-op

Ces composants n'ont pas de valeur à saisir : tu choisis leur **modèle** dans le panneau
Propriétés. Chaque modèle est un jeu de paramètres SPICE (`.model` ou `.subckt`) stocké dans la
bibliothèque et ajouté automatiquement à la netlist. Ce sont des modèles génériques, aux valeurs
typiques des fiches techniques des composants cités : pas les modèles exacts des fabricants.

### Diodes

| Composant | Modèles | Utilisation |
|---|---|---|
| Diode | Signal (type 1N4148), Redressement (type 1N4007) | Chute d'environ 0,6 à 0,7 V en direct |
| Diode Zener | 3,3 V, 5,1 V, 12 V | Montée en inverse, elle maintient sa tension Zener |
| LED | Rouge, Verte | Chute d'environ 1,8 V (rouge) ou 2,2 V (verte) en direct |

Le courant passe de l'anode `A` vers la cathode `K`. Sur le symbole, la cathode est le côté de
la barre.

### Amplis-op

| Composant | Modèle | Comportement |
|---|---|---|
| Ampli-op idéal | Idéal (gain 10⁶, sans limite) | Pas d'alimentation, la sortie peut prendre n'importe quelle tension |
| Ampli-op réel | Générique (type 741 : gain 10⁵, 1 MHz) | Alimenté par `V+` et `V-`, la sortie sature avant les alimentations |

:::caution[Alimenter l'ampli-op réel]
Les broches `V+` et `V-` de l'ampli-op réel doivent être reliées à des sources de tension (par
exemple +15 V et -15 V). Si tu en oublies une, la simulation refuse de démarrer avec l'erreur
[`PIN_NOT_CONNECTED`](/projet-gazouza/guide/erreurs/). Sa sortie sature environ 1,5 V avant les
alimentations : entre -13,5 V et +13,5 V avec ±15 V.
:::

### Transistors

| Composant | Modèle | Broches |
|---|---|---|
| Transistor NPN | Usage général (type 2N3904) | `C` (collecteur), `B` (base), `E` (émetteur) |
| Transistor PNP | Usage général (type 2N3906) | `C`, `B`, `E` |
| MOSFET canal N | Usage général (type 2N7000, seuil 2 V) | `D` (drain), `G` (grille), `S` (source) |
