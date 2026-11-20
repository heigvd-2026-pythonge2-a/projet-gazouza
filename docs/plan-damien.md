# Plan de travail — Bibliothèque, netlist et API (Damien)

Feuille de route de ma partie, étape par étape. **Chaque étape se termine par une phase de test** :
on ne passe pas à la suivante tant que ses tests ne sont pas verts.

> Document de suivi, partagé avec l'équipe pour qu'elle voie l'ordre de mon travail et les
> décisions qui me bloquent (voir « Décisions à prendre en équipe » en bas).

---

## Comment lire ce plan

Chaque étape a la même forme :

- **But** : ce que l'étape apporte.
- **Fichiers** : où écrire le code (toujours dans mes dossiers : `backend/app/netlist/`,
  `models/`, `api/`, `importers/`).
- **À coder** : la liste des choses à faire.
- **🧪 Phase de test** : les tests à écrire et la commande à lancer.
- **✅ Terminé quand** : la condition pour passer à la suite.
- **Git** : la branche et la PR.

### Les commandes de test (toujours dans `backend/`)

```powershell
cd backend
```
```powershell
uv run pytest -v
```
```powershell
uv run pytest --cov=app --cov-report=term-missing
```
```powershell
uv run ruff check --fix . ; uv run ruff format .
```

- `pytest -v` : lance tous les tests et affiche leur nom.
- `pytest tests/test_values.py -v` : lance un seul fichier de tests.
- `--cov` : montre le pourcentage de code testé et les lignes jamais exécutées (la CI exige ≥ 80 %).
- `ruff` : corrige le style. La CI échoue si ce n'est pas propre.

### Les 3 niveaux de test

| Niveau | Quoi | Exemple |
| --- | --- | --- |
| Unitaire | Une petite fonction seule | `parse_value("1k") == 1000` |
| « Golden » (fixtures) | Un circuit complet → netlist attendue, caractère pour caractère | `rc_tran/schematic.json` → `rc_tran/netlist.cir` |
| Réel (ngspice) | La netlist tourne vraiment dans ngspice | marqué `@pytest.mark.ngspice`, avec Antoine |

---

## Vue d'ensemble

| Phase | Semaines | Étapes | Heures | Dépend de |
| --- | --- | --- | --- | --- |
| 0. Installation | S1 | 0 | ~1 h | — |
| 1. Proposition du format | S1–2 | 1 | ~2 h | — |
| 2. Cœur de la netlist | S1–2 | 2 à 7 | ~12 h | rien (indépendant du format des fils) |
| 3. Contrat et connexions | S2–3 | 8 à 10 | ~8 h | accord de Noé et Antoine |
| 4. API | S3–5 | 11 à 13 | ~10 h | étape 10 |
| 5. Analyses et sources | S3–5 | 14 à 15 | ~7 h | étape 13 |
| 6. Composants avancés | S6–8 | 16 à 18 | ~25 h | étape 15 |
| 7. Export et import `.asc` | S9–10 | 19 à 20 | ~15 h | étape 18 |
| 8. Finition | S11–12 | 21 à 22 | ~10 h | tout |

---

## Phase 0 — Installation (S1, ~1 h)

### Étape 0 — Préparer mon poste

**But** : pouvoir lancer les tests du projet sur mon PC.

**À faire** :

- [ ] Installer **uv** (il n'est pas encore installé sur mon PC) :
  ```powershell
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  ```
  puis **fermer et rouvrir** le terminal.
- [ ] Installer les dépendances du backend :
  ```powershell
  cd backend
  ```
  ```powershell
  uv sync
  ```
- [ ] Activer les vérifications automatiques avant chaque commit :
  ```powershell
  uv run pre-commit install
  ```

**🧪 Phase de test** :
```powershell
uv run pytest -v
```
Les tests déjà présents (`test_api.py`, `test_fixtures.py`) doivent passer.

**✅ Terminé quand** : tout est vert sur mon PC.

**Git** : rien à commiter.

---

## Phase 1 — Proposition du format (S1–2, ~2 h)

### Étape 1 — Ouvrir la PR de proposition

**But** : lancer la discussion avec l'équipe sur les fils explicites et le format des erreurs.

**À faire** :

- [ ] Branche `docs/schematic-format-proposal`, avec `docs/format-schema.md`,
  `docs/exemples-netlist.md` et ce plan.
- [ ] Description de la PR = le message à l'équipe (ce qui change, pourquoi, exemples avant/après).
- [ ] Reviewers : Noé (fils) et Antoine (erreurs).
- [ ] Poser aussi la question de l'**analyse dans la netlist** (voir « Décisions à prendre » en
  bas de ce document).

