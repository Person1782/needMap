// One shared analysis feeds the map and planner, even when users switch tabs.
export function createAnalysisCoordinator({ analyze, onUpdate, onProgress, onError }) {
  let controller;
  let revision = 0;
  let current = [];
  let running = false;
  let completed = false;
  let destroyed = false;
  return {
    replace(recommendations) {
      if (destroyed) return;
      controller?.abort();
      revision += 1;
      current = recommendations;
      running = false;
      completed = false;
      onUpdate(current);
    },
    async run({ force = false } = {}) {
      if (destroyed || running || (completed && !force) || !current.length) return;
      controller = new AbortController();
      const signal = controller.signal;
      const requestRevision = ++revision;
      const source = [...current];
      running = true;
      let analyzed = 0;
      let failed = 0;
      let firstError;
      onProgress({ running, processed: 0, total: source.length, analyzed, failed });
      for (let offset = 0; offset < source.length; offset += 4) {
        const batch = source.slice(offset, offset + 4);
        try {
          const result = await analyze(batch, { signal, candidateOffset: offset });
          if (revision !== requestRevision) return;
          const updated = new Map(result.recommendations.map((item) => [item.id, item]));
          current = current.map((item) => updated.get(item.id) || item);
          analyzed += batch.length;
          onUpdate(current);
        } catch (error) {
          if (revision !== requestRevision || signal.aborted) return;
          failed += batch.length;
          firstError ||= error;
          onError?.(error);
        }
        if (revision !== requestRevision) return;
        onProgress({ running: true, processed: Math.min(offset + 4, source.length), total: source.length, analyzed, failed });
      }
      if (revision !== requestRevision) return;
      running = false;
      completed = true;
      onProgress({ running, processed: source.length, total: source.length, analyzed, failed, error: firstError });
    },
    destroy() { destroyed = true; controller?.abort(); revision += 1; running = false; },
  };
}
