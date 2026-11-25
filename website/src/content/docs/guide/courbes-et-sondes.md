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
une pile qui débite). Le signe affiché par Psice pour les sources est encore à trancher par
l'équipe.
:::

## Lire une courbe

Le visualiseur affiche les résultats des analyses **`.tran`**, **`.ac`** et **`.dc`** :

- **Légende interactive** : coche ou décoche chaque tension (`V`) et chaque courant (`A`) pour
  n'afficher que les signaux utiles. Les tensions utilisent l'axe gauche et les courants l'axe
  droit.
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
- Le **schéma** en PNG, pour un rapport.
- La **netlist** SPICE, pour la comparer avec LTspice ou la simuler ailleurs.

En bonus, une **FFT** pourra afficher le spectre d'une courbe temporelle.
