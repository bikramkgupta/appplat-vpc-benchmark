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
  const pingLatencies = successful.map(r => r.pingLatencyMs).filter(v => v !== undefined);
  const longQueryLatencies = successful.map(r => r.longQueryLatencyMs).filter(v => v !== undefined);
  const avgRoundTrips = successful.map(r => r.avgRoundTripMs).filter(v => v !== undefined);
  const queryLatencies = successful.map(r => r.queryLatencyMs);
  const totalLatencies = successful.map(r => r.totalLatencyMs);

  const calcStats = (arr) => ({
    min: Math.min(...arr).toFixed(2),
    max: Math.max(...arr).toFixed(2),
    avg: (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2),
    p50: percentile(arr, 50).toFixed(2),
    p95: percentile(arr, 95).toFixed(2),
    p99: percentile(arr, 99).toFixed(2)
  });

  return {
    appType: APP_TYPE,
    totalMeasurements: results.length,
    successfulMeasurements: successful.length,
    failedMeasurements: failed.length,
    failureRate: (failed.length / results.length * 100).toFixed(2) + '%',
    latency: {
      connect: calcStats(connectLatencies),
      ping: pingLatencies.length > 0 ? calcStats(pingLatencies) : null,
      longQuery: longQueryLatencies.length > 0 ? calcStats(longQueryLatencies) : null,
      avgRoundTrip: avgRoundTrips.length > 0 ? calcStats(avgRoundTrips) : null,
      query: calcStats(queryLatencies),
      total: calcStats(totalLatencies)
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
    // Parse the URL and ensure SSL is configured correctly
    // Remove sslmode from URL and configure SSL explicitly
    const dbUrl = DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, '');
    const client = new Client({
      connectionString: dbUrl,
      ssl: {
        rejectUnauthorized: false,  // Accept DO's private CA
      }
    });

    await client.connect();
    const connectTime = process.hrtime.bigint();

    // Run a simple ping query
    await client.query('SELECT 1');
    const pingTime = process.hrtime.bigint();

    // Run a longer query that generates and returns data
    // This better shows network throughput differences
    const longQuery = `
      SELECT
        gs.id,
        md5(random()::text) as hash1,
        md5(random()::text) as hash2,
        md5(random()::text) as hash3,
        now() as timestamp
      FROM generate_series(1, 1000) as gs(id)
    `;
    const queryResult = await client.query(longQuery);
    const longQueryTime = process.hrtime.bigint();

    // Run multiple round trips to measure sustained latency
    for (let i = 0; i < 10; i++) {
      await client.query('SELECT $1::int', [i]);
    }
    const multiRoundTripTime = process.hrtime.bigint();

    await client.end();

    const measurement = {
      timestamp: new Date().toISOString(),
      connectLatencyMs: Number(connectTime - start) / 1e6,
      pingLatencyMs: Number(pingTime - connectTime) / 1e6,
      longQueryLatencyMs: Number(longQueryTime - pingTime) / 1e6,
      longQueryRows: queryResult.rowCount,
      multiRoundTripLatencyMs: Number(multiRoundTripTime - longQueryTime) / 1e6,
      avgRoundTripMs: Number(multiRoundTripTime - longQueryTime) / 1e6 / 10,
      queryLatencyMs: Number(multiRoundTripTime - connectTime) / 1e6,  // Total query time
      totalLatencyMs: Number(multiRoundTripTime - start) / 1e6,
      success: true
    };

    console.log(`[${APP_TYPE}] Benchmark: connect=${measurement.connectLatencyMs.toFixed(2)}ms, ping=${measurement.pingLatencyMs.toFixed(2)}ms, longQuery=${measurement.longQueryLatencyMs.toFixed(2)}ms (${measurement.longQueryRows} rows), 10x roundtrip=${measurement.multiRoundTripLatencyMs.toFixed(2)}ms (avg ${measurement.avgRoundTripMs.toFixed(2)}ms), total=${measurement.totalLatencyMs.toFixed(2)}ms`);

    return measurement;
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

  const formatLatency = (name, data) => {
    if (!data) return '';
    return `--- ${name} ---\n` +
      `  Min: ${data.min} ms\n` +
      `  Max: ${data.max} ms\n` +
      `  Avg: ${data.avg} ms\n` +
      `  P50: ${data.p50} ms\n` +
      `  P95: ${data.p95} ms\n` +
      `  P99: ${data.p99} ms\n\n`;
  };

  if (stats.latency) {
    text += formatLatency('Connect Latency', stats.latency.connect);
    text += formatLatency('Ping (SELECT 1)', stats.latency.ping);
    text += formatLatency('Long Query (1000 rows)', stats.latency.longQuery);
    text += formatLatency('Avg Round Trip (10x queries)', stats.latency.avgRoundTrip);
    text += formatLatency('Total Query Time', stats.latency.query);
    text += formatLatency('Total (Connect + All Queries)', stats.latency.total);
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

// Test outbound connectivity
app.get('/test-outbound', async (req, res) => {
  const net = require('net');
  const https = require('https');
  const http = require('http');
  const dns = require('dns').promises;

  const results = {
    timestamp: new Date().toISOString(),
    tests: []
  };

  const TIMEOUT = 3000; // 3 second timeout

  // Helper for TCP tests
  const testTcp = (host, port) => new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port, timeout: TIMEOUT });
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', (e) => { socket.destroy(); reject(e); });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
  });

  // Test 1: HTTPS (TCP 443)
  try {
    const start = Date.now();
    await new Promise((resolve, reject) => {
      const req = https.get('https://api.ipify.org?format=json', { timeout: TIMEOUT }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
    results.tests.push({ test: 'HTTPS (TCP 443)', target: 'api.ipify.org', status: 'OK', latencyMs: Date.now() - start });
  } catch (e) {
    results.tests.push({ test: 'HTTPS (TCP 443)', target: 'api.ipify.org', status: 'FAILED', error: e.message });
  }

  // Test 2: DNS resolution (UDP 53)
  try {
    const start = Date.now();
    const addresses = await dns.resolve4('google.com');
    results.tests.push({ test: 'DNS (UDP 53)', target: 'google.com', status: 'OK', result: addresses, latencyMs: Date.now() - start });
  } catch (e) {
    results.tests.push({ test: 'DNS (UDP 53)', target: 'google.com', status: 'FAILED', error: e.message });
  }

  // Test 3: HTTP (TCP 80)
  try {
    const start = Date.now();
    await new Promise((resolve, reject) => {
      const req = http.get('http://httpbin.org/ip', { timeout: TIMEOUT }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
    results.tests.push({ test: 'HTTP (TCP 80)', target: 'httpbin.org', status: 'OK', latencyMs: Date.now() - start });
  } catch (e) {
    results.tests.push({ test: 'HTTP (TCP 80)', target: 'httpbin.org', status: 'FAILED', error: e.message });
  }

  // Test 4: SSH port (TCP 22) - to github.com
  try {
    const start = Date.now();
    await testTcp('github.com', 22);
    results.tests.push({ test: 'TCP 22 (SSH)', target: 'github.com:22', status: 'OK', latencyMs: Date.now() - start });
  } catch (e) {
    results.tests.push({ test: 'TCP 22 (SSH)', target: 'github.com:22', status: 'FAILED', error: e.message });
  }

  // Test 5: PostgreSQL port (TCP 5432) - to our own DB
  try {
    const start = Date.now();
    await testTcp('vpc-benchmark-db-do-user-8198484-0.k.db.ondigitalocean.com', 25060);
    results.tests.push({ test: 'TCP 25060 (DO Postgres)', target: 'vpc-benchmark-db', status: 'OK', latencyMs: Date.now() - start });
  } catch (e) {
    results.tests.push({ test: 'TCP 25060 (DO Postgres)', target: 'vpc-benchmark-db', status: 'FAILED', error: e.message });
  }

  // Test 6: SMTP port (TCP 587) - to gmail
  try {
    const start = Date.now();
    await testTcp('smtp.gmail.com', 587);
    results.tests.push({ test: 'TCP 587 (SMTP)', target: 'smtp.gmail.com:587', status: 'OK', latencyMs: Date.now() - start });
  } catch (e) {
    results.tests.push({ test: 'TCP 587 (SMTP)', target: 'smtp.gmail.com:587', status: 'FAILED', error: e.message });
  }

  // Test 7: Custom DNS server (UDP 53)
  try {
    const start = Date.now();
    const resolver = new dns.Resolver();
    resolver.setServers(['8.8.8.8']);
    await resolver.resolve4('example.com');
    results.tests.push({ test: 'UDP 53 to 8.8.8.8', target: 'Google DNS', status: 'OK', latencyMs: Date.now() - start });
  } catch (e) {
    results.tests.push({ test: 'UDP 53 to 8.8.8.8', target: 'Google DNS', status: 'FAILED', error: e.message });
  }

  // Test 8: High port (TCP 8443) - common alternate HTTPS
  try {
    const start = Date.now();
    await testTcp('www.cloudflare.com', 8443);
    results.tests.push({ test: 'TCP 8443', target: 'cloudflare.com:8443', status: 'OK', latencyMs: Date.now() - start });
  } catch (e) {
    results.tests.push({ test: 'TCP 8443', target: 'cloudflare.com:8443', status: 'FAILED', error: e.message });
  }

  // Test 9: FTP port (TCP 21)
  try {
    const start = Date.now();
    await testTcp('ftp.debian.org', 21);
    results.tests.push({ test: 'TCP 21 (FTP)', target: 'ftp.debian.org:21', status: 'OK', latencyMs: Date.now() - start });
  } catch (e) {
    results.tests.push({ test: 'TCP 21 (FTP)', target: 'ftp.debian.org:21', status: 'FAILED', error: e.message });
  }

  // Summary
  const passed = results.tests.filter(t => t.status === 'OK').length;
  const failed = results.tests.filter(t => t.status === 'FAILED').length;
  results.summary = { passed, failed, total: results.tests.length };

  res.json(results);
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
