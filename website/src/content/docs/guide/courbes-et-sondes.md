---
title: Courbes et sondes
description: Le visualiseur de courbes de Psice, la sonde interactive, les curseurs et les mesures.
---

:::caution[En cours de développement]
Le panneau des résultats est en cours de développement (jalons S6-8 et S9-10). Cette page décrit
le fonctionnement prévu par le cahier des charges ; elle sera complétée au fur et à mesure.
:::

Après une simulation, le panneau **Résultats** affiche les courbes. Il se place à droite ou en
bas du schéma, et peut passer en plein écran.

## La sonde interactive

C'est le cœur de Psice : pas besoin de connaître le nom SPICE d'un nœud.

| Tu cliques sur… | Psice affiche… |
|---|---|
| un **fil** | la **tension** de son nœud par rapport à la masse, par exemple `v(out)` |
| un **composant** | le **courant** qui le traverse, par exemple `i(R1)` |

Pour une analyse `.op`, la sonde donne directement la valeur. Pour `.tran`, `.ac` et `.dc`, elle
ajoute la courbe au graphique.

:::note[Le signe du courant d'une source]
En SPICE, le courant d'une source qui **fournit** de l'énergie est négatif (`i(V1) < 0` pour
une pile qui débite). Psice ne montre pas ce signe : le tableau du `.op` écrit « V1 fournit
5 mA », et sur le schéma une flèche donne le sens du courant.
:::

## Les valeurs du `.op` sur le schéma

Après une analyse `.op`, Psice écrit les résultats directement sur le schéma (la case
**Afficher les valeurs sur le schéma** du panneau Résultats les masque) :

| Ce qui est affiché | Comment le lire |
|---|---|
| **Potentiel** d'un nœud (violet) | Tension du nœud par rapport à la masse, écrite sur un de ses fils, ou à côté d'une broche pour un nœud sans fil. |
| **Flèche de courant** (orange) | Pointe de flèche sur une patte du composant, dans le **sens réel** du courant ; la valeur est donnée sans signe. |
| **V_CE** d'un transistor bipolaire, **V_DS** d'un MOSFET (violet) | Flèche le long du transistor, du collecteur vers l'émetteur (du drain vers la source), avec la valeur. |

Survole un composant (ou sélectionne-le) pour voir en plus la **tension à ses bornes** : une
flèche le long du composant, de la borne la plus positive vers l'autre : elle suit la **chute de
tension**, comme en cours en Suisse. Sur une résistance, elle va dans le même sens que le courant
(convention récepteur) ; sur une source qui fournit de l'énergie, en sens contraire (convention
générateur). Pour un transistor, le survol
ajoute **V_BE** (ou **V_GS**).

Le nom de la tension met toujours la borne la plus positive en premier, pour que la valeur soit
positive : sur un transistor PNP qui conduit, le collecteur est plus bas que l'émetteur, et Psice
écrit donc **V_EC** et **V_EB**.

Les valeurs s'écrivent avec la virgule décimale : `4,27 mA`.

## Lire une courbe

Le visualiseur affiche les résultats des analyses **`.tran`**, **`.ac`** et **`.dc`** :

- **Légende interactive** : coche ou décoche chaque tension (`V`) et chaque courant (`A`) pour
  n'afficher que les signaux utiles. En **`.tran`** et **`.dc`**, les tensions utilisent l'axe
  gauche et les courants l'axe droit ; en **`.ac`**, les courants sont masqués par défaut pour ne
  pas tasser la courbe de gain en tension (`dB`), et peuvent être réaffichés depuis la légende.
- **Diagramme de Bode (`.ac`)** : deux graphiques liés (**gain en dB** et **phase en degrés**)
  sur une **échelle de fréquence logarithmique**. Le zoom et les curseurs sont synchronisés entre
  les deux graphiques.
- **Balayage DC (`.dc`)** : trace les tensions et courants en fonction de la valeur de la source
  balayée (`V` ou `A`) en abscisse.
- **Zoom** : glisse horizontalement sur le graphe ou utilise la molette de la souris ;
  double-clique (ou clique sur *Réinitialiser le zoom*) pour revenir à la vue complète.
- **Curseurs** : deux curseurs verticaux (`C1` et `C2`) déplaçables directement à la souris (ou
  via les boutons *Placer C1* / *Placer C2*) pour lire chaque grandeur ainsi que leur écart
  (`Δt`, `1/|Δt|`, `ΔV`, `ΔI`, `ΔdB`, `Δ°`).

## Mesures

Le cahier des charges prévoit des mesures automatiques sur une courbe :

| Mesure | Exemple d'usage |
|---|---|
| Valeur de crête | Amplitude d'un signal redressé |
| Valeur moyenne | Composante continue |
| Temps de montée (10 % → 90 %) | Rapidité d'un circuit RC |

## Export

- Les **courbes** en CSV, pour les retravailler dans un tableur ou en Python.
- Le **schéma** en PNG ou en SVG (net à toutes les tailles), pour un rapport.
- La **netlist** SPICE, pour la comparer avec LTspice ou la simuler ailleurs.

En bonus, une **FFT** pourra afficher le spectre d'une courbe temporelle.
