# OpenTree — Backend de collecte d'architecture réelle

**Date :** 2026-06-19
**Statut :** validé, prêt pour implémentation

## Contexte

OpenTree est un visualiseur 3D (THREE.js) de l'architecture d'OpenClaw — un VPS
Hetzner CX33 hébergeant un hôte `~/openclaw` et des containers Docker. Le design
frontend est satisfaisant mais s'affiche actuellement sur des **données simulées**
(`inspector/data.js`, génération déterministe via `mulberry32`).

Objectif : construire le backend qui collecte l'architecture **réelle** et l'expose
au frontend, sans toucher au design existant.

## Décisions validées

| Sujet        | Décision                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------- |
| Hébergement  | Sur le VPS, accessible via SSH tunnel                                                    |
| Couplage     | Processus **indépendant** d'OpenClaw (un monitoring ne dépend pas de ce qu'il surveille) |
| Stack        | Node.js **pur, zéro dépendance** (modules natifs uniquement)                             |
| Activité 30j | mtime bucketing immédiat + watcher `fs.watch` qui s'enrichit dans le temps               |
| Mises à jour | Snapshot au chargement de la page (statique ensuite, refresh manuel)                     |

## Architecture

```
VPS ~/
├── openclaw/                  ← surveillé, inchangé
└── opentree-agent/
    ├── opentree-agent.mjs     ← serveur Node.js pur (~300 lignes)
    ├── opentree-agent.service ← unit systemd (restart auto, démarrage au boot)
    └── .data/
        └── events.ndjson      ← log fs.watch, croît avec le temps
```

L'agent bind **`127.0.0.1:7070` uniquement** — jamais `0.0.0.0`. Accès depuis le Mac :

```bash
ssh -L 7070:localhost:7070 user@vps
# puis http://localhost:7070
```

L'agent assure deux rôles :

1. **Serveur statique** des fichiers OpenTree (HTML/JS/CSS existants)
2. **Endpoint `GET /api/snapshot`** — génère l'architecture complète en JSON

Un watcher `fs.watch` démarre avec l'agent et accumule les events filesystem dans
`events.ndjson` en arrière-plan.

## Composants

### Watcher filesystem (background)

- `fs.watch('~/openclaw', { recursive: true })` au démarrage de l'agent.
- Chaque event d'écriture → une ligne NDJSON `{ ts, path }` appendée à `.data/events.ndjson`.
- Overhead niveau kernel (inotify), négligeable.
- `node_modules` ignoré.

### Endpoint `/api/snapshot`

Exécute en séquence, à chaque requête :

**1. Walk du filesystem hôte (`~/openclaw`)**

- Récursion `fs.promises.readdir` + `fs.promises.stat`.
- Par nœud : `name`, `path`, `type`, `ext`, `size`, `mtime`, `createdAt`.
- `node_modules` exclu du walk.
- Produit l'arbre `DirNode` de l'hôte.

**2. Usage 30 jours par fichier**

- Si `events.ndjson` existe → comptage events par fichier par jour (réel).
- Sinon → mtime bucketing : `mtime` dans les 30 derniers jours → ce jour-là = 1.
- Coexistence possible : events réels prioritaires, mtime en fallback pour les
  fichiers non encore observés.
- `usage30: number[30]`, `uses` = somme — même shape que la version simulée.

**3. Docker stats (socket Unix `/var/run/docker.sock`, HTTP natif)**

- `GET /containers/json` → containers actifs.
- `GET /containers/{id}/stats?stream=false` → CPU + RAM.
- `GET /containers/{id}/json` → health status + uptime.
- File tree interne : `docker exec {id} find /app -maxdepth 5 -not -path '*/node_modules*'`,
  arbre reconstruit depuis la sortie (lecture seule).

**4. Assemblage**

- Retourne `{ generatedAt, islands: [...] }`.
- Chaque island au **même shape** que `buildArchitecture()` actuel :
  `{ id, kind, name, status, statusTxt, stats, ports, rootLen, origin, root }`.
- Positions `origin` des containers calculées automatiquement en cercle autour de
  l'hôte selon leur nombre.

## Contrat de données

Le shape JSON retourné est **identique** à la sortie de `buildArchitecture()`
aujourd'hui, plus un champ `generatedAt` (timestamp serveur) remplaçant la constante
`NOW` exportée actuellement par `data.js`. `scene-v2.js` et `content.js` consomment
`NOW` pour les dates relatives — ils utiliseront `generatedAt`.

## Modifications frontend (minimales)

### `inspector/data.js`

Remplacer `buildArchitecture()` (simulation) par `fetchArchitecture()` :

```js
export async function fetchArchitecture() {
  const res = await fetch("/api/snapshot");
  return res.json(); // { generatedAt, islands }
}
export { flatten }; // inchangé
```

### `inspector/main-v2.js`

`buildArchitecture()` → `await fetchArchitecture()`. Propager `generatedAt` là où
`NOW` était utilisé. Ajouter un état de chargement (le walk peut prendre ~1s).

### Inchangés

`scene-v2.js`, `layout.js`, `themes.js`, `OpenTree.html` (hors état de chargement).
Aucun bundler, aucun build step.

## Robustesse — le snapshot ne plante jamais à blanc

| Panne                           | Comportement                                  |
| ------------------------------- | --------------------------------------------- |
| Docker socket inaccessible      | Hôte retourné, containers `status: 'unknown'` |
| `docker exec` échoue            | Île présente avec son statut, arbre vide      |
| `events.ndjson` absent/corrompu | Fallback silencieux sur mtime                 |
| Dossier sans permission         | Skip, log, on continue                        |

Chaque échec partiel est isolé : `/api/snapshot` retourne toujours quelque chose,
jamais un 500.

## Sécurité

- Bind `127.0.0.1` uniquement, inaccessible hors SSH tunnel.
- Accès Docker **lecture seule** — jamais de start/stop, jamais d'exec destructif.
- `docker exec ... find` en lecture seule.

## Déploiement

- `opentree-agent.service` (systemd user unit) : restart auto + démarrage au boot.
- `systemctl --user enable --now opentree-agent`.

## Hors scope (YAGNI)

- Push temps réel (WebSocket/SSE) — snapshot au chargement suffit.
- Polling automatique.
- Authentification applicative — le SSH tunnel fait office de barrière.
- Historique persistant au-delà de `events.ndjson`.
