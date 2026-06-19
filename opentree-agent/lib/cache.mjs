export function createSnapshotCache({ build }) {
  let current = null;
  let inflight = null;

  function rebuild() {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const snapshot = await build();
        current = { snapshot, generatedAt: snapshot.generatedAt };
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
