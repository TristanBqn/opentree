# OpenTree — Handoff (2026-06-24)

État de reprise du déploiement d'OpenTree en plugin OpenClaw sur le VPS Hetzner.

## Objectif

Faire tourner le viewer 3D OpenTree comme **plugin OpenClaw**, accessible depuis un
navigateur via une URL (à terme permanente + protégée), avec un bouton de
rafraîchissement des données. Le viewer cartographie une arborescence de fichiers
et les conteneurs Docker.

## État actuel — CE QUI MARCHE ✅

- Le plugin **est déployé, chargé et rendu** dans le navigateur.
  Log gateway : `http server listening (… plugins: …, opentree, …)`.
- Accès **via tunnel SSH** : `ssh -L 18789:127.0.0.1:18789 openclaw@<VPS>` puis
  `http://localhost:18789/opentree/` → le viewer 3D s'affiche.
- Le backend renvoie de **vraies données VPS** : host `openclaw`, vCPU/RAM, disque.
- **Double scan hôte** : `/app` ET `/home/node/.openclaw` via `OPENTREE_HOST_ROOT`
  (voir §config VPS). Deux îles « openclaw » et « .openclaw ». Conteneurs Docker
  listés avec CPU/RAM/ports.
- **Réponses gzip** : snapshot pré-sérialisé + pré-compressé à la construction du cache.
- **Rendu à la demande** : 0 % GPU au repos. Raycast throttlé à 1/frame.
- **Étiquettes virtualisées** : seules les étiquettes à l'écran sont montées dans le
  graphe (coût `CSS2DRenderer.zOrder` ramené de O(tous dossiers) à O(à l'écran)).
- Le dépôt **github.com/TristanBqn/opentree** est la source de vérité (public).

## NOUVEAU — session 2026-06-24

Branche `feat/label-level-bar`, **poussée sur `main`** (remote GitHub = `ee555e5`,
vérifié `git ls-remote`). 48 tests verts (`npm test`).

> ⚠️ **Déploiement VPS** : confirmé jusqu'à `d67d5b3` (fix étiquettes). Les deux
> commits **backend** `bfb1f78` + `ee555e5` sont poussés mais **leur redéploiement
> VPS n'est pas confirmé** → refaire `git pull` + `cp lib/` + `docker restart`
> (procédure §mise à jour). C'est du backend : `lib/` DOIT être recopié.

| Commit    | Contenu                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `e0cedc3` | **Barre de niveau d'étiquettes** (bas-centre) + transparence isolé `0.15→0.075` + rebase taille fichiers (100 % = ancien 40 %). |
| `d67d5b3` | **Fix** : étiquettes de la 2ᵉ île hôte (`.openclaw`) ne s'affichaient jamais.                                                   |
| `bfb1f78` | **Fix backend** : le watcher surveille toutes les racines hôte, pas seulement la 1ʳᵉ.                                           |
| `ee555e5` | **Fix backend** : garde anti-boucle (le watcher ignore son propre `events.ndjson`).                                             |

### Détails

**Barre de niveau d'étiquettes** (`OpenTree.html`, `main-v2.js`, `scene-v2.js`)

- Slider + case **Auto** dans une barre centrée en bas ; ligne retirée des Réglages.
- **Niveau 0 = aucune étiquette.** Niveau N = uniquement les dossiers de
  **profondeur N** (exact, **non cumulatif**), filtrés par ce qui est à l'écran +
  anti-chevauchement.
- **Auto** : niveau déduit du zoom (`levelFromZoom`), le slider est piloté/désactivé
  et **bouge tout seul** (dézoomé complet → 0 → rien ; on zoome → 1, 2, 3…).
- Remplace l'ancien « gate overview » + seuils `REVEAL` (supprimés).
- ⚠️ Piège corrigé : `createScene` lance un 1er `animate()` **synchrone** → le
  callback `onLabelLevel` se déclenche avant le câblage du slider. Les éléments de la
  barre + `setLevelLabel` sont donc déclarés **avant** `createScene` dans `main-v2.js`.

**Fix 2ᵉ île hôte** (`scene-v2.js`)

- Cause : `const isCont = d.iid !== "host"`. Or `snapshot.mjs:128` ne donne l'id
  `"host"` qu'à la **1ʳᵉ** île ; les suivantes prennent leur nom (`.openclaw`). Leurs
  nœuds étaient pris pour des conteneurs → classe `hidden` → jamais d'étiquette.
- Corrigé : détection par `kind` de l'île (`containerIids` = îles `kind:"container"`).
- ⚠️ **`inspector/scene.js` (viewer v1) a le même bug** (`iid !== "host"`) — non
  utilisé par le produit (`OpenTree.html`→`main-v2`→`scene-v2`), donc laissé tel quel.

**Fix watcher multi-racines + anti-boucle** (`lib/watcher.mjs`, `src/register.ts`)

- `register.ts` ne passait que `hosts[0]` à `startWatcher` → `.openclaw` n'avait
  jamais d'événements réels (toujours le proxy mtime). `startWatcher` accepte
  désormais une liste `roots`, surveille chacune, avec **un seul** propriétaire de la
  rotation (le `.tmp` est partagé → des timers par racine se marcheraient dessus).
- `events.ndjson` vit dans le `stateDir`, **sous** `/home/node/.openclaw` (racine
  surveillée) → sans garde, chaque écriture d'événement en redéclencherait une
  (emballement). `isIgnoredPath()` ignore le journal et son `.tmp`.

## CE QU'IL RESTE À FAIRE

### A. Contenu réel au clic droit (#4) — DESIGN PRÊT, NON IMPLÉMENTÉ

Aujourd'hui `inspector/content.js:snippet()` **fabrique** un faux contenu d'après
l'extension — aucun fichier n'est lu. Plan validé (reste à coder + redéployer) :

- **Backend** (`lib/handlers.mjs`, `src/register.ts`, + test) : route
  `GET /opentree/api/file?path=<chemin d'affichage>`. Mapping : 1er segment = `host.name`
  → `host.root` absolu → `resolve(root, reste)`, avec **garde anti-traversée** (même
  logique que le statique). Lecture des **64 premiers Ko** UTF-8, réponse
  `{ path, content, truncated }`.
- **Frontend** (`data.js`, `main-v2.js`, `content.js`) : `fetchFileContent(path)`,
  `openFileBubble` async (« chargement… » → vrai texte), **suppression** de `snippet()`.
- **Décision en attente** : `.md` affiché en **texte brut** (reco, évite parseur +
  XSS) ou **rendu** markdown. Reporté à la demande de l'utilisateur (« pas pour l'instant »).

### B. Tracking des LECTURES — ANALYSÉ, NON IMPLÉMENTÉ, DÉCISION EN ATTENTE

Rien ne capte les lectures aujourd'hui (`fs.watch` ne voit que les écritures/renames).
C'est de l'**infra non triviale**, pas une petite édition. Options :

- **atime** : à écarter (Linux `relatime`/`noatime` → quasi pas mis à jour ; pas de comptage).
- **inotify `IN_ACCESS`** : non exposé par `fs.watch` (outil externe), très bruyant.
- **auditd** (`-F dir=… -S openat`, le `-w` simple n'est pas récursif) : lectures
  réelles **avec PID/utilisateur**, mais **root** + **gros volume de logs** + un
  collecteur qui parse `/var/log/audit/audit.log` → `events.ndjson`.
- **eBPF / bpftrace** : plus léger (agrégation noyau), mais root + démon long-running.
- **Instrumentation applicative** : la plus propre, MAIS il faudrait modifier l'agent
  OpenClaw (produit hôte, pas notre plugin) → probablement hors de portée.

Côté OpenTree, le stockage serait simple : généraliser `events.ndjson` à
`{ts, path, op:"read"|"write"}` + agrégat `reads30`/`reads` à côté de `usage30`.
**La partie coûteuse, c'est la SOURCE.**

**Questions ouvertes avant de coder** : (1) lectures réelles attribuées (qui/combien)
ou simple signal « consulté » ? (2) OK pour faire tourner un collecteur **root** en
continu ? Si oui/oui → reco **eBPF (bpftrace)** filtré sur les racines hôte. Si non →
le tracking de lectures n'est pas réalisable proprement.

### C. URL permanente + auth — PROCHAINE ÉTAPE PRODUIT

- Tailscale **n'est pas installé** : `sudo snap install tailscale` → `sudo tailscale up`
  → `tailscale serve --bg 18789` → `https://<machine>.<tailnet>.ts.net/opentree/`.
- Route en `auth: "plugin"` (`src/register.ts`) → **non protégée par mot de passe** ;
  protection = réseau (tunnel SSH ou tailnet). Pour un vrai mot de passe navigateur,
  ajouter un **HTTP Basic Auth** dans `lib/handlers.mjs` (non fait).

### D. Backports / nettoyage

- L'install manuelle copie l'essentiel (manifeste + package.json + dist + lib +
  inspector). Pas de mécanisme auto.
- Faire `hostRoot`/`hostName` des **options de config du plugin** (configSchema +
  `api.pluginConfig`) plutôt que des variables d'env.
- Arbres **internes** des conteneurs vides (`lib/docker.mjs:execFind` appelle
  `docker exec` en CLI, absent du conteneur). Réécrire sur l'API exec du socket
  (POST `/containers/{id}/exec`) pour les remplir.

## LIMITES / CAVEATS IMPORTANTS (tracking d'usage)

- **Le « heat » est majoritairement un PROXY mtime, pas un historique.** Si un fichier
  n'a pas d'événement réel, `usage30 = mtimeToUsage30(mtime)` (`usage.mjs:8`) pose
  **un seul `1`** au jour de dernière modif → `uses` vaut **0 ou 1**, le sparkline est
  un pic unique. Le libellé tooltip « X utilisations · 30 j » est donc **trompeur**
  pour ces fichiers (= « modifié récemment : oui/non »).
- **Événements réels** (`events.ndjson` via watcher) : vrai comptage par jour, **mais**
  seulement pour les modifs survenues **pendant que la gateway tourne** (les trous de
  downtime ne sont pas rattrapés — accepté), et **à partir du déploiement** du fix
  multi-racines pour `.openclaw`.
- **Dépend de `fs.watch({recursive:true})`**, ajouté à **Node ≥ 20**. Sur version
  antérieure → fallback mtime, **aucun** événement (`watcher.mjs` log un warn).
  **À vérifier sur le VPS** : `docker exec openclaw-openclaw-gateway-1 node -v`.
- Limite **inotify** (`fs.inotify.max_user_watches`) possible sur 34k fichiers.
- Agrégation : `annotate` somme `uses`/`usage30` vers le haut → le `uses` d'un dossier
  ≈ nombre de fichiers descendants modifiés sur 30 j (semi-significatif même en proxy).

**Vérifier que le tracking marche vraiment** (sur le VPS, prompt `openclaw@…`) :

```bash
docker exec openclaw-openclaw-gateway-1 sh -c 'find /home/node/.openclaw -name events.ndjson 2>/dev/null'
# puis, avec le chemin : wc -l <chemin> ; tail -3 <chemin>
# modifier un fichier dans .openclaw, attendre, refaire wc -l → le compteur doit monter
```

## HISTORIQUE DES BLOCAGES ET RÉSOLUTIONS

1. **`openclaw plugins install git:…` refusé** — manifeste dans un sous-dossier + scan
   du code. → **Restructuration** : le plugin est la racine du dépôt, `dist/` committé.
2. **Scan « dangerous code patterns: child_process »** — **retiré** dans OpenClaw
   2026.6.8 (`--dangerously-force-unsafe-install` devenu no-op). Le code n'a pas changé.
3. **`acpx` : « code safety scan failed »** — symlink fantôme **dans l'install OpenClaw**
   (`/app/node_modules/.bin/acpx` → paquet absent). Défaut de l'image `openclaw:local`.
   → Contourné par **install manuelle** dans `~/.openclaw/extensions/opentree/`.
4. **`peerDependency` vs `devDependency`** — hypothèse acpx fausse ; le passage en
   peerDependency + suppression du lockfile reste une bonne pratique, conservé.
5. **Manifeste : « requires configSchema »** → schéma vide ajouté.
6. **« JSON5 invalid '\n' »** — on copiait tout le dépôt ; un `.json` parasite cassait le
   scanner de manifestes. → copier **seulement l'essentiel**.
7. **« blocked by allowlist »** → `openclaw config set plugins.allow.N opentree` +
   `plugins.entries.opentree.enabled true`.
8. **`/opentree/` → `Unauthorized`** — `auth:"gateway"` exige un Bearer que le navigateur
   n'envoie pas. → passé en **`auth:"plugin"`** (comme le plugin Canvas).
9. **Viewer bloqué sur « lecture de l'architecture »** — THREE.js chargé du CDN,
   injoignable. → **THREE.js vendored** dans `inspector/vendor/` + importmap locale.
10. **(2026-06-24) Étiquettes 2ᵉ île jamais affichées** — `iid !== "host"` ; cf. fix
    `d67d5b3` ci-dessus. Reproduit avec un snapshot à 2 hôtes avant correction.
11. **(2026-06-24) Déploiement : `rm`/`cp` dans le mauvais ordre** — `cp` PUIS `rm` a
    effacé `inspector/dist/lib` du dossier d'extension juste après les avoir copiés.
    → un `cp` par-dessus suffit (pas besoin du `rm` si rien de stale).

## RÉFÉRENCES

### Dépôt

- `github.com/TristanBqn/opentree` (public). Clone de dev : `~/opentree` (Mac).
- Le plugin EST la racine : `openclaw.plugin.json`, `package.json`, `dist/`, `lib/`,
  `inspector/` (avec `inspector/vendor/` = THREE bundlé), `src/`.
- Branche de travail courante : `feat/label-level-bar` (poussée sur `main`).
- Tests : `npm test` (build TS + `node --test`), **48 tests**. Ils couvrent `lib/`
  (cache, gzip, handlers, traversée, snapshot, usage, docker, walk, **watcher
  multi-racines + isIgnoredPath**, rotate). **Le viewer (`inspector/`) n'a PAS de
  harnais de test.**
- **Vérif frontend** : piloter le Chromium de Playwright en direct (le canal `chrome`
  du MCP n'est pas installé) :
  `~/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/...`
  via `playwright-core` (cache npx). Servir en statique + un faux `inspector/api/snapshot`.

### Config VPS (override compose, vit **sur le VPS uniquement**)

`/home/openclaw/openclaw/docker-compose.override.yml`, service `openclaw-gateway` :

```yaml
environment:
  OPENTREE_HOST_ROOT: /app,/home/node/.openclaw
  OPENTREE_HOST_NAME: openclaw,.openclaw
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

Vérif merge : `docker compose config | grep -iE 'OPENTREE|docker.sock'`.
Appliqué par `docker compose up -d openclaw-gateway`.

### Environnement VPS

- OpenClaw **2026.6.8**, image `openclaw:local`, user `openclaw`.
- Conteneur gateway : `openclaw-openclaw-gateway-1`.
- `~/.openclaw` (hôte) **monté** dans le conteneur sur `/home/node/.openclaw` (RW).
- Gateway HTTP : `127.0.0.1:18789` (publié sur l'hôte en loopback).
- Plugin installé : `~/.openclaw/extensions/opentree/`
  (`openclaw.plugin.json`, `package.json`, `dist/`, `lib/`, `inspector/`).

### Procédure de mise à jour du plugin

```bash
# === Mac : pousser ===
git -C ~/opentree push origin feat/label-level-bar:main

# === VPS (prompt openclaw@…) : tirer + recopier + redémarrer ===
cd ~/opentree && git pull
cp -r ~/opentree/inspector ~/opentree/dist ~/opentree/lib ~/.openclaw/extensions/opentree/
docker restart openclaw-openclaw-gateway-1
```

> Backend modifié (lib/) → `lib/` DOIT être recopié. `cp` par-dessus suffit.

```bash
# === Mac : tunnel pour le navigateur (laisser ouvert) ===
ssh -L 18789:127.0.0.1:18789 openclaw@<VPS>
# puis http://localhost:18789/opentree/
```

### Pièges connus

- **Mac vs VPS** : prompt `tristanbannier@MacBook-Air…%` = Mac (`git push`, `ssh`,
  navigateur) ; `openclaw@openclaw-tristanb…$` = VPS (`git pull`, `cp`, `docker`,
  `curl` de test). Ne pas lancer les commandes VPS sur le Mac (et inversement).
- Le **terminal du VPS corrompt les pastes longues** (~80 colonnes). Commandes
  **courtes** ; `git pull` + `cp` plutôt que coller du JSON/scripts longs.
- `openclaw config get gateway.auth.token` renvoie `__OPENCLAW_REDACTED__` ; lire la
  vraie valeur dans `~/.openclaw/openclaw.json` si besoin.
- `plugin-network` (autre plugin git) est cassé (`Cannot find module 'typebox'`) et
  fait planter certaines commandes CLI — indépendant d'OpenTree.
