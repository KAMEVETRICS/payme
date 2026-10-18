// Plain-language text for the dashboard.
import type { Payment } from "../agent/pay.ts";

const REFUSALS: Record<string, string> = {
  PayeeNotYetActive: "the address is new, so it waits out the 24-hour delay before the first payment",
  PayeeMismatch: "the address does not match the approved one",
  InvoiceAlreadyPaid: "this invoice has already been paid",
  OverBudget: "it is over what is left on the rule",
  OverCap: "it would go over your vault's cap",
  InsufficientBalance: "there is not enough in your vault",
  RuleExpired: "the approval has expired",
  RuleNotActive: "the approval was stopped",
  VaultExpired: "your vault has expired",
};

/** Why a payment did not go out, in a phrase. */
export function paymentProblem(payment: Payment): string | null {
  if (payment.status === "refused") return REFUSALS[payment.reason] ?? `the vault refused it (${payment.reason})`;
  if (payment.status === "failed") return `it could not be sent (${payment.error || payment.circleState})`;
  return null;
}
