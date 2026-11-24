# Fichiers sources du logo Psice

Sources du logo choisi dans l'issue #4 (« Monogramme circuit »), dans sa version où le grand
**P** est collé à « sice » (issue #154). Ces fichiers servent à l'icône de l'application, au
favicon et à l'écran de démarrage (issue #126). La présentation du logo et ses couleurs sont
décrites dans [`docs/logo.md`](../../docs/logo.md).

## Fichiers

| Fichier | Contenu | Usage prévu |
|---|---|---|
| `psice-logo.svg` | Logo complet « Psice », vectoriel, fond transparent | Écran de démarrage, documents |
| `psice-icon.svg` | Icône carrée : le P seul, avec point et borne, sur une tuile blanche arrondie | Icône à partir de 48 px, favicon |
| `psice-icon-small.svg` | Icône simplifiée : trait plus épais, sans point central, borne pleine | Icône en 16, 24 et 32 px |
| `psice.ico` | Icône Windows multi-tailles (16, 24, 32, 48, 64, 128, 256 px) | `--icon` de PyInstaller, fenêtre pywebview |
| `psice-icon-16.png`, `psice-icon-32.png`, `psice-icon-256.png` | Aperçus PNG de l'icône | Vérifier la lisibilité, favicon PNG |
| `make_brand.py` | Script qui génère tous ces fichiers, ainsi que `docs/images/psice-logo.png` et `docs/images/psice-logo-animation.gif` | Modifier ou régénérer le logo |

L'icône est posée sur une **tuile blanche arrondie** : sans elle, le P bleu nuit disparaît sur
la barre des tâches en mode sombre de Windows.

Aux petites tailles (16 à 32 px), le P détaillé devient flou : le fichier `.ico` utilise donc
la version simplifiée pour ces tailles, et la version complète à partir de 48 px.

## Couleurs

| Couleur | Code | Où |
|---|---|---|
| Bleu nuit | `#0F172A` | Lettre P et texte « sice » |
| Rouge | `#DC2626` | Contour du point du « i », dessiné comme une broche non connectée dans l'éditeur (`COLORS.pin`) |
| Rouge très clair | `#FADEDE` | Intérieur du point du « i » (le rouge à 15 % de l'éditeur, sur fond blanc) |
| Bleu | `#2563EB` | Point de connexion et borne |
| Blanc | `#FFFFFF` | Fond de l'icône |
| Gris clair | `#CBD5E1` | Bord de la tuile de l'icône |

## Régénérer les fichiers

Depuis la racine du dépôt, sous Windows :

```powershell
uv run --no-project --with pillow --with fonttools python assets/brand/make_brand.py
```

Pillow et fontTools ne servent qu'à ce script : ce ne sont **pas** des dépendances du projet
(`--no-project --with` les installe dans un environnement temporaire).

L'animation est un GIF généré image par image par ce script (version « Vague », choisie par
l'équipe) : la borne apparaît, une étincelle trace le grand P, le point de connexion s'allume
avec un flash, puis les lettres de « sice » montent doucement l'une après l'autre. Enfin, le
point du « i » apparaît comme une broche non connectée et lance une onde rouge, comme une
alerte. Elle dure environ une seconde et demie (50 images par seconde) avant de s'arrêter sur
le logo.

## Origine et licence

- Logo dessiné par l'équipe Psice (HEIG-VD, 2026) ; fichiers sous la licence MIT du dépôt
  ([`LICENSE`](../../LICENSE)).
- Les lettres « sice » viennent de la police **Segoe UI Semibold** (Microsoft, installée avec
  Windows). Dans `psice-logo.svg`, elles sont converties en contours : le SVG s'affiche donc
  sans la police installée, et le fichier de police n'est pas distribué.
