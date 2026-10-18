// The scheduler: pays what is waiting once it can be paid.
//   - A held invoice whose hold has ended is checked again against the vault as it is
//     now. If it passes, it is paid under its supplier's rule; if something blocking has
//     changed (a stopped rule, a low balance), it goes to the owner instead.
//   - An approved or decided payment that has not gone out (a new address still in its
//     delay, a send that failed) is tried again.
// The contract pays each invoice once, so running this twice cannot pay twice. Outcomes
// are appended to the follow-up log; a retry that fails the same way as before is not
// logged again.
import type { Address } from "viem";
import { WAIT_CHECKS, holdEndsAt, parseAmount, payableFromMs } from "../agent/checks.ts";
import { payInvoice, type Payment } from "../agent/pay.ts";
import { checkInvoice } from "../agent/process.ts";
import { readVaultState } from "../agent/vault.ts";
import type { Workspace } from "../agent/workspace.ts";
import { decisionsFor, receiptIdOf } from "./activity.ts";
import { SCHEDULER, addResolution, itemState, resolutionsFor } from "./resolutions.ts";

export type Outcome = { business: string; invoice: string; outcome: string };

const sameFailure = (a: Payment, b: Payment) =>
  a.status !== "paid" && b.status === a.status && (a.status === "refused" ? a.reason === (b as typeof a).reason : true);

const describe = (p: Payment) =>
  p.status === "paid" ? `paid ${p.txHash}` : p.status === "refused" ? `refused: ${p.reason}` : `not sent: ${p.error}`;

/**
 * Try a payment. A thrown error means the check against the contract or the request to
 * Circle did not complete (usually the network), so nothing was sent: return null and try
 * again next run, without recording an attempt. Refusals and Circle failures are real
 * outcomes and come back as a Payment.
 */
async function tryPay(args: Parameters<typeof payInvoice>[0]): Promise<Payment | null> {
  try {
    return await payInvoice(args);
  } catch (err) {
    console.error("Payment attempt did not complete; trying again next run:", err instanceof Error ? err.message.split("\n")[0] : err);
    return null;
  }
}

export async function runDueWork(workspaces: Workspace[]): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const workspace of workspaces) {
    const history = resolutionsFor(workspace.vault);
    const log = (receiptId: string, outcome: string) => outcomes.push({ business: workspace.business, invoice: receiptId, outcome });

    for (const receipt of decisionsFor(workspace.vault)) {
      const receiptId = receiptIdOf(receipt);
      const state = itemState(receipt, history.get(receiptId));
      const base = { receiptId, vault: workspace.vault as Address, by: SCHEDULER };
      const amount = receipt.invoice.total;
      const label = `${receipt.invoice.supplierName} ${receipt.invoice.invoiceNumber}`;

      if (state.state === "held") {
        const vault = await readVaultState(workspace.vault);
        // Not before the hold ends, and never early: not before the invoice is due either.
        const payFrom = Math.max(holdEndsAt(state.until), payableFromMs(receipt.invoice.dueDate));
        if (Number(vault.chainTime) * 1000 < payFrom) continue;

        const fresh = await checkInvoice(receipt.invoice, workspace, vault);
        const blocking = fresh.checks.filter((c) => !c.ok && !WAIT_CHECKS.has(c.id));
        if (blocking.length) {
          addResolution({ ...base, kind: "escalated", at: new Date().toISOString(), reason: blocking[0].detail, checks: fresh.checks });
          log(label, `needs the owner: ${blocking[0].detail}`);
          continue;
        }
        if (fresh.checks.some((c) => !c.ok) || !fresh.rule || fresh.amount === null || !fresh.invoiceId) continue; // still waiting

        const payment = await tryPay({
          vault: workspace.vault,
          ruleId: fresh.rule.id,
          invoiceId: fresh.invoiceId,
          payee: receipt.invoice.payToAddress as Address,
          amount: fresh.amount,
        });
        if (!payment) continue;
        addResolution({ ...base, kind: "scheduled", at: new Date().toISOString(), ruleId: fresh.rule.id, payment });
        log(label, `${amount}: ${describe(payment)}`);
      } else if (state.state === "unpaid" && receipt.invoiceId && parseAmount(amount) !== null) {
        const payment = await tryPay({
          vault: workspace.vault,
          ruleId: state.ruleId,
          invoiceId: receipt.invoiceId,
          payee: receipt.invoice.payToAddress as Address,
          amount: parseAmount(amount)!,
        });
        if (!payment || sameFailure(state.payment, payment)) continue; // nothing has changed; do not log it again
        addResolution({ ...base, kind: "scheduled", at: new Date().toISOString(), ruleId: state.ruleId, payment });
        log(label, `${amount}: ${describe(payment)}`);
      }
    }
  }
  return outcomes;
}
