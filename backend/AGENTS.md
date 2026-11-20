# Backend — instructions pour les agents IA

Complète le fichier [`AGENTS.md`](../AGENTS.md) à la racine.

## Structure

- `app/main.py` : application FastAPI, routes sous `/api/...`.
- `app/models/` : **contrat d'API** (Pydantic). Voir la règle n°1 du fichier racine.
- `app/netlist/` : `Schematic` → `NetlistResult` (fonctions pures, sans I/O).
- `app/importers/` : `.asc` LTspice → `Schematic`.
- `app/engines/` : exécution de ngspice et conversion de sa sortie en `SimulationResult`.
- `tests/` : pytest. `tests/test_fixtures.py` vérifie que `shared/fixtures/` respecte le contrat.

## Conventions

- Python 3.12, annotations de type partout, `from __future__` inutile.
- Garder la logique métier (netlist, parsing) **pure et testable sans ngspice** ; isoler les
  appels au processus ngspice dans `engines/`.
- Les routes restent fines : elles valident (Pydantic) et délèguent aux modules.
- Les erreurs prévisibles de l'utilisateur (circuit sans masse, valeur invalide…) sont
  renvoyées dans `errors` / `warnings` sous forme de `Diagnostic` (`code`, `message`,
  `targets`), pas en exception HTTP. Voir `docs/format-schema.md`, section 8.
- Tests : un test par cas de `shared/fixtures/` (« golden test ») en plus des tests unitaires.
- Les tests qui ont besoin du vrai ngspice sont marqués `@pytest.mark.ngspice`.
