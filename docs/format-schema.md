# Format de schéma Psice (`.json`)

> **Proposition à valider** par Damien, Noé, Antoine et Noémi.
> Une fois validée, elle devient les modèles Pydantic de `backend/app/models/`.

## 1. Principe

Un schéma Psice est un **graphe** : des **composants** qui ont des **broches**, et des **fils** qui
relient deux broches. Chaque fil dit explicitement à quoi il est accroché.

Cela rend la traduction en netlist très simple :

- le backend n'a **aucun calcul géométrique** à faire (pas de « est-ce que ce fil touche cette
  broche ? ») ; les coordonnées ne servent qu'à l'affichage ;
- chaque type de composant est décrit **une seule fois** dans la bibliothèque, avec un **modèle de
  ligne SPICE**. Ajouter un composant ne demande donc aucune ligne de code ;
- le format appartient au projet : pas de dépendance à un format propriétaire.

## 2. Structure d'un fichier

```json
{
  "version": 1,
  "components": [ ... ],
  "junctions": [ ... ],
  "wires": [ ... ],
  "analysis": { ... }
}
```

| Clé | Contenu |
| --- | --- |
| `version` | Toujours `1` pour l'instant. On l'augmente à chaque changement incompatible. |
| `components` | Les composants posés sur le schéma, y compris masses et étiquettes. |
| `junctions` | Les points où trois fils ou plus se rejoignent hors d'une broche (un « T »). |
| `wires` | Les fils, chacun entre deux extrémités. |
| `analysis` | L'analyse à lancer. |

## 3. Composants

```json
{
  "id": "comp-2",
  "type": "resistor",
  "name": "R1",
  "x": 4, "y": 2, "rotation": 90, "mirror": false,
  "params": { "resistance": "1k" }
}
```

| Champ | Règle |
| --- | --- |
| `id` | Identifiant interne, unique et stable (`comp-1`, `comp-2`…). Jamais affiché. |
| `type` | Un type de la bibliothèque (`resistor`, `capacitor`, `voltage_source`, `ground`, `label`…). |
| `name` | Nom SPICE affiché, unique, qui **commence par le préfixe** du type (`R1`, `Rcharge`). |
| `x`, `y` | Position en unités de grille (entiers). L'axe y va vers le bas. Affichage seulement. |
| `rotation` | `0`, `90`, `180` ou `270`, sens horaire. Affichage seulement. |
| `mirror` | `true` ou `false`. Affichage seulement. |
| `params` | Valeurs sous forme de texte SPICE : `"10k"`, `"1u"`, `"5m"`. **Méga s'écrit `Meg`** (`M` = milli). |

### Composants spéciaux

| `type` | Broche | Rôle | Ligne SPICE |
| --- | --- | --- | --- |
| `ground` | `1` | Relie son nœud à la masse : le nœud s'appelle `0`. | aucune |
| `label` | `1` | Donne un nom au nœud : `params.net = "out"`. | aucune |

Un nom d'étiquette ne contient que des lettres, des chiffres et `_`, commence par une lettre, et ne
doit pas ressembler à un nom automatique (`n1`, `n2`…). SPICE ignore la casse : `Out` et `out`
désignent le même nœud.

## 4. Fils et jonctions

```json
{ "id": "wire-1", "from": { "comp": "comp-1", "pin": "+" }, "to": { "comp": "comp-2", "pin": "1" } }
{ "id": "wire-7", "from": { "comp": "comp-3", "pin": "1" }, "to": { "junction": "j-1" } }
```

- Chaque extrémité (`from`, `to`) est **soit une broche** (`comp` + `pin`), **soit une jonction**
  (`junction`).
- Plusieurs fils peuvent arriver sur la même broche : pas besoin de jonction dans ce cas.
- `points` (facultatif) : liste de coudes `[{"x": 4, "y": 0}, ...]` pour le dessin. Ignoré par la netlist.

Une jonction n'a qu'une position :

```json
{ "id": "j-1", "x": 6, "y": 2 }
```

Quand on déplace un composant, ses fils restent accrochés : l'éditeur n'a qu'à redessiner.

## 5. Analyses

