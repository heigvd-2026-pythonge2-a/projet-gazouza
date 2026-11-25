# Logo de Psice

Le logo a été choisi par l'équipe dans l'issue #4 (proposition « Monogramme circuit », version
sobre). Il reprend les symboles de l'éditeur de schéma :

- un grand **P** dont la patte se termine par une **borne de circuit** bleue : un point de
  connexion plein et une borne ouverte ;
- le point du **i**, dessiné comme une **broche non connectée** de l'éditeur : un cercle rouge
  avec un intérieur rouge très clair.

Le grand **P** est la première lettre du nom : il est collé à la suite du mot, **« sice »**, pour
qu'on lise directement **Psice** (et pas « P psice ») — voir l'issue #154.

![Logo Psice](images/psice-logo.png)

## Fichiers

| Fichier | Format | Usage |
|---|---|---|
| [`images/psice-logo.png`](images/psice-logo.png) | PNG 1600 × 900, fond quadrillé | README, rapport, présentation |
| [`images/psice-logo-animation.gif`](images/psice-logo-animation.gif) | GIF animé 800 × 450, 50 images/s | Démo orale, écran de démarrage |

## Animation

1. La borne apparaît, puis une étincelle part de la borne et trace le grand **P** (la patte,
   puis la boucle).
2. Le point de connexion s'allume avec un flash bleu.
3. Les lettres **s**, **i**, **c** et **e** montent doucement l'une après l'autre, comme une
   vague.
4. Le point du **i** apparaît comme une broche non connectée et lance une onde rouge, comme une
   alerte.

L'animation dure environ une seconde et demie, puis reste deux secondes sur le logo avant de
recommencer.

![Animation du logo Psice](images/psice-logo-animation.gif)

## Couleurs

| Couleur | Code | Où |
|---|---|---|
| Bleu nuit | `#0F172A` | Lettre P et texte « sice » |
| Bleu | `#2563EB` | Point de connexion et borne |
| Rouge | `#DC2626` | Contour du point du « i » (comme une broche non connectée dans l'éditeur) |
| Rouge très clair | `#FADEDE` | Intérieur du point du « i » |
| Blanc | `#FFFFFF` | Fond |

## À faire plus tard

- Une version **SVG** (vectorielle) et une **icône carrée** (le P seul) pour l'icône de
  l'application Windows, le favicon du site et la barre de titre de pywebview. Elles sont
  préparées dans `assets/brand/` (PR #159, issue #126).
