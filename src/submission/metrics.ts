import { formatUnits } from "viem";
import { createHash } from "node:crypto";

export type MetricReceipt = { id?: string; at?: string; file?: string; vault: string; invoiceId: string | null; dryRun: boolean; source?: { kind: string }; payment?: { status: string; txHash?: string } | null };
export type MetricResolution = { receiptId: string; vault: string; payment?: { status: string; txHash?: string } };
export type ConfirmedPayment = { vault: string; invoiceId: string; txHash: string; token: string; amount: string };
const tokens = { USDC: "0x3600000000000000000000000000000000000000", EURC: "0x89b50855aa3be2f677cd6303cec089b5f319d72a" };
const key = (vault: string, id: string) => `${vault.toLowerCase()}:${id.toLowerCase()}`;

/** Redacted aggregate development activity, never a claim of customer adoption. */
export function summarizeDevelopment(receipts: MetricReceipt[], resolutions: MetricResolution[], confirmed: ConfirmedPayment[]) {
  const live = receipts.filter((receipt) => !receipt.dryRun);
  const claims = live.flatMap((receipt) => {
    // Same identity as activity.receiptIdOf, including decisions written before IDs existed.
    const id = receipt.id ?? (receipt.at && receipt.file ? createHash("sha256").update(`${receipt.at}|${receipt.file}`).digest("hex").slice(0, 32) : undefined);
    const payments = [receipt.payment, ...resolutions.filter((resolution) => id && resolution.receiptId === id && resolution.vault.toLowerCase() === receipt.vault.toLowerCase()).map((resolution) => resolution.payment)];
    return payments.filter((payment) => payment?.status === "paid" && payment.txHash).map((payment) => ({ vault: receipt.vault, invoiceId: receipt.invoiceId?.toLowerCase(), txHash: payment!.txHash!.toLowerCase() }));
  });
  const events = confirmed.filter((event) => claims.some((claim) => claim.vault.toLowerCase() === event.vault.toLowerCase() && claim.invoiceId === event.invoiceId.toLowerCase() && claim.txHash === event.txHash.toLowerCase()));
  const seen = new Set<string>();
  const transactions = new Set<string>();
  const totals = { USDC: 0n, EURC: 0n };
  for (const event of events) {
    const token = (Object.keys(tokens) as (keyof typeof tokens)[]).find((symbol) => tokens[symbol] === event.token.toLowerCase());
    if (!token || !/^\d+$/.test(event.amount) || BigInt(event.amount) <= 0n) continue;
    const eventKey = `${event.txHash.toLowerCase()}:${key(event.vault, event.invoiceId)}`;
    if (seen.has(eventKey)) continue;
    seen.add(eventKey); transactions.add(event.txHash.toLowerCase()); totals[token] += BigInt(event.amount);
  }
  return {
    network: "Arc testnet", decisionRecords: live.length,
    emailDecisionRecords: live.filter((receipt) => receipt.source?.kind === "email").length,
    recordedVaults: new Set(live.map((receipt) => receipt.vault.toLowerCase())).size,
    confirmedPaymentTransactions: transactions.size, confirmedInvoices: seen.size,
    testnetPaymentVolume: { USDC: formatUnits(totals.USDC, 6), EURC: formatUnits(totals.EURC, 6) },
    unverifiedClaimedTransactions: new Set(claims.map((claim) => claim.txHash).filter((hash) => !transactions.has(hash))).size,
  };
}
