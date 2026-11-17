# Fixtures de référence

Circuits d'exemple qui figent le **contrat d'API** (`backend/app/models/`). Chacun peut
développer sa partie contre ces fichiers sans attendre les autres :

| Fichier | Format | Produit par | Utilisé par |
|---|---|---|---|
| `schematic.json` | `Schematic` | Éditeur (Noé) | Netlist (Damien) |
| `analysis.json` | `Analysis` | Éditeur / panneau de simulation | API (Damien), moteur (Antoine) |
| `netlist.cir` | texte SPICE | Netlist (Damien) | ngspice (Antoine) |
| `netlist.json` | `NetlistResult` | Netlist (Damien) | Moteur (Antoine), sondes (Noémi) |
| `result.json` | `SimulationResult` | Moteur (Antoine) | Courbes et sondes (Noémi) |

Les tests `backend/tests/test_fixtures.py` vérifient que tous ces fichiers respectent le contrat.
Si vous changez un modèle Pydantic, la CI vous forcera à mettre les fixtures à jour.

## Circuits

- `divider_op` : diviseur 10 V, R1 = R2 = 1 kΩ, point de fonctionnement (`.op`).
- `rc_tran` : échelon 0 → 5 V sur un RC (1 kΩ, 1 µF, τ = 1 ms), temporel sur 5 ms.

## À savoir

- Les valeurs de `result.json` sont **calculées analytiquement**, pas encore issues de
  ngspice. Antoine les remplacera par les vraies sorties dès que le moteur tourne.
- Les positions des composants et des fils sont indicatives : elles dépendront des
  décalages de broches définis dans la bibliothèque.
- À ajouter : `lowpass_ac` (`.ac`) et `loaded_divider_dc` (`.dc`).
