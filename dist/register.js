import { join } from "node:path";
import { createSnapshotCache } from "../lib/cache.mjs";
import { createRequestHandler } from "../lib/handlers.mjs";
import { buildSnapshot } from "../lib/snapshot.mjs";
import { startWatcher } from "../lib/watcher.mjs";
export function registerOpenTree(api, deps) {
    let stateDir = deps.stateDir;
    const cache = createSnapshotCache({
        build: () => buildSnapshot({
            hostRoot: deps.hostRoot,
            hostName: deps.hostName,
            dataDir: stateDir,
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
    let watcher = null;
    api.registerService({
        id: "opentree-watcher",
        start: (ctx) => {
            if (watcher)
                return;
            stateDir = ctx.stateDir || deps.stateDir;
            const eventsPath = join(stateDir, "events.ndjson");
            watcher = startWatcher({
                absRoot: deps.hostRoot,
                rootName: deps.hostName,
                eventsPath,
            });
        },
        stop: (ctx) => {
            void ctx;
            watcher?.close();
            watcher = null;
        },
    });
}
