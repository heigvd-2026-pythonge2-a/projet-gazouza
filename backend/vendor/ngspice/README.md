# Binaires Windows de ngspice

Ce dossier contient la distribution minimale de **ngspice 47 (Windows 64 bits)** embarquée par Psice pour exécuter les simulations hors ligne, sans installation préalable sur le poste de l'utilisateur.

## Origine et intégrité

- **Version :** `ngspice-47` (64 bits, compilé le 11 août 2026 avec solveur KLU et support XSPICE)
- **Source officielle :** [ngspice sur SourceForge](https://sourceforge.net/projects/ngspice/files/ng-spice-rework/47/ngspice-47_64.7z/download) (référencée par [ngspice.sourceforge.io/download.html](https://ngspice.sourceforge.io/download.html))
- **Archive d'origine :** `ngspice-47_64.7z` (`13 814 879` octets)
  - **MD5 :** `550f3a5a278ddcb464470878aa173482`
  - **SHA-256 :** `59225971bd68cdd1199443649aa4615a9e6d684933f205ab49006a3942518f5a`

## Contenu minimal embarqué

Seuls les fichiers nécessaires à l'exécution console en mode batch (`-b`) ont été conservés, pour un total de **13 fichiers** (**14 138 004 octets**, soit environ **13,48 MiB** / **14,14 Mo**) :

| Chemin relatif | Taille (octets) | Rôle |
|---|---:|---|
| `bin/ngspice_con.exe` | 7 641 600 | Binaire console 64 bits (mode batch sans fenêtre graphique) |
| `bin/libomp140.x86_64.dll` | 698 784 | Runtime OpenMP lié par `ngspice_con.exe` |
| `bin/samplerate.dll` | 1 592 320 | Bibliothèque requise par la table d'import PE de `ngspice_con.exe` |
| `bin/sndfile.dll` | 2 603 520 | Bibliothèque requise par la table d'import PE de `ngspice_con.exe` |
| `share/ngspice/scripts/spinit` | 1 122 | Script d'initialisation (`set filetype=ascii`, chargement des code-models) |
| `lib/ngspice/analog.cm` | 314 880 | Code-model XSPICE analogique |
| `lib/ngspice/digital.cm` | 335 872 | Code-model XSPICE numérique |
| `lib/ngspice/spice2poly.cm` | 107 520 | Code-model XSPICE `POLY(...)` (utile aux sous-circuits d'amplis-op) |
| `lib/ngspice/table.cm` | 219 136 | Code-model XSPICE tables |
| `lib/ngspice/tlines.cm` | 233 472 | Code-model XSPICE lignes de transmission |
| `lib/ngspice/xtradev.cm` | 201 728 | Code-model XSPICE composants étendus |
| `lib/ngspice/xtraevt.cm` | 142 336 | Code-model XSPICE événements |
| `COPYING` | 45 714 | Texte complet des licences et mentions de copyright amont |

Les éléments volumineux inutiles en mode embarqué (`ngspice.exe` GUI, modèles `.osdi` non activés par défaut dans `spinit`, documentation PDF et exemples) ont été omis.
Les trois DLL embarquées ne dépendent que de `KERNEL32.dll` (aucun redistribuable MSVC supplémentaire requis sur Windows 10/11).

## Licence

ngspice est distribué principalement sous licence **BSD 3-Clause (Modified BSD)**. Conformément aux termes de redistribution binaire, les mentions de copyright et textes de licence sont conservés dans :

- [`COPYING`](COPYING) (dans ce dossier, inclus lors du packaging PyInstaller) ;
- [`THIRD_PARTY_LICENSES.md`](../../../THIRD_PARTY_LICENSES.md) à la racine du dépôt.

## Vérification et mise à jour

### Vérifier l'exécutable embarqué

```powershell
.\backend\vendor\ngspice\bin\ngspice_con.exe -v
```

### Surcharger le binaire en développement

Le module [`backend/app/engines/locator.py`](../../app/engines/locator.py) résout automatiquement `bin/ngspice_con.exe` (en mode développement ainsi que dans un bundle PyInstaller via `sys._MEIPASS`). Il est également possible de forcer un autre binaire via la variable d'environnement `PSICE_NGSPICE_PATH`.

### Procédure de mise à jour depuis SourceForge

```powershell
$archive = "$env:TEMP\ngspice-47_64.7z"
$extract = "$env:TEMP\ngspice-extract"
curl.exe -L -o $archive "https://sourceforge.net/projects/ngspice/files/ng-spice-rework/47/ngspice-47_64.7z/download"
Get-FileHash $archive -Algorithm SHA256
New-Item -ItemType Directory -Force -Path $extract | Out-Null
tar.exe -xf $archive -C $extract

$src = "$extract\Spice64"
$dst = ".\backend\vendor\ngspice"
Copy-Item "$src\bin\ngspice_con.exe", "$src\bin\libomp140.x86_64.dll", "$src\bin\samplerate.dll", "$src\bin\sndfile.dll" "$dst\bin\"
Copy-Item "$src\lib\ngspice\*.cm" "$dst\lib\ngspice\"
Copy-Item "$src\share\ngspice\scripts\spinit" "$dst\share\ngspice\scripts\"
Copy-Item "$src\docs\COPYING" "$dst\COPYING"
```
