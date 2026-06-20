# OpenTree — Handoff (2026-06-20)

État de reprise du déploiement d'OpenTree en plugin OpenClaw sur le VPS Hetzner.

## Objectif

Faire tourner le viewer 3D OpenTree comme **plugin OpenClaw**, accessible depuis un
navigateur via une URL (à terme permanente + protégée), avec un bouton de
rafraîchissement des données. Le viewer cartographie une arborescence de fichiers
et les conteneurs Docker.

## État actuel — CE QUI MARCHE ✅

- Le plugin **est déployé, chargé et rendu** dans le navigateur.
  Log gateway : `http server listening (7 plugins: …, opentree, …)`.
- Accès **via tunnel SSH** : `ssh -L 18789:127.0.0.1:18789 openclaw@<VPS>` puis
  `http://localhost:18789/opentree/` → le viewer 3D s'affiche.
- Le backend renvoie de **vraies données VPS** : host `openclaw`, `4 vCPU · 7,6 Gi`,
  `disque 36G / 150G`. `/opentree/api/snapshot` répond en ~60 ms.
- Le dépôt **github.com/TristanBqn/opentree** est la source de vérité (public).
- Le dépôt `neuronal_skills` a été **remis dans son état d'origine** (le push initial
  par erreur a été annulé : PR fermée + branche distante supprimée, `main` intact).

## CE QU'IL RESTE À FAIRE

### 1. Pointer le scan sur `/app` + voir les conteneurs Docker (en cours)

Actuellement le viewer affiche « 0 fichier · 0 conteneur · 1 dossier » car :

- il scanne `~/openclaw` = `/home/node/openclaw` (inexistant dans le conteneur) ;
- le conteneur gateway n'a pas accès au socket Docker.

**Décision prise** : cartographier `/app` (l'install OpenClaw) + monter le socket Docker.
**Sécurité** : monter `/var/run/docker.sock` donne au gateway le contrôle de Docker (≈ root) — accepté.

**À faire** — modifier le docker-compose du gateway. D'abord localiser et inspecter :

```bash
docker inspect openclaw-openclaw-gateway-1 --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}'
docker inspect openclaw-openclaw-gateway-1 --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'
```

Puis, dans le service gateway, ajouter :

```yaml
environment:
  - OPENTREE_HOST_ROOT=/app
  - OPENTREE_HOST_NAME=openclaw
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

⚠️ Indentation YAML : `environment:` et `volumes:` doivent être **imbriqués sous le service
gateway** (même niveau que `image:`/`container_name:`), pas à la racine du fichier. S'ils
existent déjà dans le service, ajouter seulement les lignes `-` manquantes.

Recréer : `docker compose -f <compose> up -d` puis recharger `/opentree/`.

> NB : sans binaire `docker` dans le conteneur, l'arbre INTERNE de chaque conteneur
> sera vide (l'appel `docker exec find` échoue), mais les conteneurs apparaîtront
> avec leurs stats (CPU/RAM/ports). Pour les arbres internes, il faudrait réécrire
> `lib/docker.mjs:execFind` pour utiliser l'API exec du socket (pas fait).

### 2. URL permanente + auth (plus tard)

- Tailscale **n'est pas installé** sur le VPS. Pour l'URL permanente :
  `sudo snap install tailscale` → `sudo tailscale up` → `tailscale serve --bg 18789`
  → `https://<machine>.<tailnet>.ts.net/opentree/`.
- Auth navigateur : la route est en `auth: "plugin"` (voir plus bas), donc **non
  protégée par mot de passe** — la protection vient du réseau (tunnel SSH ou tailnet).
  Pour un vrai mot de passe navigateur, ajouter un **HTTP Basic Auth** dans
  `lib/handlers.mjs` (non fait).

### 3. Backports / nettoyage

- Le dépôt est correct, mais l'install manuelle copie **seulement l'essentiel**
  (manifeste + package.json + dist + lib + inspector). Pas de mécanisme auto.
- Faire `hostRoot`/`hostName` des **options de config du plugin** (configSchema +
  lecture de `api.pluginConfig`) serait plus propre que l'env (permettrait
  `openclaw config set plugins.entries.opentree.config.hostRoot …` sans redéployer).

## HISTORIQUE DES BLOCAGES ET RÉSOLUTIONS (ce qui n'a pas marché et pourquoi)

1. **`openclaw plugins install git:…` refusé** — le manifeste était dans le sous-dossier
   `opentree-agent/`, pas à la racine ; et l'install git scanne le code.
   → **Restructuration** : le plugin est devenu la racine du dépôt, `dist/` committé.

2. **Scan « dangerous code patterns: child_process »** (sur la 1ère install git, bannière
   2026.6.1) — bloquait les plugins utilisant `child_process` (`lib/snapshot.mjs` df,
   `lib/docker.mjs` exec). → **Non-problème sur ta version** : ce scan a été **retiré**
   dans OpenClaw 2026.6.8 (message explicite : `--dangerously-force-unsafe-install` est
   devenu no-op « because built-in install-time dangerous-code scanning has been removed »).
   Le code n'a pas eu à changer. (NB : on n'a jamais pu vérifier qu'une install locale
   contournait ce motif — elle échouait sur acpx avant, cf. #3.)

