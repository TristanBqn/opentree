# OpenTree — OpenClaw plugin

Serves the OpenTree architecture visualiser through the OpenClaw gateway,
behind the gateway password, reachable from your own devices over Tailscale.

## Install (one command)

This repository **is** the plugin package: the manifest (`openclaw.plugin.json`),
`package.json`, the prebuilt entry (`dist/index.js`) and the viewer (`inspector/`)
all live at the repo root, so OpenClaw can install it straight from git:

    openclaw plugins install git:github.com/TristanBqn/opentree

The plugin has no runtime dependencies (the `openclaw/plugin-sdk` import is provided
by the host gateway). `dist/` is committed because `openclaw plugins install` does
not run build scripts.

## Rebuild after changing the source

Only needed if you edit `src/*.ts`. Build-time deps are intentionally NOT declared
in `package.json` (so `openclaw plugins install` installs nothing and the host
provides `openclaw` via the peer link). Install them locally without saving:

    npm install --no-save openclaw @types/node
    npm run build      # tsc -> dist/index.js (then commit dist/)

## Protect with a password

In the gateway config, enable password auth:

    gateway:
      auth:
        mode: password

Set the password via env:

    export OPENCLAW_GATEWAY_PASSWORD='<your-strong-password>'

All OpenTree routes register with `auth: "gateway"`, so they inherit this password.
Note: this password also guards the gateway Control UI — acceptable here because
you are the only operator.

## Reach it permanently over Tailscale (free)

The gateway listens on 127.0.0.1:18789. Expose it to your tailnet only:

    tailscale serve --bg 18789

Then open `https://<host>.<tailnet>.ts.net/opentree/` from any of your devices,
enter the password, and use the ⟳ button to refresh the data on demand.

## Configuration (env)

| Var                  | Default                | Meaning                                    |
| -------------------- | ---------------------- | ------------------------------------------ |
| `OPENTREE_HOST_ROOT` | `~/openclaw`           | Root directory walked for the host island. |
| `OPENTREE_HOST_NAME` | `~/openclaw`           | Display name of the host root.             |
| `OPENTREE_DATA`      | `<plugin>/.data`       | State dir (events.ndjson).                 |
| `DOCKER_SOCKET`      | `/var/run/docker.sock` | Docker socket for container islands.       |
