---
title: Messages d'erreur
description: Tous les messages d'erreur et avertissements de Psice, ce qu'ils veulent dire et comment les corriger.
---

Avant de simuler, Psice **vérifie le schéma** et rassemble toutes les erreurs d'un coup. Chaque
message est en français et nomme le composant concerné. Il désigne aussi l'élément fautif
(composant, broche, fil, jonction ou nœud), pour que l'éditeur le surligne.

:::note[Déjà visible dans l'éditeur]
Pendant que tu dessines, les broches non reliées sont déjà marquées en **rouge** et comptées
dans la barre d'état. Un nom ou une valeur mal saisis (`10l` au lieu de `10k`, un nom en double…)
affichent une **bulle** sous le composant concerné : rouge pour une erreur, orange pour un
avertissement. Clique sur la bulle pour sélectionner le composant et aller directement au champ
à corriger.
:::

:::tip[Retrouver l'élément fautif après une simulation]
Quand la simulation échoue (ou signale un avertissement), les éléments concernés sont
**surlignés sur le schéma** : les fils du nœud fautif, les composants, la broche, le fil ou la
jonction en cause. Une bulle sur l'élément reprend le message ; clique dessus pour sélectionner
ce qui est surligné. Dans le panneau **Résultats**, clique sur le message pour que la vue se
place sur ces éléments. C'est utile quand le message nomme un nœud automatique comme `n1`, qui
n'apparaît nulle part sur le schéma. Le surlignage disparaît dès que tu modifies le schéma.
:::

- Une **erreur** bloque la simulation : il faut la corriger.
- Un **avertissement** n'empêche pas de simuler, mais signale probablement un oubli.

Chaque message porte aussi un **code** (par exemple `NO_GROUND`), utile pour chercher sur cette
page ou pour signaler un problème.

## Erreurs de câblage

| Code                | Ce que ça veut dire                                                               | Comment corriger                                                                 |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `NO_GROUND`         | Le circuit n'a pas de masse.                                                      | Pose une **Masse** et relie-la au circuit (souvent à la borne `-` de la source). |
| `PIN_NOT_CONNECTED` | Une broche n'est reliée à rien.                                                   | Relie la broche, ou supprime le composant s'il est en trop.                      |
| `UNKNOWN_ENDPOINT`  | Un fil est accroché à un composant, une broche ou une jonction qui n'existe plus. | Supprime le fil et retrace-le.                                                   |

:::note[Pourquoi une broche en l'air est une erreur]
ngspice simulerait sans problème une résistance avec une patte en l'air. Mais pour un débutant,
c'est presque toujours un **oubli de câblage** : Psice préfère t'arrêter.
:::

## Noms et valeurs

| Code             | Ce que ça veut dire                                                                                         | Comment corriger                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `MISSING_NAME`   | Un composant n'a pas de nom.                                                                                | Donne-lui un nom dans l'inspecteur.                                                      |
| `DUPLICATE_NAME` | Plusieurs composants portent le même nom (`R1` deux fois).                                                  | Renomme l'un d'eux.                                                                      |
| `BAD_PREFIX`     | Le nom ne commence pas par la bonne lettre (`C1` pour une résistance) ou contient des caractères interdits. | Utilise le préfixe du type (`R`, `C`, `L`, `V`, `I`), suivi de lettres, chiffres ou `_`. |
| `BAD_VALUE`      | Une valeur n'est pas lisible (`1kk`, `4,7k`).                                                               | Voir [Valeurs et unités](/projet-gazouza/guide/valeurs-et-unites/).                      |
| `MISSING_PARAM`  | Un paramètre est vide.                                                                                      | Remplis le champ dans l'inspecteur.                                                      |
| `DUPLICATE_ID`   | Deux éléments ont le même identifiant interne (fichier modifié à la main).                                  | Supprime l'un des deux éléments.                                                         |
| `UNKNOWN_TYPE`   | Le fichier contient un type de composant que la bibliothèque ne connaît pas.                                | Remplace le composant par un composant de la palette.                                    |

## Étiquettes de nœud

| Code              | Ce que ça veut dire                                                    | Comment corriger                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `LABEL_CONFLICT`  | Un même nœud porte plusieurs noms (`in` et `out` sur des fils reliés). | Garde une seule étiquette, ou sépare les fils.                                                                                   |
| `LABEL_ON_GROUND` | Une étiquette est posée sur un fil relié à la masse.                   | Supprime l'étiquette : ce nœud s'appelle déjà `0`.                                                                               |
| `BAD_LABEL_NAME`  | Le nom n'est pas valide (`2out`, `n1`).                                | Lettres, chiffres et `_`, en commençant par une lettre, et pas de nom de la forme `n1`, `n2`… (réservés aux nœuds automatiques). |

## Analyses

| Code                  | Ce que ça veut dire                                                           | Comment corriger                                       |
| --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| `AC_SOURCE_NOT_FOUND` | La source d'entrée de l'analyse `.ac` n'existe pas (ou n'est pas une source). | Choisis à nouveau la source dans la fenêtre d'analyse. |
| `DC_SOURCE_NOT_FOUND` | La source balayée de l'analyse `.dc` n'existe pas.                            | Choisis à nouveau la source dans la fenêtre d'analyse. |

## Avertissements

| Code                  | Ce que ça veut dire                                                                                                                                                                                             | Que faire                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `WIRE_DANGLING`       | Un fil a un bout qui n'est relié à rien.                                                                                                                                                                        | Termine le fil sur une broche, ou supprime-le.                                              |
| `JUNCTION_DANGLING`   | Une jonction est reliée à moins de 2 fils.                                                                                                                                                                      | Supprime-la, elle ne sert à rien.                                                           |
| `MILLI_SUFFIX`        | Tu as écrit `1M`, qui veut dire **1 milli** en SPICE.                                                                                                                                                           | Pour un méga, écris `1Meg`. Si tu voulais vraiment milli, écris `1m`.                       |
| `SHORTED_COMPONENT`   | Toutes les broches d'un composant sont reliées au même nœud (un fil entre ses pattes, deux étiquettes de même nom, deux masses…). Il n'a aucun effet sur le circuit.                                            | Retire le fil ou l'étiquette qui fait le court-circuit.                                     |
| `TRAN_STEP_TOO_LARGE` | Analyse transitoire : le pas est trop grand pour une source. Une sinusoïde a moins de 20 points par période, ou une impulsion moins de 10 points sur sa durée haute ou basse. La courbe affichée serait fausse. | Augmente le nombre de points (le message dit combien), ou réduis la durée de la simulation. |
| `LED_OVERCURRENT`     | Après la simulation : une LED reçoit plus de 30 mA. Une vraie LED grillerait.                                                                                                                                   | Ajoute une résistance en série (par ex. 220 Ω sous 5 V, environ 14 mA).                     |
| `LED_REVERSE_VOLTAGE` | Après la simulation : une LED est soumise à 5 V ou plus en inverse. Une vraie LED grillerait.                                                                                                                   | Vérifie le sens de la LED (anode `A` vers le +).                                            |

## Erreurs de simulation

Ces erreurs viennent de **ngspice** : le schéma est correct, mais le circuit ne peut pas être
calculé. Psice traduit le message de ngspice et, quand c'est possible, surligne sur le schéma le
nœud ou les composants en cause.

| Code                  | Cause habituelle                                                                                                                                                                                                                              | Comment corriger                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SINGULAR_MATRIX`     | Un nœud est **flottant** : il n'a aucun chemin en continu vers la masse, par exemple derrière un condensateur seul.                                                                                                                           | Ajoute une grande résistance (`100Meg`) entre ce nœud et la masse, ou revois le câblage.                                                                 |
| `VOLTAGE_SOURCE_LOOP` | Deux sources de tension en parallèle, ou une source directement sur une bobine.                                                                                                                                                               | Ajoute une petite résistance en série (`1m`), ou supprime la source en trop.                                                                             |
| `NO_CONVERGENCE`      | ngspice n'arrive pas à trouver de solution (circuit non linéaire difficile, valeurs extrêmes).                                                                                                                                                | Vérifie les valeurs, réduis la durée ou le pas de la simulation.                                                                                         |
| `SIMULATION_TIMEOUT`  | La simulation a dépassé le délai maximal et a été arrêtée.                                                                                                                                                                                    | Réduis la durée simulée ou augmente le pas maximal.                                                                                                      |
| `SIMULATION_FAILED`   | Tout autre problème. Le message brut de ngspice est ajouté à la fin. Aussi avant de lancer la simulation, si elle produirait plus de 200 000 points (durée trop longue pour le pas maximal, balayage trop fin) : le message dit quoi changer. | Lis le message ; si tu penses que c'est un bug de Psice, [ouvre une issue](https://github.com/heigvd-2026-pythonge2-a/projet-gazouza/issues/new/choose). |
