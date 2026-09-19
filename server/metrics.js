const MAX_SAMPLES = 200;

// In-memory buffer of recent query latencies
const queryLatencies = [];

function recordQueryLatency(durationMs, meta = {}) {
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs)) {
    return;
  }

  const entry = {
    durationMs,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  queryLatencies.push(entry);
  if (queryLatencies.length > MAX_SAMPLES) {
    queryLatencies.shift();
  }

  const pathLabel = meta.path ? ` path=${meta.path}` : '';
  const outcomeLabel = meta.success === false ? ' (error)' : '';
  // Log a concise line so you can see per-query timings in server logs
  // Example: [Metrics] Query latency: 842ms path=vector (error)
  console.log(`[Metrics] Query latency: ${durationMs}ms${pathLabel}${outcomeLabel}`);
}

function getQueryLatencyStats() {
  if (queryLatencies.length === 0) {
    return {
      sampleCount: 0,
      averageMs: 0,
      minMs: 0,
      maxMs: 0,
      p50Ms: 0,
      p90Ms: 0,
      p95Ms: 0,
      lastSample: null,
    };
  }

  const durations = queryLatencies.map((e) => e.durationMs);
  const sampleCount = durations.length;
  const total = durations.reduce((sum, v) => sum + v, 0);
  const averageMs = total / sampleCount;

  const sorted = [...durations].sort((a, b) => a - b);
  const percentile = (p) => {
    if (!sorted.length) return 0;
    const idx = Math.floor((p / 100) * (sorted.length - 1));
    return sorted[idx];
  };

  return {
    sampleCount,
    averageMs,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p50Ms: percentile(50),
    p90Ms: percentile(90),
    p95Ms: percentile(95),
    lastSample: queryLatencies[queryLatencies.length - 1],
  };
}

module.exports = {
  recordQueryLatency,
  getQueryLatencyStats,
};

