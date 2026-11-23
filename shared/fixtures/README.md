# Fixtures de référence

Circuits d'exemple qui figent le **contrat d'API** (`backend/app/models/`, format de schéma
**version 2**, décrit dans [`docs/format-schema.md`](../../docs/format-schema.md)). Chacun peut
développer sa partie contre ces fichiers sans attendre les autres :

| Fichier | Format | Produit par | Utilisé par |
|---|---|---|---|
| `schematic.json` | `Schematic` | Éditeur (Noé) | Netlist (Damien) |
| `analysis.json` | `Analysis` | Éditeur / panneau de simulation | API (Damien), moteur (Antoine) |
| `netlist.cir` | texte SPICE | Netlist (Damien) | ngspice (Antoine) |
| `netlist.json` | `NetlistResult` | Netlist (Damien) | Moteur (Antoine), sondes (Noémi) |
| `result.json` | `SimulationResult` | Moteur (Antoine) | Courbes et sondes (Noémi) |

À la racine, `library.json` est la réponse exacte de `GET /api/library` (liste de
`LibraryComponent`), produite par la bibliothèque du backend (Damien) et utilisée par les tests
de l'éditeur (Noé) à la place du backend. Le test `test_library_fixture_is_the_route_answer`
échoue si elle n'est plus à jour : régénérez-la depuis la route.

Les tests `backend/tests/test_fixtures.py` vérifient que tous ces fichiers respectent le contrat
(et que les fils, sources et correspondances pointent vers des éléments qui existent).
Si vous changez un modèle Pydantic, la CI vous forcera à mettre les fixtures à jour.

## Circuits

| Dossier | Circuit | Analyse | Ce qu'il montre |
|---|---|---|---|
| `divider_op` | Diviseur 10 V, R1 = R2 = 1 kΩ | `.op` | Étiquettes `in` / `out`, deux masses |
| `rc_tran` | Échelon 0 → 5 V sur un RC (1 kΩ, 1 µF, τ = 1 ms), sur 5 ms | `.tran` | Source `pulse`, `max_step` |
| `lowpass_ac` | Passe-bas RC (1 kΩ, 159,15 nF, fc = 1 kHz) | `.ac` | Source d'entrée désignée par l'analyse (`AC 1` ajouté) |
| `loaded_divider_dc` | R1 = R2 = R3 = 1 kΩ, V1 balayée de 0 à 10 V | `.dc` | Jonction en « T », noms automatiques `n1`, `n2` |

Les mêmes circuits sont expliqués pas à pas dans
[`docs/exemples-netlist.md`](../../docs/exemples-netlist.md).

## À savoir

- Les fichiers `result.json` des quatre circuits (`divider_op`, `rc_tran`, `lowpass_ac` et
  `loaded_divider_dc`) contiennent les vraies sorties produites par `ngspice-47`.
- Les positions des composants et les coudes des fils sont indicatifs : ils dépendront des
  positions de broches définies dans la bibliothèque. La netlist ne s'en sert pas.
