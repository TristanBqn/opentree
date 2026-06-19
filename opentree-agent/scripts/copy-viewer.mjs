import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "..", "inspector");
const dest = resolve(here, "..", "viewer");

await rm(dest, { recursive: true, force: true });
await cp(src, dest, { recursive: true });
