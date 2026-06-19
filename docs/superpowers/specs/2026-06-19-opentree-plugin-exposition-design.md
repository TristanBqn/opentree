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

Signature confirmée dans le source (`openclaw/openclaw:src/plugins/types.ts:2119-2146`) :

```ts
type OpenClawPluginHttpRouteAuth = "gateway" | "plugin";
type OpenClawPluginHttpRouteMatch = "exact" | "prefix";
type OpenClawPluginHttpRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean | void> | boolean | void;
type OpenClawPluginHttpRouteParams = {
  path: string;
  handler: OpenClawPluginHttpRouteHandler;
  auth: OpenClawPluginHttpRouteAuth;
  match?: OpenClawPluginHttpRouteMatch;
  handleUpgrade?;
  nodeCapability?;
  replaceExisting?;
};
```

Le handler est un `(req, res)` Node http standard → la logique de `server.mjs` se branche
quasi telle quelle. Routes :

- `GET <prefix>/` + assets (`auth: "gateway"`, `match: "prefix"`) → fichiers statiques du viewer.
- `GET <prefix>/api/snapshot` (`auth: "gateway"`, `match: "exact"`) → snapshot **en cache**
  (réponse instantanée ; build paresseux si vide).
- `POST <prefix>/api/refresh` (`auth: "gateway"`, `match: "exact"`) → force un rebuild, met à
  jour le cache, renvoie le snapshot frais.

`auth: "gateway"` fait hériter les routes de `gateway.auth.*` → protégées par mot de passe sans
code dédié (valeur confirmée dans le source). Le préfixe `<prefix>` (ex. `/opentree`) est choisi
par le plugin, pas imposé par le gateway. Modèle de référence : `extensions/canvas/` (UI web
servie via le gateway).

### Couche de cache (`lib/cache.mjs`)

- Garde `{ snapshot, generatedAt }`.
- Premier accès `/api/snapshot` → build paresseux puis mise en cache.
- `/api/refresh` → rebuild systématique + mise à jour du cache.
- Aucun rafraîchissement automatique : le cache ne change que sur action utilisateur.
- Le `watcher` continue d'alimenter `events.ndjson` indépendamment du cache.

### Cycle de vie du watcher

Confirmé dans le source (`src/plugins/types.ts:2356-2360`) :

```ts
type OpenClawPluginService = {
  id: string;
  start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
  stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
};
// ctx fournit: { config, workspaceDir, stateDir, logger }
```

Le watcher est enregistré via `api.registerService({ id, start, stop })` : `start` ouvre le
`fs.watch` récursif, `stop` le ferme. Le `ctx.stateDir` fourni par le SDK est l'emplacement
propre où écrire `events.ndjson` (remplace le `.data` codé en dur dans
`opentree-agent.mjs:16`).

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

## SDK confirmé (source `github.com/openclaw/openclaw`, lu via `gh` le 2026-06-19)

Les incertitudes initiales sont levées par lecture directe du source :

1. ✅ Signature `registerHttpRoute` → `src/plugins/types.ts:2119-2146` (voir section Routes).
2. ✅ Cycle de vie → `registerService({ id, start, stop })`, `src/plugins/types.ts:2356-2360`.
3. ✅ Fichiers statiques → handler `(req, res)` manuel + `match: "prefix"` (pas de helper dédié ;
   on reprend la logique de `server.mjs`). Modèle : `extensions/canvas/index.ts`.
4. ✅ Point d'entrée → `definePluginEntry({ id, name, description, configSchema, register })`
   depuis `openclaw/plugin-sdk/plugin-entry` (cf. `extensions/canvas/index.ts`).
5. ✅ Installation → `openclaw plugins install` (ClawHub en premier, fallback npm ;
   formes `git:`/`clawhub:`/npm).

### Reste à recouper au moment d'écrire le code (mineur)

- Schéma exact du manifeste `openclaw.plugin.json` (champs `id`/`name`/`kind`/`activation`/
  `configSchema`) → relire `docs/plugins/building-plugins` + un manifeste d'extension réel.
- Node ≥ 22.19 requis pour le dev plugin (à vérifier vs runtime cible).

## Hors périmètre

- Test grandeur nature sur le VPS Hetzner (à faire après implémentation ; tout est vérifié en
  local sur Mac, d'où `islands=1` et pas de disque réel).
- Auth multi-utilisateurs / partage externe (audience = utilisateur seul).
- Auto-refresh périodique (écarté pour éviter le polling).
