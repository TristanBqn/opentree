import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerOpenTree } from "./register.js";
import { parseHosts } from "../lib/snapshot.mjs";
const here = dirname(fileURLToPath(import.meta.url));
export default definePluginEntry({
    id: "opentree",
    name: "OpenTree",
    description: "Architecture visualiser served through the gateway.",
    register(api) {
        registerOpenTree(api, {
            staticDir: resolve(here, "..", "inspector"),
            hosts: parseHosts(process.env.OPENTREE_HOST_ROOT || join(homedir(), "openclaw"), process.env.OPENTREE_HOST_NAME || "~/openclaw"),
            stateDir: process.env.OPENTREE_DATA || resolve(here, "..", ".data"),
            socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock",
        });
    },
});
