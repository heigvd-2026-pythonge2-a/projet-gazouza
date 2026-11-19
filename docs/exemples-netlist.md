# Exemples : ce que je reçois, ce que je renvoie

Rôle **Bibliothèque et netlist** (Damien). Format décrit dans [`format-schema.md`](format-schema.md).

```
Éditeur (Noé) ──schéma JSON──► Netlist (Damien) ──netlist + nets + components──► Simulation (Antoine)
                                                                               └► Sondes (Noémi)
```

| # | Circuit | Analyse | Ce que l'exemple montre |
| --- | --- | --- | --- |
| 1 | Diviseur de tension | `.op` | Noms de nœuds automatiques (`n1`, `n2`) |
| 2 | Circuit RC | `.tran` | Source `PULSE`, étiquette `out` |
| 3 | Filtre passe-bas RC | `.ac` | Amplitude AC sur la source, étiquettes `in` et `out` |
| 4 | Diviseur chargé | `.dc` | Jonction (trois fils au même point), balayage de la source |

Dans la réponse :

- `netlist` : le texte que ngspice exécute ;
- `nets` : pour chaque nœud, les fils qui le forment (clic sur un fil → tension du nœud) ;
- `components` : pour chaque nom SPICE, l'id du composant (clic sur un composant → son courant) ;
- `errors` / `warnings` : vides si tout va bien (voir section 7 de `format-schema.md`).

## Exemple 1 — Diviseur de tension

Le cas le plus simple : analyse `.op`, aucun nom de nœud choisi, donc noms automatiques `n1`, `n2`.

```
   n1        R1 10k        n2
    ┌───────/\/\/\────────┐
    │+                      │
   (V1) 10 V              R2 10k
    │-                      │
    └──────────┬────────────┘
              ⏚  (0)
```

### 1. Je reçois (de l'éditeur de Noé)

```json
{
  "version": 1,
  "title": "Diviseur de tension",
  "components": [
    {
      "id": "comp-1",
      "type": "voltage_source",
      "name": "V1",
      "x": 0,
      "y": 4,
      "rotation": 0,
      "mirror": false,
      "params": {
        "waveform": "DC",
        "dc": "10"
      }
    },
    {
      "id": "comp-2",
      "type": "resistor",
      "name": "R1",
      "x": 4,
      "y": 2,
      "rotation": 90,
      "mirror": false,
      "params": {
        "resistance": "10k"
      }
    },
    {
      "id": "comp-3",
      "type": "resistor",
      "name": "R2",
      "x": 8,
      "y": 4,
      "rotation": 0,
      "mirror": false,
      "params": {
        "resistance": "10k"
      }
    },
    {
      "id": "comp-4",
      "type": "ground",
      "name": "GND",
      "x": 4,
      "y": 8,
      "rotation": 0,
      "mirror": false,
      "params": {}
    }
  ],
  "junctions": [],
  "wires": [
    {
      "id": "wire-1",
      "from": {
        "comp": "comp-1",
        "pin": "+"
      },
      "to": {
        "comp": "comp-2",
        "pin": "1"
      }
    },
    {
      "id": "wire-2",
      "from": {
        "comp": "comp-2",
        "pin": "2"
      },
      "to": {
        "comp": "comp-3",
        "pin": "1"
      }
    },
    {
      "id": "wire-3",
      "from": {
        "comp": "comp-1",
        "pin": "-"
      },
      "to": {
        "comp": "comp-4",
        "pin": "1"
      }
    },
    {
      "id": "wire-4",
      "from": {
        "comp": "comp-3",
        "pin": "2"
      },
      "to": {
        "comp": "comp-4",
        "pin": "1"
      }
    }
  ],
  "analysis": {
    "type": "op"
  }
}
```

### 2. Je renvoie (à Antoine pour simuler, à Noémi pour les sondes)

```json
{
  "netlist": "* Diviseur de tension\nV1 n1 0 DC 10\nR1 n1 n2 10k\nR2 n2 0 10k\n.op\n.end\n",
  "nets": {
    "n1": [
      "wire-1"
    ],
    "n2": [
      "wire-2"
    ],
    "0": [
      "wire-3",
      "wire-4"
    ]
  },
  "components": {
    "V1": "comp-1",
    "R1": "comp-2",
    "R2": "comp-3"
  },
  "errors": [],
  "warnings": []
}
```

La netlist, lisible :

```
* Diviseur de tension
V1 n1 0 DC 10
R1 n1 n2 10k
R2 n2 0 10k
.op
.end
```

### 3. Résultat attendu après simulation (vérifié avec ngspice)

