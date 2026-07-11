import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateSeedData } from './lib/generateSeedData.js';

/*
  Writes the PORTABLE sample dataset (deliverable: "sample data") to data/sample/:
    agents.json        — outlets with shared cash + per-provider balances
    users.json         — staff roles (no password hashes — auth data never ships)
    transactions.csv   — baseline history, one row per synthetic transaction
    manifest.json      — seed, generation date, counts, and assumptions pointer

  Same generator + seed as `npm run seed`, so this file matches a live demo DB.
  Usage: npm run sample-data   (SEED env var overrides; default 20260711)
*/
const SEED = Number(process.env.SEED || 20260711);
// Fixed generation instant so the committed dataset is stable run-to-run;
// timestamps are relative offsets from this anchor.
const ANCHOR = new Date('2026-07-11T12:00:00.000Z');

const data = generateSeedData({ seed: SEED, now: ANCHOR });

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'data', 'sample');
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, 'agents.json'), JSON.stringify(data.agents, null, 2));
writeFileSync(join(outDir, 'users.json'), JSON.stringify(data.users, null, 2));

const csvHeader = 'txnId,agentId,provider,type,amount,status,failureReason,customerHash,timestamp,balanceAfterCash,balanceAfterEmoney,simulated';
const csvRows = data.transactions.map((t) =>
  [t.txnId, t.agentId, t.provider, t.type, t.amount, t.status, t.failureReason ?? '', t.customerHash,
    t.timestamp.toISOString(), t.balanceAfter.cash, t.balanceAfter.emoney, t.simulated].join(',')
);
writeFileSync(join(outDir, 'transactions.csv'), [csvHeader, ...csvRows].join('\n') + '\n');

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({
  seed: SEED,
  anchor: ANCHOR.toISOString(),
  generatedBy: 'server/scripts/generate-sample-data.js (shared generator with npm run seed)',
  counts: { agents: data.agents.length, users: data.users.length, transactions: data.transactions.length },
  note: 'ALL DATA SIMULATED — synthetic identifiers only. Assumptions & limitations: docs/data-simulation.md',
}, null, 2));

console.log(`[sample-data] wrote data/sample/ (seed ${SEED}: ${data.agents.length} agents, ${data.transactions.length} txns)`);