**🧪 Phase de test** : pas de code. La « validation », c'est la relecture de l'équipe.

**✅ Terminé quand** : la PR est ouverte. **Je n'attends pas la réponse pour la phase 2.**

---

## Phase 2 — Cœur de la netlist (S1–2, ~12 h)

Tout ce qui suit est **indépendant** du choix sur les fils : je peux le coder tout de suite.

**Git pour toute la phase** : branche `feat/netlist-core`. Je pousse régulièrement et j'ouvre une
PR en **brouillon** (« Create draft pull request ») pour montrer l'avancement.

### Étape 2 — Lire les valeurs SPICE

**But** : transformer le texte saisi par l'utilisateur en nombre, et refuser les valeurs fausses.

**Fichiers** : `backend/app/netlist/values.py`, `backend/tests/test_values.py`

**À coder** :

- [ ] `parse_value(text: str) -> float`
- [ ] Suffixes SPICE : `f p n u m k Meg G T` (attention : `m` = milli, `Meg` = méga, insensible à
  la casse).
- [ ] Accepter : `"10"`, `"1k"`, `"4.7u"`, `"10Meg"`, `"1e-3"`, `"-5"`, `"1kOhm"` (texte après le
  suffixe ignoré, comme SPICE).
- [ ] Refuser (lever une erreur) : `""`, `"abc"`, `"1kk"`, `"k1"`.

**🧪 Phase de test** :

- [ ] Un test par suffixe : `parse_value("1k") == 1000`, `parse_value("1Meg") == 1e6`,
  `parse_value("1m") == 1e-3`…
- [ ] Cas pièges : `"1M"` vaut 1e-3 (milli !), `"1MEG"` vaut 1e6.
- [ ] Les valeurs invalides lèvent bien une erreur (`pytest.raises`).
- [ ] Astuce : `@pytest.mark.parametrize` pour tester 20 valeurs en une seule fonction.

```powershell
uv run pytest tests/test_values.py -v
```

**✅ Terminé quand** : tous les tests sont verts et `values.py` est couvert à 100 %.

### Étape 3 — La bibliothèque de composants

**But** : décrire chaque type de composant une seule fois, dans un fichier JSON.

**Fichiers** : `backend/app/netlist/library/*.json`, `backend/app/netlist/library.py`,
`backend/tests/test_library.py`

**À coder** :

- [ ] Fichiers JSON : `resistor`, `capacitor`, `inductor`, `voltage_source`, `ground`, `label`.
- [ ] Contenu de chacun : `type`, `label` (français), `prefix`, `pins` (nom + position),
  `params` (nom, unité, défaut), `spice` (modèle de ligne), `symbol` (dessin, format proposé par
  Noé).
- [ ] **À pousser tôt** (demande de Noé) : une petite PR `feat/library-basic` avec les JSON de R, C,
  source, masse et étiquette, pour qu'il dessine les broches sans attendre `GET /api/library`.