v(n2) = 5 V (la moitié de 10 V), i(v1) = −0,5 mA.

Fichier de test : `backend/tests/fixtures/circuits/diviseur.json`

---

## Exemple 2 — Circuit RC

Analyse temporelle `.tran` avec une source `PULSE`, et une **étiquette** `out` qui donne son nom au nœud de sortie.

```
   n1        R1 1k        out ◄── étiquette OUT
    ┌───────/\/\/\───────┬──
    │+                    │
   (V1) créneau 0→5 V    ═╪═ C1 1µ
    │-                    │
    └──────────┬──────────┘
              ⏚  (0)
```

### 1. Je reçois (de l'éditeur de Noé)

```json
{
  "version": 1,
  "title": "Circuit RC",
  "components": [
    {
      "id": "comp-1",
      "type": "voltage_source",
      "name": "V1",
      "x": 0,
      "y": 4,
      "rotation": 0,
      "mirror": false,
      "params": {
        "waveform": "PULSE",
        "v1": "0",
        "v2": "5",
        "delay": "0",
        "rise": "1u",
        "fall": "1u",
        "width": "5m",
        "period": "10m"
      }
    },
    {
      "id": "comp-2",
      "type": "resistor",
      "name": "R1",
      "x": 4,
      "y": 2,
      "rotation": 90,
      "mirror": false,
      "params": {
        "resistance": "1k"
      }
    },
    {
      "id": "comp-3",
      "type": "capacitor",
      "name": "C1",
      "x": 8,
      "y": 4,
      "rotation": 0,
      "mirror": false,
      "params": {
        "capacitance": "1u"
      }
    },
    {
      "id": "comp-4",
      "type": "ground",
      "name": "GND",
      "x": 4,
      "y": 8,
      "rotation": 0,
      "mirror": false,
      "params": {}
    },
    {
      "id": "comp-5",
      "type": "label",
      "name": "OUT",
      "x": 10,
      "y": 2,
      "rotation": 0,
      "mirror": false,
      "params": {
        "net": "out"
      }
    }
  ],
  "junctions": [],
  "wires": [
    {
      "id": "wire-1",
      "from": {
        "comp": "comp-1",
        "pin": "+"
      },
      "to": {
        "comp": "comp-2",
        "pin": "1"
      }
    },
    {
      "id": "wire-2",
      "from": {
        "comp": "comp-2",
        "pin": "2"
      },
      "to": {
        "comp": "comp-3",
        "pin": "1"
      }
    },
    {
      "id": "wire-3",
      "from": {
        "comp": "comp-1",
        "pin": "-"
      },
      "to": {
        "comp": "comp-4",
        "pin": "1"
      }
    },
    {
      "id": "wire-4",
      "from": {
        "comp": "comp-3",
        "pin": "2"
      },
      "to": {
        "comp": "comp-4",
        "pin": "1"
      }
    },
    {
      "id": "wire-5",
      "from": {
        "comp": "comp-3",
        "pin": "1"
      },
      "to": {
        "comp": "comp-5",
        "pin": "1"
      }
    }
  ],
  "analysis": {
    "type": "tran",
    "step": "10u",
    "stop": "10m"
  }
}
```

### 2. Je renvoie (à Antoine pour simuler, à Noémi pour les sondes)

```json
{
  "netlist": "* Circuit RC\nV1 n1 0 PULSE(0 5 0 1u 1u 5m 10m)\nR1 n1 out 1k\nC1 out 0 1u\n.tran 10u 10m\n.end\n",
  "nets": {
    "n1": [
      "wire-1"
    ],
    "out": [
      "wire-2",
      "wire-5"
    ],
    "0": [
      "wire-3",
      "wire-4"
    ]
  },
  "components": {
    "V1": "comp-1",
    "R1": "comp-2",
    "C1": "comp-3"
  },
  "errors": [],
  "warnings": []
}
```

La netlist, lisible :

```
* Circuit RC
V1 n1 0 PULSE(0 5 0 1u 1u 5m 10m)
R1 n1 out 1k
C1 out 0 1u
.tran 10u 10m
.end
```

### 3. Résultat attendu après simulation (vérifié avec ngspice)

τ = RC = 1 ms : v(out) vaut 3,16 V à 1 ms (63 %), 4,75 V à 3 ms, 4,97 V à 5 ms.

Fichier de test : `backend/tests/fixtures/circuits/rc.json`

---

## Exemple 3 — Filtre passe-bas RC (Bode)

Analyse fréquentielle `.ac` : la source a une **amplitude AC** (`ac_mag`), et deux étiquettes `in` et `out`.

