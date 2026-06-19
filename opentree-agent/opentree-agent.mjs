import { mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createServer } from "./lib/server.mjs";
import { buildSnapshot } from "./lib/snapshot.mjs";
import { startWatcher } from "./lib/watcher.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.OPENTREE_PORT || "7070", 10);
const HOST_ROOT = process.env.OPENTREE_HOST_ROOT || join(homedir(), "openclaw");
const HOST_NAME = process.env.OPENTREE_HOST_NAME || "~/openclaw";
const STATIC_DIR = resolve(
  process.env.OPENTREE_STATIC || join(here, "..", "inspector"),
);
const DATA_DIR = resolve(process.env.OPENTREE_DATA || join(here, ".data"));
const SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";

await mkdir(DATA_DIR, { recursive: true });

const getSnapshot = () =>
  buildSnapshot({
    hostRoot: HOST_ROOT,
    hostName: HOST_NAME,
    dataDir: DATA_DIR,
    socketPath: SOCKET,
    now: Date.now(),
  });

startWatcher({
  absRoot: HOST_ROOT,
  rootName: HOST_NAME,
  eventsPath: join(DATA_DIR, "events.ndjson"),
});

const server = createServer({ staticDir: STATIC_DIR, getSnapshot });
server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[opentree] http://127.0.0.1:${PORT}  (host=${HOST_ROOT}, static=${STATIC_DIR})`,
  );
});