| `type` | Paramètres | Exemple | Ligne SPICE |
| --- | --- | --- | --- |
| `op` | aucun | `{"type": "op"}` | `.op` |
| `tran` | `step`, `stop` | `{"type": "tran", "step": "10u", "stop": "10m"}` | `.tran 10u 10m` |
| `ac` | `points` (par décade), `start`, `stop` | `{"type": "ac", "points": "100", "start": "10", "stop": "100k"}` | `.ac dec 100 10 100k` |
| `dc` | `source` (id), `start`, `stop`, `step` | `{"type": "dc", "source": "comp-1", "start": "0", "stop": "5", "step": "0.1"}` | `.dc V1 0 5 0.1` |

Pour `dc`, `source` est l'**id** du composant : le nom SPICE est retrouvé à la traduction, donc
renommer la source ne casse rien.

## 6. Bibliothèque

Un fichier JSON par type de composant, par exemple `library/resistor.json` :

```json
{
  "type": "resistor",
  "label": "Résistance",
  "prefix": "R",
  "pins": [
    { "name": "1", "x": 0, "y": -2 },
    { "name": "2", "x": 0, "y": 2 }
  ],
  "params": [
    { "name": "resistance", "label": "Résistance", "unit": "Ω", "default": "1k" }
  ],
  "spice": "{name} {pin:1} {pin:2} {resistance}"
}
```

- `pins` : ordre et position des broches à la rotation 0. L'éditeur s'en sert pour dessiner ; la
  netlist n'utilise que leur nom.
- `spice` : le modèle de ligne. `{name}` = nom du composant, `{pin:X}` = nœud de la broche X,
  `{param}` = valeur d'un paramètre.
- `includes` (facultatif) : fichiers de modèles à ajouter avec `.include`, par exemple
  `["models/1n4148.lib"]` pour une diode.

### Sources

Une source a une **forme d'onde** pour `.op`, `.tran` et `.dc`, et une **amplitude AC facultative**
pour `.ac`. Les deux peuvent coexister sur la même source (ce que ngspice accepte).

```json
{
  "type": "voltage_source",
  "prefix": "V",
  "pins": [ { "name": "+", "x": 0, "y": -2 }, { "name": "-", "x": 0, "y": 2 } ],
  "spice": "{name} {pin:+} {pin:-} {waveform}",
  "waveforms": {
    "DC":    "DC {dc}",
    "PULSE": "PULSE({v1} {v2} {delay} {rise} {fall} {width} {period})",
    "SIN":   "SIN({offset} {amplitude} {frequency} {delay} {damping} {phase})"
  },
  "ac": "AC {ac_mag} {ac_phase}"
}
```

Dans le schéma : `"params": { "waveform": "PULSE", "v1": "0", ..., "ac_mag": "1", "ac_phase": "0" }`.
Si `ac_mag` est présent, la partie `ac` est ajoutée à la fin de la ligne :

```
V1 n1 0 PULSE(0 5 0 1u 1u 5m 10m) AC 1 0
```

## 7. Traduction en netlist

1. **Regrouper les broches en nœuds.** Chaque fil fusionne ses deux extrémités (structure
   « union-find »). Une jonction est une extrémité comme une autre.
2. **Nommer les nœuds**, dans cet ordre de priorité :
   1. un nœud qui touche une masse s'appelle `0` ;
   2. un nœud qui touche une étiquette prend son nom ;
   3. les autres s'appellent `n1`, `n2`… dans l'ordre où on les rencontre en parcourant les
      composants (ordre de la liste), puis leurs broches (ordre de la bibliothèque).
3. **Écrire l'en-tête** : `* ` suivi du titre du schéma (ou `* Psice`).
4. **Écrire les `.include`** nécessaires, sans doublons.
5. **Écrire une ligne par composant** (sauf masses et étiquettes), en remplissant le modèle `spice`.
6. **Écrire la ligne d'analyse**, puis `.end`.

### Erreurs à signaler (sans lancer la simulation)

