# OpenTree — Plugin OpenClaw exposé (URL protégée + refresh)

Date : 2026-06-19
Statut : design validé, en attente de plan d'implémentation

## Objectif

Transformer `opentree-agent` (service Node.js standalone, branche `feat/opentree-backend`)
en **vrai plugin OpenClaw**, afin de :

1. Accéder au viewer OpenTree en permanence via une URL.
2. Protéger cette URL par mot de passe.
3. Disposer, dans le viewer, d'un bouton de mise à jour des données.

## Décisions de cadrage

| Question   | Décision                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------- |
| Cible      | Vrai plugin OpenClaw (pas seulement le résultat déployé).                                          |
| Audience   | L'utilisateur seul, depuis ses propres appareils.                                                  |
| Exposition | Tailscale Serve → URL HTTPS stable, gratuit, rien d'ouvert sur Internet.                           |
| Auth       | Mot de passe natif du gateway (`gateway.auth.mode: "password"`). Les routes de plugin en héritent. |
| Refresh    | Cache côté serveur (réponse instantanée) + bouton force-refresh.                                   |

## Pourquoi le chemin plugin est le plus simple ici

La doc gateway OpenClaw (`/gateway/security`) confirme :

- Mode auth `password` via `OPENCLAW_GATEWAY_PASSWORD`.
- Les routes HTTP enregistrées par un plugin héritent de `gateway.auth.*`.
- Accès distant gratuit via Tailscale Serve (`/gateway/remote`, `/gateway/tailscale`).
- Gateway par défaut sur `127.0.0.1:18789`.

Conséquence : OpenClaw fournit nativement le mot de passe + le HTTPS + l'exposition.
Le plugin n'a qu'à servir le viewer et l'API à travers le gateway — aucun code d'auth,
aucun reverse proxy à maintenir.

## Approche retenue : A — `registerHttpRoute`

Le plugin enregistre ses routes directement sur le gateway. Rejeté :

- **B** (`registerService` seul) : auth et exposition non héritées, nécessite un proxy + re-brancher l'auth.
- **C** (hybride service + proxy) : réutilisation maximale du code mais complexité runtime
  injustifiée vu la petite taille de l'agent.

## Architecture

### Structure du paquet

```
opentree-agent/
  openclaw.plugin.json     # manifeste plugin
  src/index.ts             # SEUL code TS : enregistre routes + démarre/arrête le watcher
  lib/
    snapshot.mjs           # inchangé
    walk.mjs               # inchangé
    docker.mjs             # inchangé
    usage.mjs              # inchangé
    watcher.mjs            # inchangé (+ rotation events, voir plus bas)
    cache.mjs              # NOUVEAU : cache du dernier snapshot
  inspector/               # assets statiques du viewer
  test/                    # tests existants + nouveaux (cache, rotation)
```

Build : `tsc` sur `src/index.ts` uniquement. C'est le seul pas de build introduit.
La logique métier reste en ESM JS (`lib/*.mjs`), importée par le wrapper TS.

### Routes (via `registerHttpRoute`)

- `GET <prefix>/` + assets → fichiers statiques du viewer (logique reprise de `server.mjs`).
- `GET <prefix>/api/snapshot` → snapshot **en cache** (réponse instantanée ; build paresseux si vide).
- `POST <prefix>/api/refresh` → force un rebuild, met à jour le cache, renvoie le snapshot frais.

Toutes héritent de `gateway.auth` → protégées par mot de passe sans code dédié.

### Couche de cache (`lib/cache.mjs`)

- Garde `{ snapshot, generatedAt }`.
- Premier accès `/api/snapshot` → build paresseux puis mise en cache.
- `/api/refresh` → rebuild systématique + mise à jour du cache.
- Aucun rafraîchissement automatique : le cache ne change que sur action utilisateur.
- Le `watcher` continue d'alimenter `events.ndjson` indépendamment du cache.

### Cycle de vie du watcher

Le `fs.watch` récursif démarre à l'activation du plugin et se ferme à la désactivation,
via les hooks de cycle de vie du SDK. Nom exact des hooks **à confirmer dans le plan**
(non documenté côté doc publique).

### Bouton refresh (front)

Dans `inspector/` :

- Bouton avec état de chargement (le rebuild prend quelques secondes : walk disque + Docker
  `stats?stream=false` ~1-2 s par conteneur).
- Appelle `POST <prefix>/api/refresh`.
- Rendre le chemin de base de l'API configurable : le viewer est désormais servi sous un
  préfixe gateway, plus à la racine (`inspector/data.js` utilise actuellement `/api/snapshot` en dur).

### Correctif inclus : rotation `events.ndjson`

`watcher.mjs` ne fait qu'append ; `parseEventsNdjson` jette déjà les lignes > 30 jours à la
lecture (`usage.mjs:28-29`) mais le fichier disque croît sans borne et est relu en entier à
chaque rebuild. Correctif : purge des lignes > 30 jours (au démarrage et/ou périodiquement).
Seul vrai vecteur de dégradation dans le temps ; petit correctif, inclus puisqu'on touche l'agent.

## Déploiement (documentation, pas du code)

README de déploiement :

1. `openclaw plugins install` du paquet (forme git/clawhub à préciser).
2. `gateway.auth.mode: "password"` + `OPENCLAW_GATEWAY_PASSWORD`.
3. Tailscale Serve pour l'URL HTTPS permanente.

Le gateway OpenClaw tourne déjà sur le VPS Hetzner (conteneur `gateway-1` dans l'inventaire).

## Tests

- Les 24 tests lib existants restent valides (logique pure inchangée).
- Nouveaux : module cache (build paresseux, force-refresh, invalidation) + rotation events.
- Test d'intégration du wrapper si le SDK l'autorise.

## Incertitudes à lever dans le plan (à ne pas inventer)

1. Signatures exactes de `registerHttpRoute` et des hooks d'activation/désactivation
   → à extraire du **code source du SDK** (la doc publique ne les détaille pas).
2. Mécanisme exact pour servir des fichiers statiques via le SDK (handler manuel vs helper).
3. Préfixe de route imposé/recommandé par le gateway.
4. Forme d'installation supportée (`git:`, `clawhub:`) et tooling de build attendu côté plugin.

## Hors périmètre

- Test grandeur nature sur le VPS Hetzner (à faire après implémentation ; tout est vérifié en
  local sur Mac, d'où `islands=1` et pas de disque réel).
- Auth multi-utilisateurs / partage externe (audience = utilisateur seul).
- Auto-refresh périodique (écarté pour éviter le polling).
