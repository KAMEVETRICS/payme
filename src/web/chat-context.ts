import { formatUnits } from "viem";
import type { VaultState } from "../agent/vault.ts";
import type { Receipt } from "../agent/process.ts";
import { receiptIdOf } from "./activity.ts";
import { itemState, type Resolution } from "./resolutions.ts";
import { paymentProblem } from "./words.ts";

export function invoiceContext(receipts: Receipt[], answers: Map<string, Resolution[]>) {
  return receipts.slice(-20).reverse().map((r) => {
    const state = itemState(r, answers.get(receiptIdOf(r)));
    const failed = state.state === "open" ? state.checks : r.checks;
    return {
      supplier: r.invoice.supplierName, invoice: r.invoice.invoiceNumber, amount: r.invoice.total, currency: r.invoice.currency,
      originalReason: r.decision.reason,
      currentReason: state.state === "open" && state.escalated ? state.escalated : state.state === "unpaid" ? paymentProblem(state.payment) : state.state === "rejected" ? "Rejected by the owner." : state.state === "paid" || (state.state === "done" && r.payment?.status === "paid") ? "Payment confirmed on chain." : state.state === "done" ? "No confirmed payment is recorded." : r.decision.reason,
      failedChecks: state.state === "paid" || state.state === "done" ? [] : failed.filter((c) => !c.ok).map((c) => c.detail),
      holdUntil: state.state === "held" ? state.until : null,
    };
  });
}
export function liveVaultContext(vault: VaultState | null) {
  return {
    liveBalancesAvailable: !!vault,
    chainTime: vault ? new Date(Number(vault.chainTime) * 1000).toISOString() : null,
    expiresAt: vault ? new Date(Number(vault.expiresAt) * 1000).toISOString() : null,
    isLive: vault ? vault.chainTime < vault.expiresAt : null,
    funds: vault ? { USDC: { balance: formatUnits(vault.funds.USDC.balance, 6), capRemaining: formatUnits(vault.funds.USDC.capRemaining, 6) }, EURC: { balance: formatUnits(vault.funds.EURC.balance, 6), capRemaining: formatUnits(vault.funds.EURC.capRemaining, 6) } } : null,
  };
}
