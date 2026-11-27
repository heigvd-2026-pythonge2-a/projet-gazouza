---
title: Circuits de référence
description: Les fixtures partagées de Psice — quatre circuits qui figent le contrat d'API entre les modules.
---

Le dossier
[`shared/fixtures/`](https://github.com/heigvd-2026-pythonge2-a/projet-gazouza/tree/main/shared/fixtures)
contient des circuits d'exemple qui **figent le contrat d'API**. Chaque module développe et teste
sa partie contre ces fichiers, sans attendre les autres.

## Les quatre circuits

| Dossier             | Circuit                                                    | Analyse | Ce qu'il montre                                        |
| ------------------- | ---------------------------------------------------------- | ------- | ------------------------------------------------------ |
| `divider_op`        | Diviseur 10 V, R1 = R2 = 1 kΩ                              | `.op`   | Étiquettes `in` / `out`, deux masses                   |
| `rc_tran`           | Échelon 0 → 5 V sur un RC (1 kΩ, 1 µF, τ = 1 ms), sur 5 ms | `.tran` | Source `pulse`, `max_step`                             |
| `lowpass_ac`        | Passe-bas RC (1 kΩ, 159,15 nF, f<sub>c</sub> = 1 kHz)      | `.ac`   | Source d'entrée désignée par l'analyse (`AC 1` ajouté) |
| `loaded_divider_dc` | R1 = R2 = R3 = 1 kΩ, V1 balayée de 0 à 10 V                | `.dc`   | Jonction en « T », noms automatiques `n1`, `n2`        |

Les fichiers `result.json` sont les **vraies sorties** de ngspice-47.

## Les fichiers d'un circuit

| Fichier          | Format             | Produit par                     | Utilisé par                      |
| ---------------- | ------------------ | ------------------------------- | -------------------------------- |
| `schematic.json` | `Schematic`        | Éditeur (Noé)                   | Netlist (Damien)                 |
| `analysis.json`  | `Analysis`         | Éditeur / panneau de simulation | API (Damien), moteur (Antoine)   |
| `netlist.cir`    | texte SPICE        | Netlist (Damien)                | ngspice (Antoine)                |
| `netlist.json`   | `NetlistResult`    | Netlist (Damien)                | Moteur (Antoine), sondes (Noémi) |
| `result.json`    | `SimulationResult` | Moteur (Antoine)                | Courbes et sondes (Noémi)        |
| `circuit.asc`    | schéma LTspice     | Import (Damien)                 | Import `.asc` (Damien)           |

À la racine, `library.json` est la réponse exacte de `GET /api/library`, utilisée par les tests
de l'éditeur à la place du backend.

## Exemple : le diviseur de tension

```
* Diviseur de tension
V1 in 0 DC 10
R1 in out 1k
R2 out 0 1k
.op
.end
```

Résultat attendu : v(in) = 10 V, v(out) = 5 V, i(R1) = 5 mA, et i(V1) = −5 mA (en SPICE, le
courant d'une source qui débite est négatif).

## Garde-fous

Les tests de `backend/tests/test_fixtures.py` vérifient que tous ces fichiers respectent le
contrat (et que fils, sources et correspondances pointent vers des éléments qui existent). Si
un modèle Pydantic change, la CI oblige à mettre les fixtures à jour. Le test
`test_asc_gives_the_reference_netlist` vérifie aussi que l'import de `circuit.asc` donne
exactement la même analyse et la même netlist.

Le pas à pas complet des quatre circuits est dans
[`docs/exemples-netlist.md`](https://github.com/heigvd-2026-pythonge2-a/projet-gazouza/blob/main/docs/exemples-netlist.md).
