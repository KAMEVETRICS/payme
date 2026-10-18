import { formatUnits } from "viem";
import { TOKEN_SYMBOLS, tokenForCurrency, type TokenSymbol } from "../arc.ts";
import { parseAmount } from "../agent/checks.ts";
import type { Receipt } from "../agent/process.ts";
import { receiptIdOf } from "./activity.ts";
import { itemState, type Resolution } from "./resolutions.ts";

export type PaymentRow = {
  id: string; supplier: string; invoice: string; amount: string; currency: string;
  status: "paid" | "held" | "review" | "unpaid" | "rejected"; at: string; due: string | null; txHash?: string;
};
export function buildOverview(receipts: Receipt[], history: Map<string, Resolution[]>, now = new Date()) {
  const months = Array.from({ length: 6 }, (_, i) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1));
    return { month: date.toISOString().slice(0, 7), label: date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) };
  });
  const totals = { USDC: 0n, EURC: 0n };
  const buckets: Record<TokenSymbol, bigint[]> = { USDC: months.map(() => 0n), EURC: months.map(() => 0n) };
  const counts = { paid: 0, held: 0, review: 0, unpaid: 0, rejected: 0 };
  const transactions = new Set<string>();
  const payments: PaymentRow[] = receipts.filter((r) => !r.dryRun).map((r) => {
    const id = receiptIdOf(r);
    const followUps = history.get(id) ?? [];
    const state = itemState(r, followUps);
    const payment = state.state === "paid" ? state.payment : state.state === "done" && r.payment?.status === "paid" ? r.payment : null;
    const settled = state.state === "paid" ? followUps.findLast((f) => "payment" in f && f.payment.status === "paid")?.at ?? r.at : r.at;
    const status: PaymentRow["status"] = payment ? "paid" : state.state === "open" ? "review" : state.state === "done" ? "unpaid" : state.state;
    if (status !== "paid") counts[status]++;
    if (payment && !transactions.has(payment.txHash.toLowerCase())) {
      transactions.add(payment.txHash.toLowerCase());
      counts.paid++;
      const token = tokenForCurrency(r.invoice.currency);
      const amount = parseAmount(r.invoice.total);
      if (token && amount !== null) {
        totals[token] += amount;
        const index = months.findIndex((m) => m.month === settled.slice(0, 7));
        if (index >= 0) buckets[token][index] += amount;
      }
    }
    return { id, supplier: r.invoice.supplierName, invoice: r.invoice.invoiceNumber, amount: r.invoice.total, currency: r.invoice.currency,
      status, at: payment ? settled : r.at, due: r.invoice.dueDate, ...(payment ? { txHash: payment.txHash } : {}) };
  }).sort((a, b) => b.at.localeCompare(a.at));
  return {
    payments, counts,
    totals: Object.fromEntries(TOKEN_SYMBOLS.map((s) => [s, formatUnits(totals[s], 6)])) as Record<TokenSymbol, string>,
    monthly: Object.fromEntries(TOKEN_SYMBOLS.map((s) => [s, months.map((m, i) => ({ ...m, amount: formatUnits(buckets[s][i], 6) }))])) as Record<TokenSymbol, { month: string; label: string; amount: string }[]>,
  };
}
export type Overview = ReturnType<typeof buildOverview>;
