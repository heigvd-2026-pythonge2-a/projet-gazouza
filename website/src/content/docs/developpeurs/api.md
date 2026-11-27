---
title: API du backend
description: Les routes HTTP du backend FastAPI de Psice — bibliothèque, netlist et simulation.
---

Le backend est une API **FastAPI** locale, sur le port 8000 en développement. Le contrat est
défini par les modèles Pydantic de `backend/app/models/` et exporté dans
[`shared/openapi.json`](https://github.com/heigvd-2026-pythonge2-a/projet-gazouza/blob/main/shared/openapi.json).

:::tip[Documentation interactive]
Backend lancé (`uv run uvicorn app.main:app --reload`), ouvre http://localhost:8000/docs pour
essayer chaque route depuis le navigateur.
:::

## Routes

| Méthode | Route | Reçoit | Renvoie |
|---|---|---|---|
| `GET` | `/api/health` | — | `{ "status": "ok" }` |
| `GET` | `/api/library` | — | Liste de `LibraryComponent` |
| `POST` | `/api/netlist` | `SimulationRequest` | `NetlistResult` |
| `POST` | `/api/simulate` | `SimulationRequest` | `SimulationResult` |
| `POST` | `/api/import/asc` | `{ "text": "...", "title": "..." }` (texte du `.asc`) | `ImportResult` |

### `GET /api/library`

La partie **publique** de la bibliothèque : pour chaque type, `type`, `label`, `prefix`, `pins` et
`params`. Les modèles de ligne SPICE et le texte des modèles restent dans le backend. La réponse
exacte est figée dans
[`shared/fixtures/library.json`](https://github.com/heigvd-2026-pythonge2-a/projet-gazouza/blob/main/shared/fixtures/library.json).

### `POST /api/import/asc`

Importe un schéma LTspice. Le client envoie le **texte** du fichier (déjà décodé) et, s'il le
veut, un titre. La réponse `ImportResult` contient le `schematic` (ou `null` si le fichier est
illisible), la première `analysis` du fichier (ou `null`), et des diagnostics : `errors`
(`IMPORT_UNREADABLE`) et `warnings` (`IMPORT_SKIPPED` pour une partie laissée de côté,
`IMPORT_CHANGED` pour une partie adaptée). L'import est partiel : toujours HTTP 200.

### `SimulationRequest`

Le corps de `POST /api/netlist` et `POST /api/simulate` :

```json
{
  "schematic": { "version": 2, "components": [], "junctions": [], "wires": [] },
  "analysis": { "kind": "tran", "stop_time": 0.005, "max_step": 1e-5 }
}
```

| `kind` | Champs (unités SI) |
|---|---|
| `op` | aucun |
| `tran` | `stop_time`, `max_step` (facultatif) |
| `ac` | `input_source_id`, `start_frequency`, `stop_frequency`, `points_per_decade` (20 par défaut) |
| `dc` | `source_id`, `start`, `stop`, `step` |

### `NetlistResult`

```json
{
  "netlist": "* Circuit RC\nV1 in 0 PULSE(0 5 0 1n 1n 10m 20m)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m 0 10u\n.end\n",
  "nets": { "in": ["w1", "w5"], "out": ["w2", "w6"], "0": ["w3", "w4"] },
  "components": { "V1": "c1", "R1": "c2", "C1": "c3" },
  "errors": [],
  "warnings": []
}
```

- `netlist` : directement exécutable par ngspice ; `""` s'il y a des erreurs.
- `nets` : nœud → fils qui le forment (clic sur un fil → tension du nœud).
- `components` : nom SPICE → id (clic sur un composant → son courant).

### `SimulationResult`

```json
{
  "analysis": "op",
  "axis": null,
  "traces": [
    { "name": "v(out)", "kind": "voltage", "unit": "V", "net": "out", "values": [5.0] },
    { "name": "i(R1)", "kind": "current", "unit": "A", "component_id": "c2", "values": [0.005] }
  ],
  "errors": [],
  "warnings": []
}
```

- `axis` : la variable indépendante (`time`, `frequency` ou la source balayée), absente pour
  `.op`.
- `traces` : une trace par tension de nœud ou courant de composant, une valeur par point de
  l'axe. Pour `.ac`, `imag` contient la partie imaginaire.

## Erreurs : toujours HTTP 200

Un **circuit faux** n'est pas une erreur HTTP : la réponse est **200** avec `errors` rempli.
Chaque erreur est un `Diagnostic` :

```json
{
  "code": "DUPLICATE_NAME",
  "message": "Plusieurs composants s'appellent R1.",
  "targets": [ { "comp": "c2" }, { "comp": "c5" } ]
}
```

| Champ | Rôle |
|---|---|
| `code` | Valeur d'une liste fermée, stable (c'est ce que les tests vérifient) |
| `message` | En français, pour l'étudiant ; peut changer |
| `targets` | Les éléments à surligner : `comp`, `comp` + `pin`, `wire`, `junction` ou `net` |

Un JSON mal formé donne **422** (validation Pydantic), un bug du serveur **500**. La liste des
codes est sur la page [Messages d'erreur](/projet-gazouza/guide/erreurs/).
