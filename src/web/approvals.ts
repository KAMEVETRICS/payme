// What approving an "ask" means, and when it is allowed. Approving signs a one-off
// rule for exactly this invoice (its amount, to the address it asks for), after which
// the agent pays it. The contract still applies the cap, the balance, the new-address
// delay, and pays each invoice once.
import { isAddress } from "viem";
import { tokenForCurrency } from "../arc.ts";
import { parseAmount, type Check } from "../agent/checks.ts";
import type { Receipt } from "../agent/process.ts";

export type Approval = { canApprove: boolean; blockers: string[]; warnings: string[] };

/** `checks` defaults to the decision's; an escalated hold passes the checks it failed when due. */
export function approvalFor(r: Receipt, checks: Check[] = r.checks): Approval {
  const failed = new Set(checks.filter((c) => !c.ok).map((c) => c.id));
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (failed.has("notPaid")) blockers.push("This invoice has already been paid.");
  // Approving signs a one-off rule in the invoice's own token (EUR -> EURC), so only a
  // currency no token settles blocks it.
  const token = tokenForCurrency(r.invoice.currency);
  if (!token) blockers.push(`It is billed in ${r.invoice.currency}, which Payme cannot pay (it pays USD in USDC and EUR in EURC).`);
  else if (failed.has("currency")) warnings.push(`It is billed in ${r.invoice.currency}; approving pays it in ${token} from your vault.`);
  if (parseAmount(r.invoice.total) === null) blockers.push(`Payme could not read the amount "${r.invoice.total}".`);
  if (!r.invoice.payToAddress || !isAddress(r.invoice.payToAddress)) blockers.push("The invoice gives no wallet address to pay.");

  if (!r.supplier) {
    // Unknown supplier: there is no approved address to compare with.
    warnings.push(
      "Payme has never paid this supplier. Approving pays this one invoice, after the 24-hour wait for new addresses; add them as a supplier for regular payments.",
    );
  } else if (failed.has("address") || failed.has("paymentDetails")) {
    warnings.push(
      `This pays ${r.invoice.payToAddress}, not the address you approved for ${r.supplier}. ` +
        "Invoices that change payment details are the most common fraud: call the supplier on a number you already have before approving.",
    );
  }
  if (failed.has("noInstructions")) {
    warnings.push("The invoice contains text trying to make Payme skip its checks. Only approve if you know it is genuine.");
  }
  if (failed.has("concerns")) warnings.push(`Payme flagged a concern: ${r.invoice.otherConcerns ?? "Review the invoice details before approving."}`);
  if (failed.has("budget")) warnings.push("This goes over the supplier's budget; approving pays this one invoice on top of it.");

  return { canApprove: blockers.length === 0, blockers, warnings };
}
