import { signedDelta } from './signedDelta.js';

export function rebuildSeededState(agent, seedTxns, now = new Date()) {
  const newestSeedAt = seedTxns.at(-1)?.timestamp;
  const shiftMs = newestSeedAt ? now.getTime() - 30 * 60_000 - new Date(newestSeedAt).getTime() : 0;
  let cash = agent.cashOpeningBalance;
  const emoney = new Map(agent.providers.map((provider) => [provider.provider, provider.openingBalance]));

  const transactions = seedTxns.map((txn) => {
    const delta = signedDelta(txn);
    cash += delta.cash;
    emoney.set(txn.provider, (emoney.get(txn.provider) || 0) + delta.emoney);
    return {
      timestamp: new Date(new Date(txn.timestamp).getTime() + shiftMs),
      balanceAfter: { cash, emoney: emoney.get(txn.provider) },
    };
  });

  return {
    cashBalance: Math.max(0, cash),
    providerBalances: Object.fromEntries([...emoney].map(([provider, balance]) => [provider, Math.max(0, balance)])),
    transactions,
  };
}
