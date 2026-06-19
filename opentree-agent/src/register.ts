import { join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { createSnapshotCache } from "../lib/cache.mjs";
import { createRequestHandler } from "../lib/handlers.mjs";
import { buildSnapshot } from "../lib/snapshot.mjs";
import { startWatcher } from "../lib/watcher.mjs";

type Deps = {
  staticDir: string;
  hostRoot: string;
  hostName: string;
  stateDir: string;
  socketPath: string;
};

export function registerOpenTree(api: OpenClawPluginApi, deps: Deps): void {
  const eventsPath = join(deps.stateDir, "events.ndjson");
  const cache = createSnapshotCache({
    build: () =>
      buildSnapshot({
        hostRoot: deps.hostRoot,
        hostName: deps.hostName,
        dataDir: deps.stateDir,
        socketPath: deps.socketPath,
        now: Date.now(),
      }),
  });

  api.registerHttpRoute({
    path: "/opentree",
    auth: "gateway",
    match: "prefix",
    handler: createRequestHandler({
      staticDir: deps.staticDir,
      cache,
      prefix: "/opentree",
    }),
  });

  let watcher: { close: () => void } | null = null;
  api.registerService({
    id: "opentree-watcher",
    start: (_ctx) => {
      watcher = startWatcher({
        absRoot: deps.hostRoot,
        rootName: deps.hostName,
        eventsPath,
      });
    },
    stop: (_ctx) => {
      watcher?.close();
      watcher = null;
    },
  });
}