| Erreur | Exemple de message |
| --- | --- |
| Pas de masse | « Le circuit n'a pas de masse. » |
| Broche non reliée | « La broche 2 de R1 n'est reliée à rien. » |
| Nom en double | « Deux composants s'appellent R1. » |
| Nom sans le bon préfixe | « C1 n'est pas un nom valide pour une résistance. » |
| Deux étiquettes différentes sur un même nœud | « Le nœud porte deux noms : in et out. » |
| Étiquette sur la masse | « L'étiquette out est reliée à la masse. » |
| Paramètre manquant ou invalide | « R1 : la résistance « 1kk » n'est pas une valeur valide. » |

## 8. Réponse du backend

La traduction renvoie la netlist **et** les correspondances dont les sondes ont besoin :

```json
{
  "netlist": "* Circuit RC\nV1 n1 0 PULSE(0 5 0 1u 1u 5m 10m)\nR1 n1 out 1k\nC1 out 0 1u\n.tran 10u 10m\n.end\n",
  "nets": { "n1": ["wire-1"], "out": ["wire-2", "wire-5"], "0": ["wire-3", "wire-4"] },
  "components": { "V1": "comp-1", "R1": "comp-2", "C1": "comp-3" },
  "errors": [],
  "warnings": []
}
```

- `nets` : quand on clique sur un fil, on sait quel nœud afficher (`v(out)`).
- `components` : quand on clique sur un composant, on sait quel courant afficher.

## 9. Exemple complet : circuit RC

```json
{
  "version": 1,
  "title": "Circuit RC",
  "components": [
    { "id": "comp-1", "type": "voltage_source", "name": "V1", "x": 0, "y": 4, "rotation": 0, "mirror": false,
      "params": { "waveform": "PULSE", "v1": "0", "v2": "5", "delay": "0", "rise": "1u", "fall": "1u", "width": "5m", "period": "10m" } },
    { "id": "comp-2", "type": "resistor", "name": "R1", "x": 4, "y": 2, "rotation": 90, "mirror": false,
      "params": { "resistance": "1k" } },
    { "id": "comp-3", "type": "capacitor", "name": "C1", "x": 8, "y": 4, "rotation": 0, "mirror": false,
      "params": { "capacitance": "1u" } },
    { "id": "comp-4", "type": "ground", "name": "GND", "x": 4, "y": 8, "rotation": 0, "mirror": false, "params": {} },
    { "id": "comp-5", "type": "label", "name": "OUT", "x": 10, "y": 2, "rotation": 0, "mirror": false,
      "params": { "net": "out" } }
  ],
  "junctions": [],
  "wires": [
    { "id": "wire-1", "from": { "comp": "comp-1", "pin": "+" }, "to": { "comp": "comp-2", "pin": "1" } },
    { "id": "wire-2", "from": { "comp": "comp-2", "pin": "2" }, "to": { "comp": "comp-3", "pin": "1" } },
    { "id": "wire-3", "from": { "comp": "comp-1", "pin": "-" }, "to": { "comp": "comp-4", "pin": "1" } },
    { "id": "wire-4", "from": { "comp": "comp-3", "pin": "2" }, "to": { "comp": "comp-4", "pin": "1" } },
    { "id": "wire-5", "from": { "comp": "comp-3", "pin": "1" }, "to": { "comp": "comp-5", "pin": "1" } }
  ],
  "analysis": { "type": "tran", "step": "10u", "stop": "10m" }
}
```

Netlist produite :

```
* Circuit RC
V1 n1 0 PULSE(0 5 0 1u 1u 5m 10m)
R1 n1 out 1k
C1 out 0 1u
.tran 10u 10m
.end
```

Les fichiers `backend/tests/fixtures/circuits/diviseur.json` et `rc.json` suivent ce format et
contiennent aussi la netlist et les résultats attendus : toute l'équipe les utilise dans ses tests.

## 10. Questions encore ouvertes

- **Courant dans une résistance ou un condensateur** (Antoine) : ngspice ne donne directement que
  le courant des sources (`i(v1)`). Choisir entre `.save @r1[i]` et une source de 0 V en série.
- **Signe du courant d'une source** (Noémi) : SPICE donne une valeur négative pour une source qui
  fournit du courant (`i(v1) = -0.5 mA`). Faut-il inverser le signe à l'affichage ?
