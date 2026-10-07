// Build one payment row per active person for the selected period.
export function groupPayments(detail, round) {
  const c = detail.chain;
  const receiptsByPerson = new Map();
  const duesByPerson = new Map();
  for (const receipt of detail.receipts) {
    if (receipt.turn_number !== round) continue;
    if (!receiptsByPerson.has(receipt.user_id)) receiptsByPerson.set(receipt.user_id, []);
    receiptsByPerson.get(receipt.user_id).push(receipt);
  }
  for (const due of detail.dues) {
    if (due.turn_number === round) duesByPerson.set(due.user_id, due.amount_cents);
  }
  return detail.members
    .filter((m) => m.state === 'active')
    .map((m) => {
      const entries = receiptsByPerson.get(m.user_id) || [],
        expected =
          duesByPerson.get(m.user_id) ?? m.contribution_cents ?? m.quantity * c.amount_cents,
        approved = entries.filter((r) => r.state === 'approved'),
        paid = approved.reduce((n, r) => n + (r.amount_cents ?? c.amount_cents), 0);
      return {
        ...m,
        entries,
        expected,
        paid,
        approvedCount: approved.length,
        state: approved.length === m.quantity ? 'approved' : entries.length ? 'pending' : 'missing',
      };
    });
}