```
   in        R1 1k        out
    ┌───────/\/\/\───────┐
    │+                    │
   (V1) AC 1 V           ═╪═ C1 159,15n
    │-                    │
    └──────────┬──────────┘
              ⏚  (0)          fc = 1 / (2π·R·C) = 1 kHz
```

### 1. Je reçois (de l'éditeur de Noé)

```json
{
  "version": 1,
  "title": "Filtre passe-bas RC (Bode)",
  "components": [
    {
      "id": "comp-1",
      "type": "voltage_source",
      "name": "V1",
      "x": 0,
      "y": 4,
      "rotation": 0,
      "mirror": false,
      "params": {
        "waveform": "DC",
        "dc": "0",
        "ac_mag": "1",
        "ac_phase": "0"
      }
    },
    {
      "id": "comp-2",
      "type": "resistor",
      "name": "R1",
      "x": 4,
      "y": 2,
      "rotation": 90,
      "mirror": false,
      "params": {
        "resistance": "1k"
      }
    },
    {
      "id": "comp-3",
      "type": "capacitor",
      "name": "C1",
      "x": 8,
      "y": 4,
      "rotation": 0,
      "mirror": false,
      "params": {
        "capacitance": "159.15n"
      }
    },
    {
      "id": "comp-4",
      "type": "ground",
      "name": "GND",
      "x": 4,
      "y": 8,
      "rotation": 0,
      "mirror": false,
      "params": {}
    },
    {
      "id": "comp-5",
      "type": "label",
      "name": "IN",
      "x": 0,
      "y": 0,
      "rotation": 0,
      "mirror": false,
      "params": {
        "net": "in"
      }
    },
    {
      "id": "comp-6",
      "type": "label",
      "name": "OUT",
      "x": 10,
      "y": 2,
      "rotation": 0,
      "mirror": false,
      "params": {
        "net": "out"
      }
    }
  ],
  "junctions": [],
  "wires": [
    {
      "id": "wire-1",
      "from": {
        "comp": "comp-1",
        "pin": "+"
      },
      "to": {
        "comp": "comp-2",
        "pin": "1"
      }
    },
    {
      "id": "wire-2",
      "from": {
        "comp": "comp-2",
        "pin": "2"
      },
      "to": {
        "comp": "comp-3",
        "pin": "1"
      }
    },
    {
      "id": "wire-3",
      "from": {
        "comp": "comp-1",
        "pin": "-"
      },
      "to": {
        "comp": "comp-4",
        "pin": "1"
      }
    },
    {
      "id": "wire-4",
      "from": {
        "comp": "comp-3",
        "pin": "2"
      },
      "to": {
        "comp": "comp-4",
        "pin": "1"
      }
    },
    {
      "id": "wire-5",
      "from": {
        "comp": "comp-1",
        "pin": "+"
      },
      "to": {
        "comp": "comp-5",
        "pin": "1"
      }
    },
    {
      "id": "wire-6",
      "from": {
        "comp": "comp-3",
        "pin": "1"
      },
      "to": {
        "comp": "comp-6",
        "pin": "1"
      }
    }
  ],
  "analysis": {
    "type": "ac",
    "points": "100",
    "start": "10",
    "stop": "100k"
  }
}
```

### 2. Je renvoie (à Antoine pour simuler, à Noémi pour les sondes)

```json
{
  "netlist": "* Filtre passe-bas RC (Bode)\nV1 in 0 DC 0 AC 1 0\nR1 in out 1k\nC1 out 0 159.15n\n.ac dec 100 10 100k\n.end\n",
  "nets": {
    "in": [
      "wire-1",
      "wire-5"
    ],
    "out": [
      "wire-2",
      "wire-6"
    ],
    "0": [
      "wire-3",
      "wire-4"
    ]
  },
  "components": {
    "V1": "comp-1",
    "R1": "comp-2",
    "C1": "comp-3"
  },
  "errors": [],
  "warnings": []
}
```

La netlist, lisible :

```
* Filtre passe-bas RC (Bode)
V1 in 0 DC 0 AC 1 0
R1 in out 1k
C1 out 0 159.15n
.ac dec 100 10 100k
.end
```

### 3. Résultat attendu après simulation (vérifié avec ngspice)

Gain ≈ 0 dB à 100 Hz, −3 dB à la coupure (1 kHz), puis −20 dB par décade (−20 dB à 10 kHz).

Fichier de test : `backend/tests/fixtures/circuits/rc_bode.json`

---

## Exemple 4 — Diviseur chargé (balayage DC)

