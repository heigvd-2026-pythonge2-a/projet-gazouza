@AGENTS.md

## Spécifique à Claude Code

- Les instructions communes à tous les agents sont dans `AGENTS.md` (importé ci-dessus) :
  c'est ce fichier qu'il faut modifier, pas celui-ci.
- `backend/CLAUDE.md` et `frontend/CLAUDE.md` sont chargés automatiquement quand on travaille
  dans ces dossiers.
- Réglages partagés : `.claude/settings.json` (commité). Réglages personnels :
  `.claude/settings.local.json` (ignoré par git).

### Économiser le modèle principal

Le modèle de la session (le plus cher) sert à réfléchir et à écrire du code. Ce qui ne demande
pas de jugement passe par un sous-agent moins cher :

- **Tests, lint, formatage, build** : agent `test-runner` (`.claude/agents/test-runner.md`,
  modèle Haiku), qui lance les commandes et ne renvoie qu'un résumé OK / ÉCHEC avec les
  erreurs utiles. À utiliser quand la sortie est longue : `uv run pytest` complet avec
  couverture, `pnpm build`, lint de tout un module, ou plusieurs parties à vérifier.
  Pour une commande courte (un seul fichier de test, un `ruff check` sur deux fichiers),
  la lancer directement coûte moins cher que de démarrer un agent.
- **Recherches larges** dans le code (où est utilisé X, quels fichiers touchent Y) : agent
  `Explore` avec `model: "haiku"`.
- **Ce qui reste sur le modèle principal** : conception, écriture et relecture du code,
  diagnostic d'un test qui échoue, rédaction des PR et de la documentation.

Le résumé d'un sous-agent n'est pas une preuve : avant de déclarer une tâche terminée, vérifier
que les codes de sortie qu'il rapporte sont tous à 0, et relancer soi-même un test en échec
pour le diagnostiquer.
