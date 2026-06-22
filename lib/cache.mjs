import zlib from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(zlib.gzip);

export function createSnapshotCache({ build }) {
  let current = null;
  let inflight = null;

  function rebuild() {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const snapshot = await build();
        const json = JSON.stringify(snapshot);
        const gzip = await gzipAsync(json);
        current = { snapshot, generatedAt: snapshot.generatedAt, json, gzip };
        return current;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return {
    get: () => (current ? Promise.resolve(current) : rebuild()),
    refresh: () => rebuild(),
    peek: () => current,
  };
}