- [ ] `load_library() -> dict[str, ComponentType]` qui lit et valide tous les fichiers
  (petit modèle Pydantic interne `ComponentType`, **pas** dans `models/` pour l'instant).

**🧪 Phase de test** :

- [ ] Tous les fichiers se chargent sans erreur.
- [ ] Chaque type a un préfixe (sauf `ground` et `label`).
- [ ] Chaque `{pin:X}` du modèle `spice` correspond à une broche qui existe.
- [ ] Chaque `{param}` du modèle `spice` correspond à un paramètre qui existe.
- [ ] Chaque valeur par défaut passe dans `parse_value` (réutilise l'étape 2).

**✅ Terminé quand** : les tests sont verts. Ces tests protégeront aussi les futurs composants
(diodes, transistors…) automatiquement.

### Étape 4 — Remplir une ligne SPICE

**But** : à partir d'un composant et des noms de ses nœuds, écrire sa ligne de netlist.

**Fichiers** : `backend/app/netlist/writer.py`, `backend/tests/test_writer.py`

**À coder** :

- [ ] `component_line(comp, comp_type, pin_nodes: dict[str, str]) -> str`
- [ ] Remplace `{name}`, `{pin:X}` et `{param}`.
- [ ] Pour les sources : choisir la forme d'onde (`dc`, `pulse`, `sin`, en minuscules dans le
  schéma) et ajouter `AC 1` **seulement** à la source désignée par `input_source_id` d'une analyse
  `.ac`.

**🧪 Phase de test** :

- [ ] Résistance : `R1` + nœuds `in`/`out` → `"R1 in out 1k"`.
- [ ] Source DC → `"V1 in 0 DC 10"`.
- [ ] Source PULSE → `"V1 in 0 PULSE(0 5 0 1n 1n 10m 20m)"`.
- [ ] Source d'entrée d'une analyse `.ac` → `"V1 in 0 DC 0 AC 1"`.

**✅ Terminé quand** : les lignes produites sont identiques à celles des fixtures.

### Étape 5 — Nommer les nœuds (union-find)

**But** : regrouper les broches reliées en nœuds et leur donner un nom.

**Fichiers** : `backend/app/netlist/nodes.py`, `backend/tests/test_nodes.py`

**À coder** :

- [ ] Une petite classe `UnionFind` (`union(a, b)`, `find(a)`).
- [ ] `name_nodes(groups, grounds, labels) -> dict[pin, str]`, dans cet ordre de priorité :
  masse → `0`, étiquette → son nom, sinon `n1`, `n2`… dans l'ordre des composants puis des broches.

**🧪 Phase de test** :

- [ ] Union-find : `union(a, b)`, `union(b, c)` ⇒ `find(a) == find(c)`.
- [ ] Un groupe avec une masse s'appelle `0`.
- [ ] Un groupe avec l'étiquette `out` s'appelle `out`.
- [ ] Les autres sont numérotés dans l'ordre attendu (`n1`, puis `n2`).
- [ ] Deux étiquettes différentes sur le même nœud → erreur `LABEL_CONFLICT`.
- [ ] Une étiquette sur la masse → erreur `LABEL_ON_GROUND`.

**✅ Terminé quand** : tous les cas ci-dessus sont verts.

### Étape 6 — La ligne d'analyse

**But** : traduire l'analyse (format **déjà sur main** : `kind` + nombres SI) en ligne SPICE.

**Fichiers** : `backend/app/netlist/analysis.py`, `backend/tests/test_analysis.py`

**À coder** :

- [ ] `analysis_line(analysis, components) -> str`
- [ ] `op` → `.op`
- [ ] `tran` (règle décidée avec Antoine) : avec `max_step` → `.tran {max_step} {stop_time} 0 {max_step}`
  (ex. `.tran 10u 5m 0 10u`) ; sans `max_step` → `.tran {stop_time / 1000} {stop_time}`.
  Attention : le 1er argument est le pas d'**affichage**, le pas maximum est le **4e**.
- [ ] `ac` : `points_per_decade` vaut 20 par défaut si absent.
- [ ] `ac` → `.ac dec 100 10 100k`
- [ ] `dc` → `.dc V1 0 10 1` (retrouver le **nom** `V1` à partir de l'**id** de la source).
- [ ] Une fonction `format_value(0.005) -> "5m"` (l'inverse de l'étape 2) pour une netlist lisible.

**🧪 Phase de test** :

- [ ] Un test par type d'analyse, avec les objets de `app.models` (`OpAnalysis`, `TranAnalysis`…).
- [ ] `format_value` puis `parse_value` redonne la même valeur (test « aller-retour »).
- [ ] `.dc` avec un id de source inconnu → erreur `DC_SOURCE_NOT_FOUND`.
- [ ] `.ac` avec un `input_source_id` inconnu → erreur `AC_SOURCE_NOT_FOUND`.

**✅ Terminé quand** : la ligne produite pour `rc_tran` est identique à celle de `netlist.cir`.

### Étape 7 — Les vérifications du circuit

**But** : détecter les erreurs de l'étudiant **avant** de lancer ngspice, avec un message clair.

**Fichiers** : `backend/app/netlist/checks.py`, `backend/tests/test_checks.py`

**À coder** (une fonction par vérification, chacune renvoie une liste d'erreurs) :

- [ ] `NO_GROUND` : pas de masse.
- [ ] `PIN_NOT_CONNECTED` : broche reliée à rien (erreur, une par broche).
- [ ] `MISSING_NAME` : composant sans nom (sauf masses et étiquettes, qui n'en ont pas).
- [ ] `DUPLICATE_NAME` : deux composants avec le même nom (cibles = **les deux** ; masses et
  étiquettes non concernées).
- [ ] `BAD_PREFIX` : `C1` utilisé pour une résistance.
- [ ] `BAD_VALUE` : `"1kk"`.
- [ ] `MISSING_PARAM` : paramètre obligatoire vide.
- [ ] `UNKNOWN_TYPE` : type absent de la bibliothèque.
- [ ] `UNKNOWN_ENDPOINT` : fil accroché à un composant, une broche ou une jonction qui n'existe pas.
- [ ] `BAD_LABEL_NAME` : nom d'étiquette invalide (`2out`).
- [ ] Avertissement `WIRE_DANGLING` : fil avec un bout libre `{x, y}`.
- [ ] Avertissement `JUNCTION_DANGLING` : jonction reliée à moins de 2 fils.
- [ ] Avertissement `MILLI_SUFFIX` : valeur en `M` (milli), probablement un `Meg` oublié.

La liste complète et les messages sont dans `format-schema.md`, section 8.

**🧪 Phase de test** :

- [ ] Pour **chaque** code : un petit circuit faux → on obtient exactement ce code, avec les bonnes
  cibles.
- [ ] Un circuit correct → aucune erreur.
- [ ] Plusieurs erreurs en même temps → elles sont **toutes** renvoyées (pas seulement la première).
- [ ] On teste le `code`, pas le texte du message (le message peut changer).

**✅ Terminé quand** : un test par code d'erreur, tous verts. Couverture du dossier `netlist/` ≥ 80 %.

---

## Phase 3 — Contrat et connexions (S2–3, ~8 h)

⚠️ **Nécessite l'accord de Noé et Antoine** sur la PR de proposition.

### Étape 8 — Mettre à jour le contrat

**But** : remplacer le brouillon de `backend/app/models/` par la version décidée en équipe.

**Fichiers** : `backend/app/models/schematic.py`, `netlist.py`

**À coder** :

- [ ] `schematic.py` : fils explicites (`from`/`to` = broche ou jonction, `points` facultatif),
  `junctions`, `title` facultatif. On garde `position`, `rotation`, `mirror`, `params`.
- [ ] `netlist.py` : `Diagnostic` avec `code`, `message`, `targets`.
- [ ] Régénérer les fichiers dérivés (**obligatoire**, sinon la CI échoue) :
  ```powershell
  uv run python scripts/export_openapi.py
  ```
  ```powershell
  cd ../frontend
  ```
  ```powershell
  pnpm gen:api
  ```

**🧪 Phase de test** :

- [ ] Un schéma valide se charge (`Schematic.model_validate_json(...)`).
- [ ] Un fil sans `from` est refusé par Pydantic (→ HTTP 422).
- [ ] Une extrémité qui a à la fois `comp` et `junction` est refusée.
- [ ] `git diff` sur `shared/openapi.json` montre bien le changement attendu.

**✅ Terminé quand** : tests verts et fichiers générés à jour.

### Étape 9 — Mettre à jour les fixtures partagées

**But** : que les fixtures de toute l'équipe suivent le nouveau contrat, et ajouter mes circuits.

**Fichiers** : `shared/fixtures/*/`

**À faire** :

- [ ] Convertir `divider_op` et `rc_tran` en version 2 (fils `from`/`to`), en **ajoutant les
  étiquettes `in` et `out`** pour garder les mêmes noms de nœuds, et en retirant les `name` des
  masses. Modèle : `docs/exemples-netlist.md`, exemples 1 et 2.
- [ ] Leur donner un `title` et mettre à jour leur `netlist.cir` (en-tête `* {title}`, nouvelle ligne
  `.tran 10u 5m 0 10u` pour `rc_tran`).
- [ ] Ajouter `lowpass_ac` et `loaded_divider_dc` (exemples 3 et 4), avec les 5 fichiers chacun.
- [ ] Supprimer mon ancien dossier local `backend/tests/fixtures/circuits/` (ancien format, jamais
  commité).
- [ ] Mettre à jour `shared/fixtures/README.md`.

**🧪 Phase de test** :
```powershell
uv run pytest tests/test_fixtures.py -v
```
- [ ] `test_fixtures.py` passe pour les 4 circuits.

**✅ Terminé quand** : vert. **Git** : étapes 8 et 9 = **une seule PR** `feat/schematic-contract`
(le contrat et ses fixtures vont ensemble), relue par Noé, Antoine et Noémi.

### Étape 10 — Trouver les connexions et assembler la netlist

**But** : la fonction complète `schéma + analyse → NetlistResult`.

**Fichiers** : `backend/app/netlist/connections.py`, `backend/app/netlist/generate.py`,
`backend/tests/test_generate.py`

**À coder** :

- [ ] `find_connections(schematic)` : parcourir les fils, `union` de leurs deux extrémités
  (seule fonction qui dépend du format des fils).
- [ ] Remplir `nets` (nœud → ids des fils) et `components` (nom SPICE → id).
- [ ] `generate_netlist(schematic, analysis) -> NetlistResult` qui enchaîne : vérifications →
  connexions → noms des nœuds → lignes → analyse → `.end`.

**🧪 Phase de test** — le test « golden », le plus important :

- [ ] Pour **chaque** dossier de `shared/fixtures/` : `generate_netlist(schematic, analysis)` doit
  donner exactement `netlist.json` (netlist, nets, components).
- [ ] Un circuit avec une jonction en T donne le bon nombre de nœuds.

```powershell
uv run pytest tests/test_generate.py -v
```

**✅ Terminé quand** : les 4 circuits de référence passent. **Premier jalon atteint.**

---

## Phase 4 — API (S3–5, ~10 h)

**Git** : branche `feat/api-netlist`.

### Étape 11 — Route `POST /api/netlist`

**Fichiers** : `backend/app/api/`, `backend/app/main.py` (le stub qui renvoie 501)

**À coder** :

- [ ] La route reçoit `{ schematic, analysis }` (même objet que `SimulationRequest`, décidé avec
  Noé) : il faut changer sa signature dans `main.py`.
- [ ] La route reste **fine** : elle reçoit, appelle `generate_netlist`, renvoie le résultat.

**🧪 Phase de test** :

- [ ] Avec `TestClient` : envoyer `divider_op/schematic.json` → HTTP 200 et la netlist attendue.
- [ ] Circuit sans masse → HTTP **200** avec `errors` contenant `NO_GROUND` (pas une erreur HTTP).
- [ ] JSON mal formé → HTTP **422**.
- [ ] Mettre à jour `test_api.py` : le test `test_netlist_not_implemented_yet` doit disparaître.
- [ ] Test à la main : lancer le serveur, puis ouvrir http://localhost:8000/docs (page de test
  automatique de FastAPI).
  ```powershell
  uv run uvicorn app.main:app --reload
  ```

**✅ Terminé quand** : tests verts et la route marche depuis `/docs`.

### Étape 12 — Route `GET /api/library`

**But** : Noé a besoin de la liste des composants (broches, paramètres) pour dessiner.

**🧪 Phase de test** :

- [ ] La réponse contient `resistor`, `capacitor`… avec leurs broches.
- [ ] Le format est dans le contrat (régénérer `openapi.json` + `pnpm gen:api`).

**✅ Terminé quand** : Noé peut s'en servir (le lui montrer).

### Étape 13 — Route `POST /api/simulate` (avec Antoine)

**But** : brancher ma netlist sur son moteur ngspice.

**À coder** :

- [ ] `generate_netlist` → s'il y a des erreurs, on s'arrête et on les renvoie → sinon on appelle
  le moteur d'Antoine (`app/engines/`, son code).

**🧪 Phase de test** :

- [ ] Test **sans** ngspice : remplacer le moteur par un faux (« mock ») qui renvoie
  `result.json` → vérifier que la route renvoie bien ce résultat.
- [ ] Test **avec** ngspice (`@pytest.mark.ngspice`) : le RC donne v(out) ≈ 3,16 V à t = 1 ms.
- [ ] **Test de bout en bout avec Noé** : dessiner un RC dans l'éditeur → simuler → voir la courbe.

**✅ Terminé quand** : le RC marche de bout en bout. **Jalon S3–5 atteint.**

---

## Phase 5 — Analyses et sources (S3–5, ~7 h)

### Étape 14 — Sources de courant et SIN

**À faire** :

- [ ] `current_source.json` (préfixe `I`, attention au sens du courant).
- [ ] Forme d'onde `SIN` sur les deux sources.

**🧪 Phase de test** :

- [ ] Ligne SPICE attendue pour chaque cas.
- [ ] Fixture : source de courant 1 mA dans 1 kΩ → 1 V (vérifié avec ngspice).
- [ ] Les tests de la bibliothèque (étape 3) passent automatiquement pour les nouveaux fichiers.

### Étape 15 — `.ac` et `.dc` de bout en bout

**🧪 Phase de test** :

- [ ] `lowpass_ac` : −3 dB à 1 kHz (avec ngspice).
- [ ] `loaded_divider_dc` : v(n2) = V1 / 3 sur tout le balayage.
- [ ] Test avec Noémi : le diagramme de Bode s'affiche.

**✅ Terminé quand** : les 4 analyses marchent depuis l'interface.

---

## Phase 6 — Composants avancés (S6–8, ~25 h)

**Git** : une branche **par famille** (`feat/library-diodes`, `feat/library-opamps`,
`feat/library-transistors`).

Pour chaque famille, la même méthode :

1. Choisir les modèles SPICE (`.model` / `.subckt`) et **vérifier leur licence** (noter la
   source dans `THIRD_PARTY_LICENSES.md`).
2. Ajouter les fichiers JSON de la bibliothèque, avec `includes`.
3. Gérer les `.include` dans la netlist (sans doublons).
4. Écrire une fixture vérifiée avec ngspice.

### Étape 16 — Diodes (signal, redressement, Zener, LED)

**🧪 Phase de test** :

- [ ] La netlist contient le `.include` une seule fois, même avec 4 diodes.
- [ ] Fixture : redresseur simple alternance → la tension de sortie est ≈ 0 pendant l'alternance
  négative.
- [ ] Fixture : Zener 5,1 V → la sortie est limitée à ≈ 5,1 V.

### Étape 17 — Amplis-op (idéal et réel)

**🧪 Phase de test** :

- [ ] Fixture : amplificateur non inverseur gain 10 → 0,1 V en entrée donne 1 V en sortie.
- [ ] L'ampli réel sature près de ses alimentations.

### Étape 18 — Transistors (BJT NPN/PNP, MOSFET canal N)

**🧪 Phase de test** :

- [ ] Fixture : NPN en interrupteur (saturé / bloqué).
- [ ] Fixture : MOSFET : courant nul sous la tension de seuil.

**✅ Terminé quand** (phase 6) : un test qui passe par famille. **Jalon S6–8 atteint.**

---

## Phase 7 — Export et import `.asc` (S9–10, ~15 h)

### Étape 19 — Export de la netlist

- [ ] Route ou fonction qui renvoie le texte `.cir` à enregistrer.

**🧪 Phase de test** :

- [ ] Le fichier exporté se lance dans ngspice sans modification.

### Étape 20 — Import LTspice `.asc`

⚠️ Décision à prendre avant : garder l'import (~15–20 h) ou le retirer du cahier des charges.

**Fichiers** : `backend/app/importers/asc.py`, `backend/tests/test_asc.py`,
quelques fichiers `.asc` de test dans `backend/tests/`.

**À coder**, en 4 sous-étapes testées **une par une** :

- [ ] 20a. Lire les lignes `WIRE`, `SYMBOL`, `SYMATTR`, `FLAG`, `TEXT`.
  🧪 Un `.asc` de 10 lignes → la bonne liste d'objets.
- [ ] 20b. Placer les broches des symboles supportés (rotation `R0/R90/R180/R270`, miroir `M0…`).
  🧪 Une résistance en `R90` → ses broches aux bonnes coordonnées.
- [ ] 20c. Relier les segments qui se touchent (bout à bout et en T) → fils `from`/`to` + jonctions.
  🧪 Trois segments en T → une jonction et trois fils.
- [ ] 20d. Traduire les directives (`.tran 5m` → `TranAnalysis(stop_time=0.005)`) et signaler
  les symboles inconnus (`UNKNOWN_TYPE`).
  🧪 Un symbole non supporté → erreur claire, pas de plantage.

**🧪 Test final** :

- [ ] Un RC dessiné dans LTspice → importé → `generate_netlist` → même résultat que la fixture
  `rc_tran`.

**✅ Terminé quand** : 3 circuits LTspice réels s'importent et se simulent. **Jalon S9–10 atteint.**

---

## Phase 8 — Finition (S11–12, ~10 h)

### Étape 21 — Couverture et nettoyage

**🧪 Phase de test** :
```powershell
uv run pytest --cov=app --cov-report=term-missing
```
- [ ] Couverture ≥ 80 % (lire les lignes « Missing » et ajouter les tests manquants).
- [ ] `ruff check` et `ruff format --check` sans erreur.
- [ ] Tous les tests ngspice passent sur la version finale (build d'Antoine).

### Étape 22 — Rapport et démo

- [ ] Rapport : expliquer la chaîne schéma → connexions → noms → lignes → netlist, avec le RC
  comme exemple.
- [ ] Démo orale : montrer un test « golden », puis une erreur (`NO_GROUND`) surlignée dans
  l'éditeur.
- [ ] Pouvoir expliquer **chaque fichier** de `netlist/` en une phrase.

---

## Décisions à prendre en équipe

| Question | Avec qui | Bloque l'étape |
| --- | --- | --- |
| ~~Fils explicites ou géométriques ?~~ **Explicites, validé par Noé** | Noé | 8, 10 |
| Format des erreurs (`code`, `targets`) : validé par Noé, reste les codes ngspice | Antoine | 8 |
| ~~Qui ajoute l'analyse à la netlist ?~~ **La route reçoit `{ schematic, analysis }`** | Noé | 10, 11 |
| ~~Forme de la ligne `.tran`~~ **`.tran {max_step} {stop} 0 {max_step}`, ou `.tran {stop/1000} {stop}`** | Antoine | 6 |
| ~~Codes d'erreur ngspice~~ **`SINGULAR_MATRIX`, `VOLTAGE_SOURCE_LOOP`, `NO_CONVERGENCE`, `SIMULATION_TIMEOUT`, `SIMULATION_FAILED` + cible `{net}`** | Antoine | 8 |
| ~~En-tête de la netlist~~ **`* {title}` ; `netlist.cir` des fixtures mis à jour à la migration** | Noé | 9, 10 |
| Format exact du champ `symbol` (dessin des symboles) | Noé (il propose) | 3 |
| Accès de Noémi au dépôt (elle n'apparaît pas dans les reviewers) | Antoine | — |
| Courant dans R/C : `.save @r1[i]` ou source 0 V en série ? | Antoine | 13 |
| Inverser le signe du courant des sources à l'affichage ? | Noémi | 13 |
| Garder l'import `.asc` ou le retirer du cahier des charges ? | Toute l'équipe | 20 |

---

## Règles à ne pas oublier

- Une étape = une branche = une PR. **Jamais de push sur `main`.**
- Commits en anglais : `feat:`, `fix:`, `test:`, `docs:`.
- Je ne touche **que** mes dossiers : `models/`, `netlist/`, `importers/`, `api/`.
- Toute modification de `models/` = PR dédiée + `export_openapi.py` + `pnpm gen:api` + fixtures.
- Pas de nouvelle dépendance sans en parler à l'équipe.
- Les tests vérifient les **codes** d'erreur, pas les phrases.
- Avant chaque PR : `pytest`, `ruff check`, `ruff format` doivent passer.
