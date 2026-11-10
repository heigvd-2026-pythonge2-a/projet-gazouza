# Cahier des charges — Psice

*Simulateur de circuits électroniques — HEIG-VD, 10 novembre 2026*

## 1. Contexte et besoin

Psice est un simulateur de circuits électroniques destiné aux étudiants de 1re et 2e année HEIG-VD, conçu comme une alternative plus simple à LTspice. Projet de groupe de 2e année (4 personnes, environ 90 h chacune), développé avec l'assistance de l'IA.

**Problème :** LTspice demande beaucoup de temps de prise en main (interface datée, syntaxe SPICE, résultats peu lisibles, ). Ce temps est perdu pour l'essentiel : comprendre le comportement des composants vus en cours.

**Besoin :** dessiner un circuit, le simuler et lire tensions et courants en quelques clics, sans connaître SPICE.

**Valeur ajoutée:** Psice est open source et écrit en Python (langage enseigné à la HEIG-VD), ce qui transforme le simulateur d'une « boîte noire » en un outil transparent que les étudiants et enseignants peuvent inspecter, comprendre et étendre tout en restant dans un cadre pertinant à la formation.

## 2. Objectifs

- Simuler un premier circuit (diviseur, RC) en moins de 10 minutes, sans formation préalable.
- Lire la tension d'un fil ou le courant d'un composant d'un simple clic (sonde interactive).
- Rendre visible le comportement du circuit : animation du sens et de l'intensité du courant.

## 3. Périmètre

| Famille | Composants d'exemple |
| --- | --- |
| Passifs | R, C, L |
| Sources | Tension et courant : DC, PULSE, SIN ; masse |
| Diodes | 1N4148 (signal), 1N4007 (redressement), Zener, LED |
| Ampli-op | Modèle idéal + un modèle réel (TL081 ou LM741) |
| Transistors | BJT NPN 2N3904 / PNP 2N3906 ; MOSFET canal N 2N7000 |

Les composants et leurs symboles sont stockés dans une bibliothèque (fichiers JSON + modèles SPICE `.model` / `.subckt`), extensible sans toucher au code.

**Hors périmètre :** circuits numériques et logiques, conception de PCB, simulation RF, version macOS/Linux, hébergement en ligne.

## 4. Exigences fonctionnelles

| Priorité | Exigence |
| --- | --- |
| Indispensable | Éditeur de schéma 2D : placer, tourner, relier avec des fils, grille, zoom |
| Indispensable | Simulation ngspice : point de fonctionnement (`.op`) et temporelle (`.tran`) |
| Indispensable | Affichage des tensions de nœuds et des courants de branches ; sonde avec le clic |
| Indispensable | Courbes (zoom, curseurs) ; sauvegarde et ouverture des schémas |
| Important | Analyse fréquentielle (`.ac`, diagramme de Bode) et balayage DC (`.dc`, DC Sweep) |
| Important | Animation du courant sur le schéma ; annuler / rétablir |
| Bonus | Import `.asc` LTspice ; mesures (crête, moyenne, temps de montée) ; FFT ; export |

## 5. Contraintes

- **Technique** interface web (React + TypeScript et/ou choix de l'équipe) dans une fenêtre certainement pywebview backend Python. Au moins 10 % du code en Python.
- **Normes** symboles graphiques selon CEI 60617, symboles et unités selon CEI 60027 et SI 
- **Collaboration** code sur GitHub, une branche par tâche, chaque fusion relue par un autre membre ; liste des tâches suivie dans GitHub Issues.
- **Exécution** tout fonctionne en local, sur Windows 10 et 11, sans connexion Internet.

## 6. Livrables et jalons

**Livrables :** code source sur GitHub ; tests automatisés du moteur (pytest, comparaison solveur maison / ngspice sur circuits de référence : diviseur, RC, RLC, redresseur) ; application Windows zippée ; rapport de projet ; démonstration orale.


**Critère d'acceptation :** les résultats des circuits de référence s'écartent impércèptiblement d'une simulation LTSpice.
**Critère d'acceptation optionnel :** comparaison avec LTSpice au travers d'un sondage mener dans une classe pilote de première année en génie éléctrique.
