# Exemples : ce que je reçois, ce que je renvoie

Rôle **Bibliothèque et netlist** (Damien). Format décrit dans [`format-schema.md`](format-schema.md)
(version 2).

```
Éditeur (Noé) ──{ schematic, analysis }──► Netlist (Damien) ──netlist + nets + components──► Simulation (Antoine)
                                                                                          └► Sondes (Noémi)
```

Les exemples 1 à 4 sont les circuits de référence de `shared/fixtures/`. Les deux premiers existent
déjà sur `main` (au format version 1) ; les deux derniers sont ceux que le README des fixtures
annonce « à ajouter ». Tous seront migrés en version 2 dans la PR du contrat
(`feat/schematic-contract`).

| # | Fixture | Analyse | Ce que l'exemple montre |
| --- | --- | --- | --- |
| 1 | `divider_op` | `.op` | Étiquettes `in` et `out`, deux masses |
| 2 | `rc_tran` | `.tran` | Source `pulse` |
| 3 | `lowpass_ac` (nouveau) | `.ac` | Source d'entrée choisie par l'analyse (`AC 1` ajouté) |
| 4 | `loaded_divider_dc` (nouveau) | `.dc` | Jonction en « T », noms automatiques `n1`, `n2` |
| 5 | — | `.op` | Un circuit faux : erreurs et avertissements |

Dans la réponse :

