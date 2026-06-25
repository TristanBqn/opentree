# Spec — Liste des éléments d'une branche isolée

Date : 2026-06-25
Fichiers touchés : `inspector/scene-v2.js`, `inspector/main-v2.js`, `inspector/OpenTree.html`

## Contexte

Le panneau de résultats de recherche (`#results`) permet déjà de parcourir les éléments
matchés : clic sur le compteur `#count` (en mode « N / total éléments ») → liste déroulante,
clic sur une ligne → `toggleIsolated`. Ce système n'existe **que** pour la recherche.

Quand une **branche est isolée**, `#count` (bas-droite) n'affiche que le **nom** du nœud isolé
(`scene-v2.js:739-744` → `onCounts.isolated`, posé dans `main-v2.js:139`). Aucun moyen de lister
les fichiers/dossiers contenus dans la branche.

La scène connaît pourtant déjà ces ensembles : `isoFiles` / `isoDirs` (Sets de descendants,
construits par `collectSubtrees` dans `applyIsolation`, `scene-v2.js:764-773`).

## Objectif

En mode isolation, transformer `#count` en compteur **segmenté et cliquable** :

```
Nom · ⟨N fichiers⟩ · ⟨N dossiers⟩
```

- `⟨N fichiers⟩` / `⟨N dossiers⟩` = segments cliquables → ouvrent le panneau `#results`
  listant respectivement les fichiers / dossiers sous la branche.
- Le **nom** reste celui du nœud isolé (ou `N éléments` en multi-sélection).
- **Liste complète, sans plafond** (rendu **virtualisé** — voir §Composants).

## Non-objectifs

- La liste de **toute l'architecture** (clic sur `N fichiers · N dossiers` en mode base, hors
  isolation) — **abandonnée**, hors périmètre.
- Changement du comportement de la **recherche** : `#results` en mode recherche reste inchangé
  (toujours plafonné à 300 côté scène, `CAP` dans `refresh`).
- Le chip `#isolate-chip` (haut-centre) reste inchangé.
- Tri / classement par pertinence : ordre **DFS** (ordre des Sets `isoFiles`/`isoDirs`).

## Comportement

### Compteur segmenté (mode isolation)

- Segments `.c-seg` : curseur pointer, état `.active` quand leur liste est ouverte.
- Comptes — cohérents avec la bulle de dossier (`countUnder`, `main-v2.js:424`) :
  - **fichiers** = tous les fichiers descendants (`isoFiles`).
  - **dossiers** = sous-dossiers **stricts** (`isoDirs` **moins** les racines explicitement
    isolées).
- Source unique : `main-v2.js` dérive **et les compteurs et les listes** d'un seul getter
  `scene.getIsolatedContents()` → toujours synchrones.

### Panneau `#results` (mode isolation)

- Clic sur `⟨N fichiers⟩` → ouvre `#results` avec les fichiers ; re-clic sur le même segment
  → ferme. Cliquer l'autre segment **bascule** la liste affichée.
- Quand l'isolation change (drill-down, multi-sélection, reset) et que le panneau est ouvert :
  re-rendu sur le nouveau contenu (scroll remis en haut). Si l'isolation est levée → fermeture.

### Clic sur une ligne (mode isolation)

- **Fichier** → `openFileBubble(file, x, y)` (coords du clic) + `scene.flyTo(file)`. L'isolation
  ne change pas.
- **Dossier** → `scene.setIsolated(dir)` : ré-isolation sur le sous-dossier (drill-down). Le
  compteur et la liste ouverte se rafraîchissent sur la nouvelle branche.

## Composants

### `inspector/scene-v2.js`

- Ajout à l'API retournée :
  `getIsolatedContents() → { files: [...isoFiles], dirs: [...isoDirs].filter(d => !isolatedNodes.includes(d)) }`.
  Renvoie `{ files: [], dirs: [] }` hors isolation. Ordre DFS (ordre d'insertion des Sets).
- Aucune autre modification (pas de cap ajouté côté isolation ; la recherche garde son `CAP`).

### `inspector/main-v2.js`

- `onCounts` (mode isolation) : reconstruit `#count` en innerHTML segmenté
  (`<span class="c-name">` + deux `<span class="c-seg">`), nom échappé via `escapeHtml`.
  Câble les clics des segments. Ne pose **pas** `.has-results` (réservé à la recherche).
- État du panneau : ajout d'un mode courant (`resultsMode ∈ {null, 'search', 'iso-files',
'iso-dirs'}`) pour savoir quoi afficher et synchroniser.
- **Rendu virtualisé** `renderIsoList(nodes, kind)` :
  - `#results` passe en `position: relative`, `overflow-y: auto`, `max-height: 40vh`.
  - Un enfant `.r-sizer` de hauteur `nodes.length * ROW_H` établit la zone scrollable.
  - Les lignes (`.r-row`, hauteur fixe `ROW_H`) sont positionnées en absolu (`top = i*ROW_H`) ;
    seule la fenêtre visible `[start, end]` (+ petit buffer) est montée, recyclée au `scroll`.
  - Handler `scroll` recalcule la fenêtre ; rendu initial à l'ouverture et à chaque changement
    de données (scroll remis à 0).
- La recherche garde `renderResults()` tel quel (flux simple, ≤300, surlignage `.selected`).

### `inspector/OpenTree.html`

- Styles `.c-seg` (segment cliquable + `.active`) et `.c-name` dans `#count`.
- Styles du mode virtualisé de `#results` : `.r-sizer`, `.r-row` en `position: absolute` avec
  hauteur fixe `ROW_H` (var CSS partagée avec le JS, ou constante dupliquée documentée).

## Tests

Le viewer `inspector/` n'a **pas** de harnais de test (cf. HANDOFF). Les helpers purs
(`search.js`) ne changent pas → pas de nouveau test unitaire. Vérification manuelle au
navigateur (Playwright/Chromium, cf. HANDOFF §Vérif frontend) : isoler une branche, ouvrir les
deux listes, drill-down sur un dossier, ouvrir un fichier, lever l'isolation.
