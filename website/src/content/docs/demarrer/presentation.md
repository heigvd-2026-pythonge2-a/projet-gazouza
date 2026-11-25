---
title: Pourquoi Psice ?
description: Le besoin auquel répond Psice, à qui il s'adresse et ce qu'il sait faire.
---

Psice est un simulateur de circuits électroniques destiné aux étudiantes et étudiants de 1re et
2e année de la HEIG-VD. C'est une alternative plus simple à LTspice, qui utilise le même genre de
moteur de simulation (**ngspice**) derrière une interface moderne.

## Le problème

LTspice est un outil puissant, mais il demande beaucoup de temps de prise en main : interface
datée, directives SPICE à taper à la main, résultats peu lisibles. Ce temps est perdu pour
l'essentiel. Ce qui compte en cours, c'est de **comprendre le comportement des composants**.

## Ce que Psice propose

- **Dessiner** un circuit dans un éditeur graphique : composants, fils, masse, étiquettes de
  nœud.
- **Simuler** sans connaître SPICE : l'analyse se choisit dans une fenêtre guidée, la netlist est
  générée automatiquement.
- **Mesurer** d'un clic : la tension d'un fil, le courant d'un composant, des curseurs sur les
  courbes.
- **Comprendre ses erreurs** : les messages sont en français et le schéma surligne l'élément
  fautif.

## Objectifs mesurables

Le [cahier des charges](https://github.com/heigvd-2026-pythonge2-a/projet-gazouza/blob/main/cahier-des-charges-psice.md)
fixe trois objectifs :

1. Simuler un premier circuit (diviseur, RC) en **moins de 15 minutes**, sans formation
   préalable.
2. Mesurer la tension d'un fil ou le courant d'un composant **d'un simple clic**.
3. Offrir une ergonomie adaptée aux débutants : **aucune directive texte** à taper, des menus
   contextuels courts et des paramètres de simulation guidés.

## Ce que Psice ne fait pas

Psice reste volontairement centré sur l'électronique analogique vue en 1re et 2e année. Sont
**hors périmètre** : les circuits numériques et logiques, la conception de PCB, la simulation
RF, les versions macOS / Linux et l'hébergement en ligne.

## Un outil ouvert

Psice est **open source** (licence MIT) et son moteur est écrit en **Python**, le langage
enseigné à la HEIG-VD. Le simulateur n'est donc plus une boîte noire : étudiants et enseignants
peuvent lire le code qui transforme un schéma en netlist SPICE, et l'étendre.

Tout tourne **en local**, sous Windows 10 et 11, **sans connexion Internet**.
