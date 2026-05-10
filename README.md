# Studio Mobilier Pro — Electron Desktop App

Système de Décision Tarifaire — application locale Windows.

---

## Structure du projet

```
studio_mobilier_electron/
│
├── main.js              ← Bootstrap Electron, BrowserWindow, menu, IPC
├── preload.js           ← Context bridge (sécurité renderer ↔ main)
├── package.json         ← Config npm + electron-builder
├── index.html           ← Interface principale
├── style.css            ← Tous les styles visuels
├── app.js               ← Orchestrateur UI (événements, formulaires)
│
├── pricing/
│   └── calculatePricing.js  ← Moteur de calcul pur (sans DOM)
│
├── storage/
│   └── history.js           ← Couche stockage historique (localStorage → SQLite ready)
│
├── reports/
│   └── invoices.js          ← Rendu des vues + génération PDF (MiniPDF intégré)
│
└── assets/
    └── icon.ico             ← Icône Windows (à fournir avant build)
```

---

## Prérequis

- [Node.js](https://nodejs.org/) v18 ou supérieur
- npm (inclus avec Node.js)

---

## Installation

```bash
cd studio_mobilier_electron
npm install
```

---

## Lancement en développement

```bash
npm start
```

Ou avec DevTools ouverts :

```bash
npm run start:dev
```

---

## Build — Installateur Windows (.exe)

```bash
npm run dist
```

Le résultat sera dans le dossier `dist/` :
- `StudioMobilierPro Setup X.X.X.exe` — installateur NSIS
- `StudioMobilierPro-Portable-X.X.X.exe` — version portable (aucune installation requise)

> **Note :** Ajoutez `assets/icon.ico` avant de builder pour obtenir votre propre icône.

---

## Architecture modulaire

| Module | Responsabilité | DOM ? |
|--------|---------------|-------|
| `pricing/calculatePricing.js` | Calculs COGS, marges, risque | ❌ Non |
| `storage/history.js` | Lecture/écriture historique | ❌ Non |
| `reports/invoices.js` | Rendu HTML interne/client + PDF | ✅ Oui |
| `app.js` | Wiring DOM, collecte des inputs, état UI | ✅ Oui |
| `main.js` | Electron bootstrap, fenêtre, menu, IPC | N/A |

---

## Migration vers SQLite (future)

Remplacer uniquement `storage/history.js` :
1. Installer `better-sqlite3` ou `@capacitor-community/sqlite`
2. Remplacer `_readRaw()` et `_writeRaw()` par des requêtes SQL
3. L'API publique (`getHistory`, `saveToHistory`, etc.) reste identique
4. `app.js` et les autres modules **ne changent pas**

---

## Fonctionnalités préservées

- ✅ Calcul du coût direct (4 composantes nommées)
- ✅ Panne de chant — ligne séparée, jamais fusionnée
- ✅ Accessoires avec catalogue prédéfini + mode personnalisé
- ✅ Mode Marge et Mode Prix Marché (exclusifs)
- ✅ Main d'œuvre fixe ou horaire
- ✅ Frais généraux (min 10 %)
- ✅ Livraison hors base de marge
- ✅ Acompte et reste à payer
- ✅ Classification du risque (OK / Marge faible / Prix élevé / Perte)
- ✅ Vue Interne confidentielle
- ✅ Vue Client épurée
- ✅ PDF Interne (COGS + marges)
- ✅ PDF Client (facture)
- ✅ Historique avec filtres (statut, prix, date)
- ✅ Chargement d'une fiche depuis l'historique
- ✅ Verrouillage/déverrouillage du formulaire
- ✅ Validations en temps réel

---

## Roadmap future

- [ ] SQLite pour persistance cross-session avancée
- [ ] Export PDF vers dossier choisi (dialog Electron)
- [ ] Statistiques (CA mensuel, marge moyenne, produits les plus vendus)
- [ ] Multi-projets / gestion de devis
- [ ] Impression native via Electron
- [ ] Sauvegarde/restauration de l'historique (JSON export/import)
