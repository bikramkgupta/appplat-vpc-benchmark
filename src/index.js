const express = require('express');
const { Client } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const APP_TYPE = process.env.APP_TYPE || 'UNKNOWN';
const BENCHMARK_INTERVAL = 45 * 1000; // 45 seconds

// Store benchmark results in memory
const results = [];
const startTime = new Date();

// Calculate percentile
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// Calculate statistics
function calculateStats() {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  if (successful.length === 0) {
    return {
      appType: APP_TYPE,
      totalMeasurements: results.length,
      successfulMeasurements: 0,
      failedMeasurements: failed.length,
      failureRate: results.length > 0 ? (failed.length / results.length * 100).toFixed(2) + '%' : '0%',
      latency: null,
      uptime: getUptime(),
      startTime: startTime.toISOString()
    };
  }

  const connectLatencies = successful.map(r => r.connectLatencyMs);
  const queryLatencies = successful.map(r => r.queryLatencyMs);
  const totalLatencies = successful.map(r => r.totalLatencyMs);

  return {
    appType: APP_TYPE,
    totalMeasurements: results.length,
    successfulMeasurements: successful.length,
    failedMeasurements: failed.length,
    failureRate: (failed.length / results.length * 100).toFixed(2) + '%',
    latency: {
      connect: {
        min: Math.min(...connectLatencies).toFixed(2),
        max: Math.max(...connectLatencies).toFixed(2),
        avg: (connectLatencies.reduce((a, b) => a + b, 0) / connectLatencies.length).toFixed(2),
        p50: percentile(connectLatencies, 50).toFixed(2),
        p95: percentile(connectLatencies, 95).toFixed(2),
        p99: percentile(connectLatencies, 99).toFixed(2)
      },
      query: {
        min: Math.min(...queryLatencies).toFixed(2),
        max: Math.max(...queryLatencies).toFixed(2),
        avg: (queryLatencies.reduce((a, b) => a + b, 0) / queryLatencies.length).toFixed(2),
        p50: percentile(queryLatencies, 50).toFixed(2),
        p95: percentile(queryLatencies, 95).toFixed(2),
        p99: percentile(queryLatencies, 99).toFixed(2)
      },
      total: {
        min: Math.min(...totalLatencies).toFixed(2),
        max: Math.max(...totalLatencies).toFixed(2),
        avg: (totalLatencies.reduce((a, b) => a + b, 0) / totalLatencies.length).toFixed(2),
        p50: percentile(totalLatencies, 50).toFixed(2),
        p95: percentile(totalLatencies, 95).toFixed(2),
        p99: percentile(totalLatencies, 99).toFixed(2)
      }
    },
    uptime: getUptime(),
    startTime: startTime.toISOString()
  };
}

function getUptime() {
  const now = new Date();
  const diff = now - startTime;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  return `${hours}h ${minutes}m ${seconds}s`;
}

// Measure latency
async function measureLatency() {
  const start = process.hrtime.bigint();

  try {
    const client = new Client({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    await client.connect();
    const connectTime = process.hrtime.bigint();

    await client.query('SELECT 1');
    const queryTime = process.hrtime.bigint();

    await client.end();

    const result = {
      timestamp: new Date().toISOString(),
      connectLatencyMs: Number(connectTime - start) / 1e6,
      queryLatencyMs: Number(queryTime - connectTime) / 1e6,
      totalLatencyMs: Number(queryTime - start) / 1e6,
      success: true
    };

    console.log(`[${APP_TYPE}] Benchmark: connect=${result.connectLatencyMs.toFixed(2)}ms, query=${result.queryLatencyMs.toFixed(2)}ms, total=${result.totalLatencyMs.toFixed(2)}ms`);

    return result;
  } catch (error) {
    const result = {
      timestamp: new Date().toISOString(),
      error: error.message,
      success: false
    };

    console.error(`[${APP_TYPE}] Benchmark FAILED: ${error.message}`);

    return result;
  }
}

// Run benchmark
async function runBenchmark() {
  const result = await measureLatency();
  results.push(result);

  // Keep only last 400 results (more than 4 hours at 45s intervals)
  if (results.length > 400) {
    results.shift();
  }
}

// Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    appType: APP_TYPE,
    uptime: getUptime(),
    measurements: results.length
  });
});

app.get('/metrics', (req, res) => {
  const stats = calculateStats();
  const lastResult = results.length > 0 ? results[results.length - 1] : null;
  res.json({
    ...stats,
    lastMeasurement: lastResult
  });
});

app.get('/metrics/summary', (req, res) => {
  const stats = calculateStats();

  // Format as text for easy reading
  let text = `=== ${APP_TYPE} App Benchmark Summary ===\n\n`;
  text += `Start Time: ${stats.startTime}\n`;
  text += `Uptime: ${stats.uptime}\n`;
  text += `Total Measurements: ${stats.totalMeasurements}\n`;
  text += `Successful: ${stats.successfulMeasurements}\n`;
  text += `Failed: ${stats.failedMeasurements}\n`;
  text += `Failure Rate: ${stats.failureRate}\n\n`;

  if (stats.latency) {
    text += `--- Total Latency (Connect + Query) ---\n`;
    text += `  Min: ${stats.latency.total.min} ms\n`;
    text += `  Max: ${stats.latency.total.max} ms\n`;
    text += `  Avg: ${stats.latency.total.avg} ms\n`;
    text += `  P50: ${stats.latency.total.p50} ms\n`;
    text += `  P95: ${stats.latency.total.p95} ms\n`;
    text += `  P99: ${stats.latency.total.p99} ms\n\n`;

    text += `--- Connect Latency ---\n`;
    text += `  Min: ${stats.latency.connect.min} ms\n`;
    text += `  Max: ${stats.latency.connect.max} ms\n`;
    text += `  Avg: ${stats.latency.connect.avg} ms\n`;
    text += `  P50: ${stats.latency.connect.p50} ms\n`;
    text += `  P95: ${stats.latency.connect.p95} ms\n`;
    text += `  P99: ${stats.latency.connect.p99} ms\n\n`;

    text += `--- Query Latency ---\n`;
    text += `  Min: ${stats.latency.query.min} ms\n`;
    text += `  Max: ${stats.latency.query.max} ms\n`;
    text += `  Avg: ${stats.latency.query.avg} ms\n`;
    text += `  P50: ${stats.latency.query.p50} ms\n`;
    text += `  P95: ${stats.latency.query.p95} ms\n`;
    text += `  P99: ${stats.latency.query.p99} ms\n`;
  } else {
    text += `No successful measurements yet.\n`;
  }

  res.type('text/plain').send(text);
});

app.get('/metrics/history', (req, res) => {
  res.json({
    appType: APP_TYPE,
    startTime: startTime.toISOString(),
    totalResults: results.length,
    results: results
  });
});

app.get('/metrics/failures', (req, res) => {
  const failures = results.filter(r => !r.success);
  res.json({
    appType: APP_TYPE,
    totalFailures: failures.length,
    failures: failures
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[${APP_TYPE}] Server running on port ${PORT}`);
  console.log(`[${APP_TYPE}] Database URL configured: ${DATABASE_URL ? 'Yes' : 'No'}`);
  console.log(`[${APP_TYPE}] Starting benchmark (every ${BENCHMARK_INTERVAL / 1000}s)...`);

  // Run initial benchmark
  runBenchmark();

  // Schedule recurring benchmarks
  setInterval(runBenchmark, BENCHMARK_INTERVAL);
});
