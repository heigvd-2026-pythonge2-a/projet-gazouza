---
title: Valeurs et unités
description: Comment taper une valeur dans Psice — suffixes SPICE, unités, et le piège du M (milli) contre Meg (méga).
---

Dans l'inspecteur, les valeurs se tapent **comme sur papier**, avec un suffixe qui remplace la
puissance de dix. Psice reprend les suffixes de SPICE.

## Les suffixes

| Suffixe | Nom | Facteur | Exemple | Vaut |
|---|---|---|---|---|
| `f` | femto | 10⁻¹⁵ | `10f` | 10 fF |
| `p` | pico | 10⁻¹² | `22p` | 22 pF |
| `n` | nano | 10⁻⁹ | `100n` | 100 nF |
| `u` | micro | 10⁻⁶ | `10u` | 10 µF |
| `m` | milli | 10⁻³ | `5m` | 5 ms |
| `k` | kilo | 10³ | `4.7k` | 4,7 kΩ |
| `Meg` | méga | 10⁶ | `1Meg` | 1 MΩ |
| `G` | giga | 10⁹ | `2G` | 2 GHz |
| `T` | téra | 10¹² | `1T` | 1 THz |

Les majuscules ne comptent pas (`4.7K` = `4.7k`), sauf qu'il faut bien écrire `Meg` (ou `meg`)
pour méga.

:::danger[Le piège du M]
En SPICE, **`M` veut dire milli**, pas méga : `1M` vaut 1 mΩ, un milliardième de `1Meg`. Pour un
mégohm, écris **`1Meg`**. Psice affiche un avertissement (`MILLI_SUFFIX`) quand il voit un `M`
majuscule, pour que tu vérifies.
:::

## Ce qui est accepté

- Un nombre entier ou décimal, avec un **point** : `4.7k`, `0.5`, `.1u`.
- La notation scientifique : `1e-6`, `2.2e3`.
- Un signe : `-5`, `+12`.
- Une **unité** après le suffixe, ignorée comme en SPICE : `1kOhm`, `10uF`, `5V`, `1kHz`,
  `2ms`, `10mH`. Les unités reconnues sont `Ohm`, `Ω`, `Hz`, `V`, `A`, `s`, `H` et `F`.

## Ce qui est refusé

Contrairement à SPICE, qui ignore les lettres qu'il ne comprend pas, Psice refuse les fautes de
frappe pour qu'elles ne passent pas inaperçues :

| Saisie | Problème |
|---|---|
| `1kk` | Deux suffixes |
| `4,7k` | Virgule au lieu du point |
| `1 k` | Espace entre le nombre et le suffixe |
| *(vide)* | Paramètre non renseigné |

Une valeur refusée donne l'erreur `BAD_VALUE` (ou `MISSING_PARAM` si le champ est vide), avec le
nom du composant concerné.

:::note[Le cas du femto]
`f` seul est le suffixe **femto** : `10f` vaut 10⁻¹⁴, pas 10 farads. Pour 10 farads, écris
simplement `10`.
:::

## Dans les fichiers

Les valeurs sont enregistrées **telles que tu les as tapées** (`"10k"`) dans le fichier
`.psice.json`. Les analyses et les résultats, eux, utilisent des nombres en **unités SI**
(secondes, hertz, volts, ampères).