- `netlist` : le texte que ngspice exécute (`""` s'il y a des erreurs) ;
- `nets` : pour chaque nœud, les fils qui le forment (clic sur un fil → tension du nœud) ;
- `components` : pour chaque nom SPICE, l'id du composant (clic sur un composant → son courant) ;
- `errors` / `warnings` : vides si tout va bien (voir la section 8 de `format-schema.md`).

> **Migration des fixtures de `main`** : en version 1, `divider_op` et `rc_tran` nomment leurs nœuds
> `in` et `out` sans étiquette. En version 2, sans étiquette, ils s'appelleraient `n1` et `n2`. On
> ajoute donc les étiquettes `in` et `out` en migrant, pour garder les mêmes noms (et les mêmes
> traces dans `result.json`). Les noms `GND1` et `GND2` des masses disparaissent. On leur donne aussi
> un `title`, et leur `netlist.cir` change en conséquence : en-tête `* {title}`, et
> `.tran 10u 5m 0 10u` au lieu de `.tran 0 5m 0 10u` pour `rc_tran`.

---

## Exemple 1 — Diviseur de tension (`divider_op`)

V1 = 10 V, R1 = R2 = 1 kΩ, point de fonctionnement `.op`.

```
   in ◄ étiquette    R1 1k      out ◄ étiquette
    ┌───────────────/\/\/\───────┐
    │+                            │
   (V1) 10 V                    R2 1k
    │-                            │
    ⏚ (0)                         ⏚ (0)
```

### 1. Je reçois (de l'éditeur de Noé)

```json
{
  "schematic": {
    "version": 2,
    "title": "Diviseur de tension",
    "components": [
      { "id": "c1", "type": "voltage_source", "name": "V1", "position": { "x": 0, "y": 2 },
        "rotation": 0, "mirror": false, "params": { "waveform": "dc", "dc": "10" } },
      { "id": "c2", "type": "resistor", "name": "R1", "position": { "x": 4, "y": -2 },
        "rotation": 270, "mirror": false, "params": { "resistance": "1k" } },
      { "id": "c3", "type": "resistor", "name": "R2", "position": { "x": 8, "y": 2 },
        "rotation": 0, "mirror": false, "params": { "resistance": "1k" } },
      { "id": "c4", "type": "ground", "position": { "x": 0, "y": 6 },
        "rotation": 0, "mirror": false, "params": {} },
      { "id": "c5", "type": "ground", "position": { "x": 8, "y": 6 },
        "rotation": 0, "mirror": false, "params": {} },
      { "id": "c6", "type": "label", "position": { "x": -1, "y": -2 },
        "rotation": 180, "mirror": false, "params": { "net": "in", "direction": "input" } },
      { "id": "c7", "type": "label", "position": { "x": 9, "y": -2 },
        "rotation": 0, "mirror": false, "params": { "net": "out", "direction": "output" } }
    ],
    "junctions": [
      { "id": "j1", "position": { "x": 0, "y": -2 } },
      { "id": "j2", "position": { "x": 8, "y": -2 } }
    ],
    "wires": [
      { "id": "w1", "from": { "junction": "j1" }, "to": { "comp": "c2", "pin": "1" }, "points": [] },
      { "id": "w2", "from": { "comp": "c2", "pin": "2" }, "to": { "junction": "j2" }, "points": [] },
      { "id": "w3", "from": { "comp": "c1", "pin": "-" }, "to": { "comp": "c4", "pin": "1" } },
      { "id": "w4", "from": { "comp": "c3", "pin": "2" }, "to": { "comp": "c5", "pin": "1" } },
      { "id": "w5", "from": { "comp": "c6", "pin": "1" }, "to": { "junction": "j1" } },
      { "id": "w6", "from": { "junction": "j2" }, "to": { "comp": "c7", "pin": "1" } },
      { "id": "w7", "from": { "junction": "j1" }, "to": { "comp": "c1", "pin": "+" } },
      { "id": "w8", "from": { "junction": "j2" }, "to": { "comp": "c3", "pin": "1" } }
    ]
  },
  "analysis": { "kind": "op" }
}
```

### 2. Je renvoie (à Antoine pour simuler, à Noémi pour les sondes)

```json
{
  "netlist": "* Diviseur de tension\nV1 in 0 DC 10\nR1 in out 1k\nR2 out 0 1k\n.op\n.end\n",
  "nets": { "in": ["w1", "w5", "w7"], "out": ["w2", "w6", "w8"], "0": ["w3", "w4"] },
  "components": { "V1": "c1", "R1": "c2", "R2": "c3" },
  "errors": [],
  "warnings": []
}
```

La netlist, lisible :

```
* Diviseur de tension
V1 in 0 DC 10
R1 in out 1k
R2 out 0 1k
.op
.end
```

### 3. Résultat attendu après simulation

v(in) = 10 V, v(out) = 5 V (la moitié), i(V1) = −5 mA.

---

## Exemple 2 — Circuit RC (`rc_tran`)

Échelon 0 → 5 V (`pulse`) sur un RC : R = 1 kΩ, C = 1 µF, τ = RC = 1 ms. Temporel sur 5 ms.

```
   in ◄ étiquette    R1 1k      out ◄ étiquette
    ┌───────────────/\/\/\───────┐
    │+                            │
   (V1) échelon 0 → 5 V         ═╪═ C1 1µ
    │-                            │
    ⏚ (0)                         ⏚ (0)
```

### 1. Je reçois

Même câblage que l'exemple 1 : seuls V1, le 2ᵉ composant (C1 au lieu de R2) et l'analyse changent.

```json
{
  "schematic": {
    "version": 2,
    "title": "Circuit RC",
    "components": [
      { "id": "c1", "type": "voltage_source", "name": "V1", "position": { "x": 0, "y": 0 },
        "rotation": 0, "mirror": false,
        "params": { "waveform": "pulse", "v1": "0", "v2": "5", "delay": "0",
                    "rise": "1n", "fall": "1n", "width": "10m", "period": "20m" } },
      { "id": "c2", "type": "resistor", "name": "R1", "position": { "x": 4, "y": -2 },
        "rotation": 270, "mirror": false, "params": { "resistance": "1k" } },
      { "id": "c3", "type": "capacitor", "name": "C1", "position": { "x": 8, "y": 0 },
        "rotation": 0, "mirror": false, "params": { "capacitance": "1u" } },
      { "id": "c4", "type": "ground", "position": { "x": 0, "y": 4 },
        "rotation": 0, "mirror": false, "params": {} },
      { "id": "c5", "type": "ground", "position": { "x": 8, "y": 4 },
        "rotation": 0, "mirror": false, "params": {} },
      { "id": "c6", "type": "label", "position": { "x": -1, "y": -2 },
        "rotation": 180, "mirror": false, "params": { "net": "in" } },
      { "id": "c7", "type": "label", "position": { "x": 9, "y": -2 },
        "rotation": 0, "mirror": false, "params": { "net": "out" } }
    ],
    "junctions": [],
    "wires": [
      { "id": "w1", "from": { "comp": "c1", "pin": "+" }, "to": { "comp": "c2", "pin": "1" },
        "points": [] },
      { "id": "w2", "from": { "comp": "c2", "pin": "2" }, "to": { "comp": "c3", "pin": "1" },
        "points": [] },
      { "id": "w3", "from": { "comp": "c1", "pin": "-" }, "to": { "comp": "c4", "pin": "1" } },
      { "id": "w4", "from": { "comp": "c3", "pin": "2" }, "to": { "comp": "c5", "pin": "1" } },
      { "id": "w5", "from": { "comp": "c1", "pin": "+" }, "to": { "comp": "c6", "pin": "1" } },
      { "id": "w6", "from": { "comp": "c3", "pin": "1" }, "to": { "comp": "c7", "pin": "1" } }
    ]
  },
  "analysis": { "kind": "tran", "stop_time": 0.005, "max_step": 1e-5 }
}
```

### 2. Je renvoie

```json
{
  "netlist": "* Circuit RC\nV1 in 0 PULSE(0 5 0 1n 1n 10m 20m)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m 0 10u\n.end\n",
  "nets": { "in": ["w1", "w5"], "out": ["w2", "w6"], "0": ["w3", "w4"] },
  "components": { "V1": "c1", "R1": "c2", "C1": "c3" },
  "errors": [],
  "warnings": []
}
```

```
* Circuit RC
V1 in 0 PULSE(0 5 0 1n 1n 10m 20m)
R1 in out 1k
C1 out 0 1u
.tran 10u 5m 0 10u
.end
```

`max_step` est donné, donc `.tran {max_step} {stop_time} 0 {max_step}` : pas d'affichage de 10 µs
(1er argument) et pas de calcul limité à 10 µs (4e argument). Voir `format-schema.md`, section 6.

### 3. Résultat attendu après simulation

v(out) vaut 3,16 V à 1 ms (63 %), 4,75 V à 3 ms, 4,97 V à 5 ms. Ces valeurs ont été vérifiées avec
ngspice sur un RC identique (même R, C et échelon de 5 V) ; à revérifier avec cette netlist exacte.

---

## Exemple 3 — Filtre passe-bas RC, Bode (`lowpass_ac`, nouveau)

Même circuit que l'exemple 2 avec C = 159,15 nF : coupure à fc = 1 / (2π·R·C) = 1 kHz.
La source est une simple source `dc` à 0 V : c'est **l'analyse** qui la désigne comme entrée
(`input_source_id`), et le backend ajoute `AC 1` à sa ligne.

### 1. Je reçois

Le schéma est celui de l'exemple 2, avec deux changements :

```json
{ "id": "c1", "type": "voltage_source", "name": "V1", "position": { "x": 0, "y": 0 },
  "rotation": 0, "mirror": false, "params": { "waveform": "dc", "dc": "0" } },
{ "id": "c3", "type": "capacitor", "name": "C1", "position": { "x": 8, "y": 0 },
  "rotation": 0, "mirror": false, "params": { "capacitance": "159.15n" } }
```

et `"title": "Filtre passe-bas RC"`. L'analyse :

```json
{ "kind": "ac", "input_source_id": "c1", "start_frequency": 10, "stop_frequency": 100000,
  "points_per_decade": 20 }
```

### 2. Je renvoie

```json
{
  "netlist": "* Filtre passe-bas RC\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nC1 out 0 159.15n\n.ac dec 20 10 100k\n.end\n",
  "nets": { "in": ["w1", "w5"], "out": ["w2", "w6"], "0": ["w3", "w4"] },
  "components": { "V1": "c1", "R1": "c2", "C1": "c3" },
  "errors": [],
  "warnings": []
}
```

```
* Filtre passe-bas RC
V1 in 0 DC 0 AC 1
R1 in out 1k
C1 out 0 159.15n
.ac dec 20 10 100k
.end
```

### 3. Résultat attendu après simulation (vérifié avec ngspice)

Gain ≈ 0 dB à 100 Hz, −3 dB à la coupure (1 kHz), puis −20 dB par décade (−20 dB à 10 kHz).

---

## Exemple 4 — Diviseur chargé, balayage DC (`loaded_divider_dc`, nouveau)

Une **jonction** `j1` : trois fils se rejoignent au milieu du circuit (un « T »). Aucune étiquette :
les nœuds prennent des **noms automatiques** `n1`, `n2`.

```
   n1        R1 1k        n2 (jonction j1)
    ┌───────/\/\/\────────●──────────┐
    │+                    │          │
   (V1) 0 → 10 V        R2 1k     R3 1k (charge)
    │-                    │          │
    └──────────┬──────────┴──────────┘
              ⏚  (0)
```

### 1. Je reçois

```json
{
  "schematic": {
    "version": 2,
    "title": "Diviseur chargé",
    "components": [
      { "id": "c1", "type": "voltage_source", "name": "V1", "position": { "x": 0, "y": 0 },
        "rotation": 0, "mirror": false, "params": { "waveform": "dc", "dc": "10" } },
      { "id": "c2", "type": "resistor", "name": "R1", "position": { "x": 4, "y": -4 },
        "rotation": 270, "mirror": false, "params": { "resistance": "1k" } },
      { "id": "c3", "type": "resistor", "name": "R2", "position": { "x": 8, "y": 0 },
        "rotation": 0, "mirror": false, "params": { "resistance": "1k" } },
      { "id": "c4", "type": "resistor", "name": "R3", "position": { "x": 12, "y": 0 },
        "rotation": 0, "mirror": false, "params": { "resistance": "1k" } },
      { "id": "c5", "type": "ground", "position": { "x": 8, "y": 4 },
        "rotation": 0, "mirror": false, "params": {} }
    ],
    "junctions": [
      { "id": "j1", "position": { "x": 8, "y": -4 } }
    ],
    "wires": [
      { "id": "w1", "from": { "comp": "c1", "pin": "+" }, "to": { "comp": "c2", "pin": "1" },
        "points": [ { "x": 0, "y": -4 } ] },
      { "id": "w2", "from": { "comp": "c2", "pin": "2" }, "to": { "junction": "j1" } },
      { "id": "w3", "from": { "junction": "j1" }, "to": { "comp": "c3", "pin": "1" } },
      { "id": "w4", "from": { "junction": "j1" }, "to": { "comp": "c4", "pin": "1" },
        "points": [ { "x": 12, "y": -4 } ] },
      { "id": "w5", "from": { "comp": "c1", "pin": "-" }, "to": { "comp": "c5", "pin": "1" },
        "points": [ { "x": 0, "y": 4 } ] },
      { "id": "w6", "from": { "comp": "c3", "pin": "2" }, "to": { "comp": "c5", "pin": "1" } },
      { "id": "w7", "from": { "comp": "c4", "pin": "2" }, "to": { "comp": "c5", "pin": "1" },
        "points": [ { "x": 12, "y": 4 } ] }
    ]
  },
  "analysis": { "kind": "dc", "source_id": "c1", "start": 0, "stop": 10, "step": 1 }
}
```

### 2. Je renvoie

```json
{
  "netlist": "* Diviseur chargé\nV1 n1 0 DC 10\nR1 n1 n2 1k\nR2 n2 0 1k\nR3 n2 0 1k\n.dc V1 0 10 1\n.end\n",
  "nets": { "n1": ["w1"], "n2": ["w2", "w3", "w4"], "0": ["w5", "w6", "w7"] },
  "components": { "V1": "c1", "R1": "c2", "R2": "c3", "R3": "c4" },
  "errors": [],
  "warnings": []
}
```

```
* Diviseur chargé
V1 n1 0 DC 10
R1 n1 n2 1k
R2 n2 0 1k
R3 n2 0 1k
.dc V1 0 10 1
.end
```

`.dc V1` : l'analyse donne l'**id** `c1`, et le backend retrouve le nom `V1`.

### 3. Résultat attendu après simulation (vérifié avec ngspice)

R2 et R3 en parallèle font 500 Ω, donc v(n2) = V1 / 3 : 1 V pour 3 V, 3 V pour 9 V.

---

## Exemple 5 — Un circuit faux

L'étudiant a oublié la masse, et un fil a un bout en l'air.

### 1. Je reçois

```json
{
  "schematic": {
    "version": 2,
    "components": [
      { "id": "c1", "type": "voltage_source", "name": "V1", "position": { "x": 0, "y": 0 },
        "rotation": 0, "mirror": false, "params": { "waveform": "dc", "dc": "5" } },
      { "id": "c2", "type": "resistor", "name": "R1", "position": { "x": 4, "y": 0 },
        "rotation": 0, "mirror": false, "params": { "resistance": "1M" } }
    ],
    "junctions": [],
    "wires": [
      { "id": "w1", "from": { "comp": "c1", "pin": "+" }, "to": { "comp": "c2", "pin": "1" } },
      { "id": "w2", "from": { "comp": "c1", "pin": "-" }, "to": { "comp": "c2", "pin": "2" } },
      { "id": "w3", "from": { "comp": "c2", "pin": "2" }, "to": { "x": 8, "y": 4 } }
    ]
  },
  "analysis": { "kind": "op" }
}
```

### 2. Je renvoie

```json
{
  "netlist": "",
  "nets": {},
  "components": {},
  "errors": [
    { "code": "NO_GROUND", "message": "Le circuit n'a pas de masse.", "targets": [] }
  ],
  "warnings": [
    { "code": "MILLI_SUFFIX",
      "message": "R1 : « 1M » se lit « milli » en SPICE. Pour « méga », écris « 1Meg ».",
      "targets": [ { "comp": "c2" } ] },
    { "code": "WIRE_DANGLING", "message": "Le fil w3 a un bout qui n'est relié à rien.",
      "targets": [ { "wire": "w3" } ] }
  ]
}
```

- Toutes les erreurs et tous les avertissements sont renvoyés **en une fois**.
- La réponse HTTP est **200** : le circuit est faux, mais la requête est correcte.
- L'éditeur surligne les `targets` en rouge (erreurs) ou en orange (avertissements) et affiche le
  `message`.
