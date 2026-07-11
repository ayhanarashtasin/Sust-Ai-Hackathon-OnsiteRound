/*
  Single source of truth for MFS balance direction (agent float model).
  Used by: seed generator, sim engine, forecast — so drain direction can never drift.

    cash_out  : customer withdraws  → agent cash ↓, agent e-money ↑  (drains PHYSICAL CASH)
    cash_in   : customer deposits   → agent cash ↑, agent e-money ↓  (drains PROVIDER E-MONEY)
    send_money: agent-assisted send → economically same as cash_in
    payment   : agent-assisted pay  → economically same as cash_in
    b2b_topup : provider refills agent float → e-money ↑ only
*/
export function signedDelta(txn) {
  if (txn.status === 'failed') return { cash: 0, emoney: 0 };
  const a = txn.amount;
  switch (txn.type) {
    case 'cash_out':
      return { cash: -a, emoney: +a };
    case 'cash_in':
    case 'send_money':
    case 'payment':
      return { cash: +a, emoney: -a };
    case 'b2b_topup':
      return { cash: 0, emoney: +a };
    default:
      return { cash: 0, emoney: 0 };
  }
}
