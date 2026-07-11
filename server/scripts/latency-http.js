/*
  End-to-end HTTP latency measurement (deliverable: "API or processing latency
  at a documented volume"). Unlike validate.js (pure engine timings), this goes
  through the FULL stack: Express → JWT verify → MongoDB → analytics → JSON.

  Prereqs: server running (npm start) against a seeded MongoDB.
  Usage:   npm run latency            (BASE env var overrides http://localhost:5000)

  Measures, per endpoint: p50 / p95 / p99 over N sequential requests, then a
  concurrent burst (10 parallel × 15 rounds) to expose contention.
*/
const BASE = process.env.BASE || 'http://localhost:5000';
const N = Number(process.env.N || 150);

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'field@demo.test', password: 'demo1234' }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status}) — is the server running and seeded?`);
  return (await res.json()).token;
}

async function timeOne(url, token) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  await res.json();
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return performance.now() - t0;
}

function stats(times) {
  const s = [...times].sort((a, b) => a - b);
  const p = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  return { p50: p(0.5), p95: p(0.95), p99: p(0.99), mean: s.reduce((a, b) => a + b, 0) / s.length };
}

const fmt = (v) => `${v.toFixed(1)} ms`;

async function main() {
  const token = await login();
  const endpoints = [
    ['GET /api/agents', `${BASE}/api/agents`],
    ['GET /api/agents/AGT-001/forecast', `${BASE}/api/agents/AGT-001/forecast`],
    ['GET /api/alerts (open)', `${BASE}/api/alerts?status=new,acknowledged,in_progress,escalated`],
  ];

  console.log(`\n=== HTTP LATENCY @ ${BASE} — ${N} sequential requests per endpoint ===\n`);
  for (const [label, url] of endpoints) {
    await timeOne(url, token); // warm-up
    const times = [];
    for (let i = 0; i < N; i++) times.push(await timeOne(url, token));
    const s = stats(times);
    console.log(`${label.padEnd(38)} p50 ${fmt(s.p50)}  p95 ${fmt(s.p95)}  p99 ${fmt(s.p99)}  mean ${fmt(s.mean)}`);
  }

  // Concurrency: 10 clients hammering the heaviest endpoint simultaneously
  const url = `${BASE}/api/agents/AGT-001/forecast`;
  const rounds = 15, width = 10;
  const conc = [];
  for (let r = 0; r < rounds; r++) {
    const batch = await Promise.all(Array.from({ length: width }, () => timeOne(url, token)));
    conc.push(...batch);
  }
  const cs = stats(conc);
  console.log(`\nConcurrent forecast (${width} parallel × ${rounds})     p50 ${fmt(cs.p50)}  p95 ${fmt(cs.p95)}  p99 ${fmt(cs.p99)}  mean ${fmt(cs.mean)}\n`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