Balayage `.dc` de la source, et une **jonction** `j-1` : trois fils se rejoignent au milieu du circuit (un « T »).

```
   n1        R1 1k       n2 (jonction j-1)
    ┌───────/\/\/\────────●──────────┐
    │+                    │          │
   (V1) 0 → 10 V        R2 1k     R3 1k (charge)
    │-                    │          │
    └──────────┬──────────┴──────────┘
              ⏚  (0)
```

### 1. Je reçois (de l'éditeur de Noé)

```json
{
  "version": 1,
  "title": "Diviseur chargé (balayage DC)",
  "components": [
    {
      "id": "comp-1",
      "type": "voltage_source",
      "name": "V1",
      "x": 0,
      "y": 4,
      "rotation": 0,
      "mirror": false,
      "params": {
        "waveform": "DC",
        "dc": "10"
      }
    },
    {
      "id": "comp-2",
      "type": "resistor",
      "name": "R1",
      "x": 4,
      "y": 2,
      "rotation": 90,
      "mirror": false,
      "params": {
        "resistance": "1k"
      }
    },
    {
      "id": "comp-3",
      "type": "resistor",
      "name": "R2",
      "x": 8,
      "y": 4,
      "rotation": 0,
      "mirror": false,
      "params": {
        "resistance": "1k"
      }
    },
    {
      "id": "comp-4",
      "type": "resistor",
      "name": "R3",
      "x": 12,
      "y": 4,
      "rotation": 0,
      "mirror": false,
      "params": {
        "resistance": "1k"
      }
    },
    {
      "id": "comp-5",
      "type": "ground",
      "name": "GND",
      "x": 6,
      "y": 8,
      "rotation": 0,
      "mirror": false,
      "params": {}
    }
  ],
  "junctions": [
    {
      "id": "j-1",
      "x": 8,
      "y": 2
    }
  ],
  "wires": [
    {
      "id": "wire-1",
      "from": {
        "comp": "comp-1",
        "pin": "+"
      },
      "to": {
        "comp": "comp-2",
        "pin": "1"
      }
    },
    {
      "id": "wire-2",
      "from": {
        "comp": "comp-2",
        "pin": "2"
      },
      "to": {
        "junction": "j-1"
      }
    },
    {
      "id": "wire-3",
      "from": {
        "junction": "j-1"
      },
      "to": {
        "comp": "comp-3",
        "pin": "1"
      }
    },
    {
      "id": "wire-4",
      "from": {
        "junction": "j-1"
      },
      "to": {
        "comp": "comp-4",
        "pin": "1"
      }
    },
    {
      "id": "wire-5",
      "from": {
        "comp": "comp-1",
        "pin": "-"
      },
      "to": {
        "comp": "comp-5",
        "pin": "1"
      }
    },
    {
      "id": "wire-6",
      "from": {
        "comp": "comp-3",
        "pin": "2"
      },
      "to": {
        "comp": "comp-5",
        "pin": "1"
      }
    },
    {
      "id": "wire-7",
      "from": {
        "comp": "comp-4",
        "pin": "2"
      },
      "to": {
        "comp": "comp-5",
        "pin": "1"
      }
    }
  ],
  "analysis": {
    "type": "dc",
    "source": "comp-1",
    "start": "0",
    "stop": "10",
    "step": "1"
  }
}
```

### 2. Je renvoie (à Antoine pour simuler, à Noémi pour les sondes)

```json
{
  "netlist": "* Diviseur chargé (balayage DC)\nV1 n1 0 DC 10\nR1 n1 n2 1k\nR2 n2 0 1k\nR3 n2 0 1k\n.dc V1 0 10 1\n.end\n",
  "nets": {
    "n1": [
      "wire-1"
    ],
    "n2": [
      "wire-2",
      "wire-3",
      "wire-4"
    ],
    "0": [
      "wire-5",
      "wire-6",
      "wire-7"
    ]
  },
  "components": {
    "V1": "comp-1",
    "R1": "comp-2",
    "R2": "comp-3",
    "R3": "comp-4"
  },
  "errors": [],
  "warnings": []
}
```

La netlist, lisible :

```
* Diviseur chargé (balayage DC)
V1 n1 0 DC 10
R1 n1 n2 1k
R2 n2 0 1k
R3 n2 0 1k
.dc V1 0 10 1
.end
```

### 3. Résultat attendu après simulation (vérifié avec ngspice)

R2 et R3 en parallèle font 500 Ω, donc v(n2) = V1 / 3 : 1 V pour 3 V, 3 V pour 9 V.

Fichier de test : `backend/tests/fixtures/circuits/diviseur_charge_dc.json`
