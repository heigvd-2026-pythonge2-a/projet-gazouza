---
title: Import LTspice (.asc)
description: Reprendre dans Psice un schéma dessiné avec LTspice — ce qui est importé, ce qui ne l'est pas.
---

Psice sait lire les fichiers **`.asc`** de LTspice, pour que tu puisses reprendre les circuits
d'un cours ou d'un laboratoire sans les redessiner.

## Importer un fichier

Clique sur le bouton **Importer un schéma LTspice (.asc)** de la barre d'outils (groupe
Fichier) et choisis le fichier, ou fais-le simplement glisser depuis l'Explorateur Windows et
dépose-le sur le schéma. Si le schéma ouvert a des modifications non enregistrées, Psice te
propose de l'enregistrer d'abord.

Le circuit s'ouvre comme un **nouveau schéma non enregistré**, avec l'analyse du fichier déjà
réglée dans la barre d'outils : tu peux cliquer sur **Simuler** tout de suite. Si une partie du
fichier n'a pas pu être reprise telle quelle, une fenêtre liste les remarques (voir plus bas).

## Ce qui est importé

- Les **composants du périmètre** de Psice : résistances, condensateurs, bobines, sources de
  tension et de courant (y compris les piles), masses et étiquettes de nœud, diodes, Zener et
  LED, amplis-op (idéal et réels), transistors NPN, PNP et MOSFET canal N.
- Les **fils**, avec leurs connexions : un fil qui touche le milieu d'un autre devient une
  jonction.
- La **direction** des étiquettes (port `In`, `Out` ou `BiDir` de LTspice) : entrée, sortie ou
  bidirectionnelle. Elle ne change que le dessin du drapeau.
- Les **valeurs**, converties au format de Psice.
- Les **formes d'onde** des sources (`PULSE`, `SIN`, continu).
- La **première analyse** du fichier (`.op`, `.tran`, `.ac` ou `.dc`).

Les positions sont ramenées sur la grille de Psice, et les noms de nœuds sont rendus sûrs pour
SPICE.

## Ce qui ne l'est pas

Tout ce que Psice ne sait pas reprendre est **signalé par un avertissement** en français, au lieu
d'être ignoré en silence. Par exemple :

- une directive inconnue (`.param`, `.meas`, `.step`…) : « La directive … est ignorée » ;
- plusieurs analyses : seule la première est gardée ;
- un nombre de cycles sur une source `PULSE` ou `SIN` ;
- une valeur absente : la valeur par défaut est utilisée ;
- le modèle LTspice d'une diode (`1N4148`…) : il est remplacé par le modèle générique de Psice
  le plus proche (signal, redressement, Zener, LED de la couleur indiquée dans le nom du modèle,
  rouge sinon) ;
- le modèle LTspice d'un transistor (`2N3904`, `BSS123`…) ou d'un ampli-op réel (`LT1055`…) :
  il est remplacé par le modèle générique de Psice ;
- un symbole que Psice ne connaît pas (MOSFET canal P, interrupteur commandé `sw`…) : il est
  laissé de côté.

## Après l'import

Le schéma importé est un schéma Psice comme un autre : tu peux le modifier, l'enregistrer en
`.psice.json` (<kbd>Ctrl+S</kbd> te demande où) et le simuler. Le fichier `.asc` d'origine n'est
jamais modifié.
