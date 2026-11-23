# Circuits de référence

Circuits partagés par toute l'équipe pour les tests. Le format est décrit dans
[`docs/format-schema.md`](../../../../docs/format-schema.md).

| Fichier | Circuit | Analyse | Résultat clé |
| --- | --- | --- | --- |
| `diviseur.json` | V1 = 10 V, R1 = R2 = 10 kΩ | `.op` | v(n2) = 5 V |
| `rc.json` | créneau 0 → 5 V, R = 1 kΩ, C = 1 µF (τ = 1 ms), étiquette `out` | `.tran` | v(out) = 3,16 V à t = τ |
| `rc_bode.json` | passe-bas R = 1 kΩ, C = 159,15 nF, source AC 1 V | `.ac` | −3 dB à 1 kHz |
| `diviseur_charge_dc.json` | R1 = R2 = R3 = 1 kΩ, jonction en « T » | `.dc` | v(n2) = V1 / 3 |

Les mêmes circuits sont expliqués pas à pas (reçu → renvoyé) dans
[`docs/exemples-netlist.md`](../../../../docs/exemples-netlist.md).

Chaque fichier contient :

| Clé | Contenu | Qui s'en sert |
| --- | --- | --- |
| `schema` | Le schéma tel que l'éditeur le sauvegarde | Noé produit, Damien lit |
| `expected.netlist` | La netlist attendue, caractère pour caractère | Damien teste, Antoine simule |
| `expected.nets` | Nœud SPICE → fils qui le forment | Noémi (sonde de tension) |
| `expected.components` | Nom SPICE → id du composant | Noémi (sonde de courant) |
| `expected.results` | Valeurs attendues après simulation (`tolerance` relative) | Antoine et Noémi |

Les valeurs de `results` ont été vérifiées avec ngspice.
