# Format de schéma Psice — version 2

> **Proposition** de Damien, relue par Noé (éditeur), Antoine (simulation) et Noémi (sondes).
> Une fois validée, elle remplace le brouillon de `backend/app/models/` dans une PR dédiée
> (`feat/schematic-contract`), avec la migration de `shared/fixtures/`.

## 1. Principe

Un schéma Psice est un **graphe** : des **composants** qui ont des **broches**, et des **fils** qui
relient deux extrémités. **Chaque fil dit explicitement à quoi il est accroché.**

- Le backend n'a **aucun calcul géométrique** à faire : pas de « est-ce que ce fil touche cette
  broche ? ». Les coordonnées ne servent qu'à l'affichage.
- Quand on déplace un composant, ses fils restent accrochés : l'éditeur n'a qu'à redessiner.
- Chaque type de composant est décrit **une seule fois** dans la bibliothèque (broches, paramètres,
  ligne SPICE). Ajouter un composant ne demande aucune ligne de code.
- La sonde est directe : un clic sur un fil donne son nœud.

### Ce qui change par rapport au brouillon sur `main` (version 1)

| | Version 1 (brouillon) | Version 2 (proposée) |
| --- | --- | --- |
| Connexion des fils | Géométrique : polyligne `points` | Explicite : `from` / `to` |
| Points en T | Fil qui touche le milieu d'un autre | Objet `junction` |
| Nom d'un nœud | Non défini | Composant `label` |
| `name` des masses et étiquettes | Obligatoire (`GND1`, `GND2`) | Absent |
| Dessin des symboles | Non défini | Champ `symbol` dans la bibliothèque |
| Erreurs | `message`, `component_id`, `wire_id` | `code` (liste fermée), `message`, `targets` |
| `version` | `1` | `2` |

**Inchangé** : `position`, `rotation`, `mirror`, `params`, ids courts (`c1`, `w1`), analyse séparée
du schéma (`SimulationRequest`, clé `kind`, nombres en unités SI).

## 2. Structure d'un fichier

```json
{
  "version": 2,
  "title": "Circuit RC",
  "components": [ ... ],
  "junctions": [ ... ],
  "wires": [ ... ]
}
```

| Clé | Contenu |
| --- | --- |
| `version` | `2`. On l'augmente à chaque changement incompatible. |
| `title` | Facultatif. Sert d'en-tête de la netlist (`* Circuit RC`). |
| `components` | Les composants posés, y compris masses et étiquettes. |
| `junctions` | Les points où des fils se rejoignent hors d'une broche (un « T »). |
| `wires` | Les fils. |

L'**analyse** n'est pas dans le schéma : elle est envoyée à côté (section 6).

**Clés inconnues** : une clé que le format ne connaît pas (dans le schéma, un composant, une
jonction ou un fil) est **ignorée**, sans erreur. C'est voulu : un fichier enregistré par une
version plus récente de l'éditeur (avec des métadonnées d'affichage en plus) s'ouvre quand même.
Seules les extrémités de fil et les cibles d'erreur refusent les clés en trop, car c'est ce qui
garantit qu'elles n'ont qu'une seule forme.

## 3. Composants

```json
{
  "id": "c2",
  "type": "resistor",
  "name": "R1",
  "position": { "x": 4, "y": 2 },
  "rotation": 90,
  "mirror": false,
  "params": { "resistance": "1k" }
}
```

| Champ | Règle |
| --- | --- |
| `id` | Identifiant interne, unique et stable, généré par l'éditeur (`c1`, `c2`…). Jamais affiché. |
| `type` | Un type de la bibliothèque (`resistor`, `capacitor`, `voltage_source`, `ground`, `label`…). |
| `name` | Nom SPICE affiché, unique, qui **commence par le préfixe** du type (`R1`, `Rcharge`). **Absent** pour `ground` et `label`. |
| `position` | En unités de grille (entiers). L'axe y va vers le bas. |
| `rotation` | `0`, `90`, `180` ou `270`, sens horaire. |
| `mirror` | `true` ou `false`. |
| `params` | Valeurs **telles que l'utilisateur les tape** : `"10k"`, `"1u"`, `"5m"`. **Méga s'écrit `Meg`** (`M` = milli). |

**Miroir et rotation** : le miroir est horizontal (`x → −x`) et s'applique **avant** la rotation.
L'éditeur et l'import `.asc` utilisent la même règle.

