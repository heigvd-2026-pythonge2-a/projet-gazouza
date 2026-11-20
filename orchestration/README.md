# Orchestration & Architecture — Psice

Résumé de nos échanges, des inputs/outputs par personne et des points d'attention / questions soulevées par l'équipe.

---

## 1. Inputs & Outputs par personne

### Noé Guenin — Éditeur de schéma (`frontend/src/editor/`, `store/`)
* **Inputs :**
  * Actions utilisateur sur le canvas (placement, rotation, fils, grille, zoom, sélection, annuler/rétablir, copier-coller).
  * Bibliothèque de composants et symboles (fichiers JSON).
  * Fichiers de schéma sauvegardés (JSON) ou importés (via le backend pour les `.asc`).
* **Outputs :**
  * **Schéma au format JSON** (envoyé au backend pour simulation ou sauvegardé sur disque).
  * Export du schéma en **PNG**.
  * État de sélection / clics sur les fils et composants pour déclencher les sondes.

### Noémi Voélin — Courbes et sondes (`frontend/src/plot/`)
* **Inputs :**
  * **Résultats de simulation (JSON)** renvoyés par le backend (tensions de nœuds, courants de branches, points temporels/fréquentiels/DC).
  * Correspondances `nets` et `components` fournies par le module netlist (pour relier un clic sur un fil/composant à sa tension/courant).
  * Interactions utilisateur : clics sur un fil ou un composant (sonde interactive), zoom, curseurs, choix de mesures (crête, moyenne, temps de montée, FFT en bonus).
* **Outputs :**
  * **Courbes et graphiques** affichés dans l'interface (via `uPlot` : temporel, Bode, DC sweep).
  * **Valeurs mesurées** (tensions, courants, crête, moyenne, temps de montée).
  * Export des courbes en **CSV**.

### Damien Bignens — Bibliothèque, netlist et API (`backend/app/models/`, `netlist/`, `importers/`, `api/`)
* **Inputs :**
  * **Schéma JSON** envoyé par le frontend (via les routes FastAPI).
  * Bibliothèque de composants (JSON) et modèles SPICE (`.model` / `.subckt`).
  * Fichiers **LTspice `.asc`** (pour l'import).
* **Outputs :**
  * **Netlist SPICE** prête pour `ngspice`, accompagnée des tables de correspondance `nets` (nœuds → fils), `components` (noms SPICE → IDs composants), `errors` et `warnings`.
  * **Contrat d'API** (modèles Pydantic + schéma OpenAPI pour générer les types TypeScript du frontend).
  * **Schéma JSON** converti depuis un fichier `.asc` importé.

### Antoine Bezençon — Simulation et packaging (`backend/app/engines/`, `backend/vendor/ngspice/`, `launcher.py`, `build.ps1`)
* **Inputs :**
  * **Netlist SPICE** générée par Damien + paramètres de simulation (`.op`, `.tran`, `.ac`, `.dc`, balayage de paramètres).
  * Binaires Windows de **ngspice** embarqués.
* **Outputs :**
  * **Résultats de simulation structurés (JSON)** (tensions, courants, axes temps/fréquence/DC) renvoyés à l'API pour le frontend.
  * **Application Windows autonome** (`pywebview` + backend + `ngspice` packagés en `.zip` via PyInstaller / `build.ps1`).

---

## 2. Questions & doutes soulevés

### C'est quoi ngspice ?
* **Réponse :** Moteur de simulation de circuits électroniques open source (descendant de SPICE). Il prend une netlist texte (`.op`, `.tran`, `.ac`, `.dc`) et calcule les tensions de nœuds et courants de branches. Dans Psice, les binaires Windows sont embarqués dans `backend/vendor/ngspice/` pour fonctionner hors ligne.

### Pourquoi JSON et pas `.asc` comme LTspice ? (Noé)
* **Réponse :** Le JSON est natif pour React/TypeScript et FastAPI/Pydantic, facile à valider et à faire évoluer (métadonnées UI, annuler/rétablir, paramètres guidés). Le `.asc` est un format texte propriétaire orienté LTspice : il reste supporté **en import** (converti en JSON une seule fois à l'ouverture), mais toute l'application travaille sur le modèle JSON.

### `uPlot` c'est du Python ? / Envie de faire la partie courbes en Python
* **Doute :** `uPlot` est une bibliothèque **JavaScript / TypeScript** (côté React), pas Python.
* **Pistes :**
  1. **Garder l'architecture actuelle (`pywebview` + React)** mais faire tout le calcul/traitement en Python (NumPy/SciPy : crête, moyenne, temps de montée, FFT) et n'utiliser `uPlot` que pour l'affichage brut des points.
  2. **Basculer en 100 % Python** (ex. `PySide6` + `PyQtGraph` ou `Matplotlib`), ce qui impliquerait toutefois de réécrire aussi l'éditeur de schéma en Python (ex. `QGraphicsView`).
* **Décision :** on **garde l'interface en TypeScript + React** (piste 1). L'éditeur de schéma et les courbes (`uPlot`) restent côté frontend, affichés dans `pywebview` ; le Python reste cantonné au backend (netlist, simulation, et éventuellement les calculs de mesures).

### C'est quoi le « Contrat d'API (Pydantic + OpenAPI → TypeScript) » ?
* **Réponse :** On définit la structure des données **une seule fois en Python** avec Pydantic. FastAPI génère automatiquement un schéma OpenAPI, et `openapi-typescript` génère les interfaces TypeScript correspondantes pour le frontend. Ça garantit que le front et le back parlent exactement le même format JSON sans erreur de champs.

### Format d'échange concret (exemples de Damien)
* **Validé :** Damien reçoit le schéma JSON de Noé et renvoie `{ netlist, nets, components, errors, warnings }`.
* **Pour Antoine :** Si `errors` est vide, `netlist` est directement exécutable par `ngspice` (testé sur diviseur `.op`, RC `.tran`, filtre passe-bas `.ac`, diviseur chargé `.dc`).
* **Pour Noémi :** `nets` et `components` permettent de mapper chaque clic sur un fil ou composant vers la courbe correspondante.
