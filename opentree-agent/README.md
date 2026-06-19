# OpenTree — OpenClaw plugin

Serves the OpenTree architecture visualiser through the OpenClaw gateway,
behind the gateway password, reachable from your own devices over Tailscale.

## Build

    cd opentree-agent
    npm install        # installs the OpenClaw SDK dev dependency
    npm run build      # emits dist/index.js (the plugin entry)

## Install on the VPS

The plugin entry is `dist/index.js` (declared in `package.json` → `openclaw.extensions`).
Install it into the running OpenClaw on the Hetzner host:

    openclaw plugins install <path-or-clawhub-or-git-spec>

(Local path install is the simplest here. ClawHub publishing additionally
requires `openclaw.compat` and `openclaw.build` fields in `package.json` — out
of scope for a private single-host deploy.)

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