**Paramètres par défaut** : dès qu'un composant est placé, l'éditeur écrit **tous** les `default`
de la bibliothèque dans `params`. Le fichier est donc toujours complet, et `MISSING_PARAM` ne se
déclenche que si l'utilisateur vide un champ.

### Composants spéciaux

| `type` | Broche | Rôle | Ligne SPICE |
| --- | --- | --- | --- |
| `ground` | `1` | Relie son nœud à la masse : le nœud s'appelle `0`. | aucune |
| `label` | `1` | Donne un nom au nœud : `params.net = "out"`. | aucune |

Ces deux types n'ont **pas** de `name` : on peut poser autant de masses qu'on veut, et le nom d'une
étiquette est uniquement dans `params.net` (pas de doublon).

Un nom d'étiquette ne contient que des lettres, des chiffres et `_`, commence par une lettre, et ne
doit pas ressembler à un nom automatique (`n1`, `n2`…). SPICE ignore la casse : `Out` et `out`
désignent le même nœud.

## 4. Fils et jonctions

### Les extrémités

Chaque fil a deux extrémités, `from` et `to`. Une extrémité est **l'une** de ces trois formes :

| Forme | Exemple | Sens |
| --- | --- | --- |
| Broche | `{ "comp": "c1", "pin": "+" }` | Accrochée à la broche `+` du composant `c1`. |
| Jonction | `{ "junction": "j1" }` | Accrochée à la jonction `j1`. |
| Bout libre | `{ "x": 6, "y": 2 }` | Accrochée à rien (fil laissé en l'air). |

```json
{ "id": "w1", "from": { "comp": "c1", "pin": "+" }, "to": { "comp": "c2", "pin": "1" } }
{ "id": "w7", "from": { "comp": "c3", "pin": "1" }, "to": { "junction": "j1" },
  "points": [ { "x": 6, "y": 4 } ] }
```

- **`points`** (facultatif) : uniquement les **coudes** intermédiaires, pour le dessin. Les deux
  extrémités sont déduites de la broche, de la jonction ou des coordonnées du bout libre.
  La netlist ignore `points`.
- Plusieurs fils peuvent arriver sur la même broche : pas besoin de jonction dans ce cas.
- **Bout libre** : accepté (le fichier se sauvegarde), mais la netlist renvoie l'avertissement
  `WIRE_DANGLING`. Un fil n'a d'effet sur les connexions que par ses extrémités accrochées.
- Le fil **en train d'être tracé** (souris encore enfoncée) reste dans l'état de l'éditeur : il
  n'apparaît pas dans le schéma.

### Les jonctions

```json
{ "id": "j1", "position": { "x": 6, "y": 2 } }
```

**Fil lâché au milieu d'un autre fil** : l'éditeur **coupe** ce fil en deux et crée une jonction à
cet endroit. Trois fils arrivent alors sur la jonction. Le backend ne voit donc jamais de
« fil sur fil » : tout reste explicite.

Une jonction reliée à moins de 2 fils ne sert à rien : avertissement `JUNCTION_DANGLING`.

## 5. Bibliothèque

Un fichier JSON par type, par exemple `library/resistor.json`. Elle est servie à l'éditeur par
`GET /api/library` : **les noms et positions des broches ne sont définis qu'à un seul endroit.**

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

- `pins` : nom et position de chaque broche à la rotation 0, relative à `position`.
- `params` : chaque paramètre a un `name`, un `label` (français), une `unit`, un `default` et un
  `kind` :
  - `value` (par défaut) : un nombre SPICE (`"1k"`) ; le `default` est vérifié au chargement ;
  - `text` : du texte libre (le nom d'une étiquette) ;
  - `choice` : une valeur parmi `options`, chacune avec sa `value` (enregistrée) et son `label`
    (affiché), par exemple `{ "value": "pulse", "label": "Impulsion" }`.
- `symbol` : le **dessin** du symbole, sous forme d'une liste de formes simples (`line`, `rect`,
  `circle`, `arc`, `text`) en unités de grille, à la rotation 0. Le cahier des charges (§3) demande
  que les symboles soient dans la bibliothèque, pour l'étendre sans toucher au code. **Format exact
  proposé par Noé** (c'est l'éditeur qui le dessine).
- `spice` : le modèle de ligne. `{name}` = nom du composant, `{pin:X}` = nœud de la broche X,
  `{param}` = valeur d'un paramètre.
- `models` (facultatif, interne au backend) : le **texte** des modèles SPICE, par nom : une ligne
  `.model` (suites en `+` permises) ou un bloc `.subckt` … `.ends`. Par exemple
  `{ "D1N4148": ".model D1N4148 D(Is=2.52n Rs=0.568 N=1.752)" }`. Jamais de `.include` : le
  runner l'interdit (aucune lecture de fichier), décidé dans la PR #131 (issue #133). Le
  chargeur refuse tout autre directive (`.include`, `.lib`, `.control`…).

La réponse de `GET /api/library` ne contient que `type`, `label`, `prefix`, `pins` et `params`
(`LibraryComponent`) : `spice`, `waveforms` et `models` restent dans le backend.

### Noms des broches

| Composants | Broches |
| --- | --- |
| Résistance, condensateur, bobine | `1`, `2` |
| Sources de tension et de courant | `+`, `-` |
| Diodes (signal, redressement, Zener, LED) | `A` (anode), `K` (cathode) |
| Ampli-op idéal | `+`, `-`, `out` |
| Ampli-op réel | `+`, `-`, `out`, `V+`, `V-` |
| Transistor bipolaire (NPN, PNP) | `C`, `B`, `E` |
| MOSFET canal N | `D`, `G`, `S` |
| Masse, étiquette | `1` |

### Sources

Une source a une **forme d'onde**, utilisée pour `.op`, `.tran` et `.dc` :

```json
{
  "type": "voltage_source",
  "prefix": "V",
  "pins": [ { "name": "+", "x": 0, "y": -2 }, { "name": "-", "x": 0, "y": 2 } ],
  "spice": "{name} {pin:+} {pin:-} {waveform}",
  "waveforms": {
    "dc":    "DC {dc}",
    "pulse": "PULSE({v1} {v2} {delay} {rise} {fall} {width} {period})",
    "sin":   "SIN({offset} {amplitude} {frequency} {delay} {damping} {phase})"
  }
}
```

Dans le schéma : `"params": { "waveform": "pulse", "v1": "0", "v2": "5", ... }`.
La valeur de `waveform` s'écrit en **minuscules** (`dc`, `pulse`, `sin`), comme dans les fixtures de
`main`.

Dans la bibliothèque, chaque paramètre d'une source indique les formes d'onde qui l'utilisent,
pour que l'éditeur n'affiche que les champs utiles :

```json
{ "name": "delay", "label": "Retard", "unit": "s", "default": "0", "waveforms": ["pulse", "sin"] }
```

Le chargeur vérifie que cette liste correspond exactement aux `{…}` des modèles de `waveforms`.

La **source de courant** (`current_source`, préfixe `I`) a les mêmes broches `+` / `-` et les mêmes
formes d'onde. Attention au sens SPICE : un courant positif circule **dans la source** de `+` vers
`-`, donc il **sort** par la broche `-` dans le circuit. La flèche du symbole va de `+` vers `-`.

Il n'y a **pas** d'amplitude AC sur la source : pour une analyse `.ac`, c'est l'analyse qui désigne
la source d'entrée (`input_source_id`), et le backend ajoute `AC 1` à **cette** source seulement :

```
V1 in 0 DC 0 AC 1
```

C'est plus simple pour l'étudiant (il choisit la source dans la fenêtre d'analyse), et un oubli ne
peut plus casser le diagramme de Bode.

## 6. Analyses (inchangé par rapport à `main`)

L'analyse est envoyée **à côté** du schéma : `SimulationRequest = { schematic, analysis }`.
Les valeurs sont des **nombres en unités SI** (secondes, hertz, volts).

`POST /api/netlist` et `POST /api/simulate` reçoivent tous les deux ce même objet
`{ schematic, analysis }` : la netlist contient donc déjà sa ligne d'analyse.

| `kind` | Champs | Exemple | Ligne SPICE |
| --- | --- | --- | --- |
| `op` | aucun | `{"kind": "op"}` | `.op` |
| `tran` | `stop_time`, `max_step` (facultatif) | `{"kind": "tran", "stop_time": 0.01, "max_step": 1e-5}` | `.tran 10u 10m 0 10u` |
| `ac` | `input_source_id`, `start_frequency`, `stop_frequency`, `points_per_decade` (**20 par défaut**) | `{"kind": "ac", "input_source_id": "c1", "start_frequency": 10, "stop_frequency": 1e5, "points_per_decade": 100}` | `.ac dec 100 10 100k` |
| `dc` | `source_id`, `start`, `stop`, `step` | `{"kind": "dc", "source_id": "c1", "start": 0, "stop": 10, "step": 1}` | `.dc V1 0 10 1` |

- Les sources sont désignées par leur **id** : le nom SPICE est retrouvé à la traduction, donc
  renommer la source ne casse rien.
- **Ligne `.tran`** (décidé avec Antoine). En SPICE, c'est `.tran tstep tstop [tstart [tmax]]` : le
  1er argument est le pas d'**affichage**, le vrai pas maximum est le **4e**. Donc :
  - sans `max_step` : `.tran {stop_time / 1000} {stop_time}` (environ 1000 points, assez pour
    les courbes) ;
  - avec `max_step` : `.tran {max_step} {stop_time} 0 {max_step}`.

  La fixture `rc_tran` (`.tran 0 5m 0 10u` sur `main`) devient `.tran 10u 5m 0 10u` à la migration.

## 7. Traduction en netlist

1. **Vérifier** le schéma (section 8) et collecter **toutes** les erreurs. S'il y en a, on s'arrête.
2. **Regrouper les broches en nœuds** : chaque fil fusionne ses extrémités accrochées
   (structure « union-find »). Une jonction est une extrémité comme une autre.
3. **Nommer les nœuds**, dans cet ordre de priorité :
   1. un nœud qui touche une masse s'appelle `0` ;
   2. un nœud qui touche une étiquette prend son nom ;
   3. les autres s'appellent `n1`, `n2`… dans l'ordre où on les rencontre en parcourant les
      composants (ordre de la liste), puis leurs broches (ordre de la bibliothèque).
4. **Écrire l'en-tête** : `* ` suivi du `title` du schéma (ou `* Psice` s'il n'y en a pas). Les
   fixtures de `main` commencent par `* divider_op` / `* rc_tran` : à la migration, on leur donne
   un `title` et on met à jour leur `netlist.cir` en conséquence.
5. **Écrire une ligne par composant** (sauf masses et étiquettes), en remplissant le modèle `spice`.
6. **Écrire les modèles** (`models`) dont le nom apparaît sur ces lignes, une seule fois chacun.
7. **Écrire la ligne d'analyse**, puis `.end`.

## 8. Erreurs et avertissements

### Format

```json
{
  "code": "DUPLICATE_NAME",
  "message": "Deux composants s'appellent R1.",
  "targets": [ { "comp": "c2" }, { "comp": "c5" } ]
}
```

| Champ | Règle |
| --- | --- |
| `code` | Valeur d'une **liste fermée** (ci-dessous). En Pydantic un `Literal`, donc une union de chaînes en TypeScript. Stable : c'est ce que les tests vérifient. |
| `message` | En français, pour l'étudiant, avec le nom du composant. Peut changer. |
| `targets` | Les éléments à surligner. **Peut être vide** (`NO_GROUND` n'a rien à montrer). |

Une cible est l'une de ces formes :

| Cible | Exemple |
| --- | --- |
| Composant | `{ "comp": "c2" }` |
| Broche | `{ "comp": "c2", "pin": "2" }` |
| Fil | `{ "wire": "w3" }` |
| Jonction | `{ "junction": "j1" }` |
| Nœud | `{ "net": "n3" }` |

La cible **nœud** sert surtout aux erreurs de ngspice, qui ne connaît que les noms de nœuds SPICE.
L'éditeur retrouve les fils à surligner grâce à `nets` (section 9).

Le même format (nom `Diagnostic`, déjà utilisé par `SimulationResult`) sert aux erreurs de ngspice,
produites par `engines/` (Antoine) dans `SimulationResult.errors`.

### Codes de la netlist

| Code | Type | Exemple de message | Cibles |
| --- | --- | --- | --- |
| `NO_GROUND` | erreur | « Le circuit n'a pas de masse. » | aucune |
| `PIN_NOT_CONNECTED` | erreur | « La broche 2 de R1 n'est reliée à rien. » | la broche |
| `MISSING_NAME` | erreur | « Un composant n'a pas de nom. » | le composant |
| `DUPLICATE_ID` | erreur | « Deux éléments ont le même identifiant c2. » (composants, jonctions et fils partagent les mêmes ids) | les éléments |
| `DUPLICATE_NAME` | erreur | « Deux composants s'appellent R1. » (masses et étiquettes non concernées) | les composants |
| `BAD_PREFIX` | erreur | « C1 n'est pas un nom valide pour une résistance. » | le composant |
| `BAD_VALUE` | erreur | « R1 : la résistance « 1kk » n'est pas une valeur valide. » | le composant |
| `MISSING_PARAM` | erreur | « R1 : la résistance n'est pas renseignée. » | le composant |
| `UNKNOWN_TYPE` | erreur | « Le type « triode » n'existe pas dans la bibliothèque. » | le composant |
| `UNKNOWN_ENDPOINT` | erreur | « Le fil w3 est accroché à un composant, une broche ou une jonction qui n'existe pas. » | le fil |
| `LABEL_CONFLICT` | erreur | « Le nœud porte deux noms : in et out. » | les étiquettes |
| `LABEL_ON_GROUND` | erreur | « L'étiquette out est reliée à la masse. » | l'étiquette |
| `BAD_LABEL_NAME` | erreur | « « 2out » n'est pas un nom de nœud valide. » | l'étiquette |
| `AC_SOURCE_NOT_FOUND` | erreur | « La source d'entrée de l'analyse AC n'existe pas. » | aucune |
| `DC_SOURCE_NOT_FOUND` | erreur | « La source balayée n'existe pas. » | aucune |
| `WIRE_DANGLING` | avertissement | « Le fil w4 a un bout qui n'est relié à rien. » | le fil |
| `JUNCTION_DANGLING` | avertissement | « La jonction j1 est reliée à moins de 2 fils. » | la jonction |
| `MILLI_SUFFIX` | avertissement | « R1 : « 1M » vaut 1 milliohm. Pour un mégohm, écris « 1Meg ». » | le composant |

Une broche non reliée est une **erreur** (et non un avertissement) pour une raison
**pédagogique** : pour un débutant, c'est presque toujours un oubli de câblage. ngspice, lui,
simulerait sans problème une résistance avec une patte en l'air ; ce qui le fait échouer, c'est un
nœud sans chemin DC vers la masse (`SINGULAR_MATRIX`, ci-dessous). Un composant posé mais pas encore
câblé donne donc une erreur `PIN_NOT_CONNECTED` par broche.

### Codes de la simulation (ngspice, Antoine)

| Code | Cas | Cibles |
| --- | --- | --- |
| `SINGULAR_MATRIX` | Nœud flottant, sans chemin DC vers la masse (par exemple derrière un condensateur seul) | le nœud |
| `VOLTAGE_SOURCE_LOOP` | Boucle de sources de tension (ou source en parallèle avec une bobine) | les sources, les bobines |
| `NO_CONVERGENCE` | `timestep too small`, échec du « gmin / source stepping » | le composant si ngspice le nomme, sinon aucune |
| `SIMULATION_TIMEOUT` | Simulation trop longue, processus arrêté | aucune |
| `SIMULATION_FAILED` | Tout le reste ; le message brut de ngspice est ajouté à la fin du message | aucune |

Les deux tableaux forment **une seule liste fermée** de codes.

### Règles

- On **collecte toutes les erreurs** avant de répondre (pas seulement la première).
- Circuit faux = HTTP **200** avec `errors` non vide. JSON mal formé = **422** (Pydantic).
  Bug du serveur = **500**.

## 9. Réponse du backend (`NetlistResult`)

```json
{
  "netlist": "* Circuit RC\nV1 in 0 PULSE(0 5 0 1n 1n 10m 20m)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m 0 10u\n.end\n",
  "nets": { "in": ["w1", "w5"], "out": ["w2", "w6"], "0": ["w3", "w4"] },
  "components": { "V1": "c1", "R1": "c2", "C1": "c3" },
  "errors": [],
  "warnings": []
}
```

- `netlist` : directement exécutable par ngspice. Chaîne vide `""` s'il y a des erreurs.
- `nets` : nœud → fils qui le forment. Clic sur un fil → tension du nœud (`v(out)`).
- `components` : nom SPICE → id. Clic sur un composant → son courant.

## 10. Questions encore ouvertes

| Question | Avec qui |
| --- | --- |
| Format exact du champ `symbol` de la bibliothèque. | Noé (il propose) |
| Courant dans une résistance ou un condensateur : `.save @r1[i]` ou source de 0 V en série ? | Antoine |
| Signe du courant d'une source : SPICE donne `i(v1) < 0` quand elle fournit du courant. On l'inverse à l'affichage ? | Noémi |

Les exemples complets (ce que je reçois, ce que je renvoie) sont dans
[`exemples-netlist.md`](exemples-netlist.md).