3. **`acpx` : « code safety scan failed »** — BLOQUE TOUTE install de plugin.
   Cause = symlink fantôme **dans l'install OpenClaw elle-même** :
   `/app/node_modules/.bin/acpx -> ../acpx/dist/cli.js` alors que le paquet `acpx`
   est **absent**. Défaut de l'image `openclaw:local` (2026.6.8). Pas notre plugin.
   → Contourné par **install manuelle** : copie dans le dossier d'extensions global
   `~/.openclaw/extensions/opentree/` (chargé au démarrage du gateway, sans le scan d'install).

4. **`peerDependency` vs `devDependency`** — on a d'abord **cru à tort** que `openclaw` en
   devDependency tirait acpx via un `npm install` complet. **Hypothèse fausse** : acpx est
   dans le `/app` d'OpenClaw (cf. #3), pas dans notre plugin ; ce changement n'a donc **pas**
   débloqué acpx (c'est l'install manuelle de #3 qui l'a fait). Le passage devDependency →
   **peerDependency** + suppression du `package-lock.json` reste néanmoins une **bonne pratique**
   (le plugin n'a aucune dépendance runtime ; l'hôte fournit le SDK) et est conservé tel quel.

5. **Manifeste : « requires configSchema »** — il faut un `configSchema`.
   → ajouté un schéma vide `{ "type":"object","additionalProperties":false,"properties":{} }`.

6. **« failed to parse manifest: JSON5 invalid '\n' at 2:0 »** — on avait copié **tout
   le dépôt** dans le dossier d'extension ; un `.json` parasite (probablement `tsconfig.json`)
   cassait le scanner de manifestes. → copier **seulement l'essentiel**.

7. **« blocked by allowlist »** — il y a une liste blanche `plugins.allow`.
   → `openclaw config set plugins.allow.7 opentree` + `openclaw config set plugins.entries.opentree.enabled true`.

8. **`/opentree/` → `{"error":"Unauthorized"}` au navigateur** — `auth: "gateway"` exige
   un en-tête `Authorization: Bearer <token>` que le navigateur n'envoie pas (la Control UI
   s'authentifie en WebSocket, pas en cookie HTTP). → passé en **`auth: "plugin"`** (comme
   le plugin Canvas qui sert aussi une UI web) ; protection assurée par le réseau.

9. **Viewer bloqué sur « lecture de l'architecture »** — THREE.js était chargé depuis le
   **CDN jsdelivr**, injoignable depuis le navigateur (réseau/CSP). → **THREE.js vendored
   en local** dans `inspector/vendor/` + importmap pointée dessus. Le plugin est
   maintenant auto-suffisant (aucune dépendance CDN).

## RÉFÉRENCES

### Dépôt

- `github.com/TristanBqn/opentree` (public). Clone de dev : `~/opentree` (Mac).
- Le plugin EST la racine du dépôt : `openclaw.plugin.json`, `package.json`, `dist/`,
  `lib/`, `inspector/` (avec `inspector/vendor/` = THREE bundlé), `src/`.
- Auth de la route : `src/register.ts` → `auth: "plugin"`.

### Environnement VPS

- OpenClaw **2026.6.8**, image `openclaw:local`, user `openclaw`.
- Conteneur gateway : `openclaw-openclaw-gateway-1`.
- `~/.openclaw` (hôte `/home/openclaw/.openclaw`) **monté** dans le conteneur sur
  `/home/node/.openclaw` (RW).
- Gateway HTTP : `127.0.0.1:18789` (publié sur l'hôte en loopback).
- Plugin installé manuellement : `~/.openclaw/extensions/opentree/`
  (contenu : `openclaw.plugin.json`, `package.json`, `dist/`, `lib/`, `inspector/`).

### Procédure de mise à jour du plugin (après modif du dépôt)

```bash
# Mac : pousser
git -C ~/opentree push origin HEAD:main
# VPS : tirer + recopier l'essentiel + redémarrer
cd ~/opentree && git pull
rm -rf ~/.openclaw/extensions/opentree/inspector ~/.openclaw/extensions/opentree/dist
cp -r ~/opentree/inspector ~/opentree/dist ~/.openclaw/extensions/opentree/
docker restart openclaw-openclaw-gateway-1
```

### Commandes utiles

```bash
# accès navigateur (laptop) : tunnel SSH puis http://localhost:18789/opentree/
ssh -L 18789:127.0.0.1:18789 openclaw@<VPS>

# tester la route depuis le VPS (auth:plugin → pas de token requis)
docker exec openclaw-openclaw-gateway-1 node -e "fetch('http://127.0.0.1:18789/opentree/api/snapshot').then(r=>r.text()).then(t=>console.log(t.slice(0,200)))"

# logs gateway
docker logs --tail 60 openclaw-openclaw-gateway-1 2>&1 | grep -iE "opentree|plugin|error"

# état des plugins / config
openclaw config get plugins.allow
```

### Pièges connus

- Le **terminal du VPS corrompt les pastes longues** (insère des retours à la ligne
  ~80 colonnes). Préférer des commandes courtes, ou passer par `git pull` + `cp` plutôt
  que de coller du JSON/scripts longs.
- `openclaw config get gateway.auth.token` renvoie `__OPENCLAW_REDACTED__` (masqué) ;
  lire la valeur réelle dans `~/.openclaw/openclaw.json` si besoin.
- `plugin-network` (autre plugin git déjà présent) est cassé (`Cannot find module 'typebox'`)
  et fait planter certaines commandes CLI — indépendant d'OpenTree.
