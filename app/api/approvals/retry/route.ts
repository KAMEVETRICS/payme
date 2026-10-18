// Retry paying an approved invoice, for example once a new address has cleared its
// delay. The owner already signed the one-off rule, so no new signature is needed.
import type { Address } from "viem";
import { parseAmount } from "../../../../src/agent/checks.ts";
import { payInvoice, type Payment } from "../../../../src/agent/pay.ts";
import { findDecision, receiptIdOf } from "../../../../src/web/activity.ts";
import { HttpError, requireBusiness, route } from "../../../../src/web/http.ts";
import { addResolution, itemState, resolutionsFor } from "../../../../src/web/resolutions.ts";

export const POST = route(async (req) => {
  const { receiptId } = (await req.json()) as { receiptId?: string };
  const { session, business } = await requireBusiness();
  const receipt = receiptId ? findDecision(business.vault, receiptId) : undefined;
  if (!receipt?.invoiceId) throw new HttpError(404, "That invoice is not on file.");
  const id = receiptIdOf(receipt);
  const state = itemState(receipt, resolutionsFor(business.vault).get(id));
  if (state.state !== "unpaid") throw new HttpError(409, "There is no payment waiting to go out for this invoice.");

  let payment: Payment;
  try {
    payment = await payInvoice({
      vault: business.vault,
      ruleId: state.ruleId,
      invoiceId: receipt.invoiceId,
      payee: receipt.invoice.payToAddress as Address,
      amount: parseAmount(receipt.invoice.total)!,
    });
  } catch (err) {
    payment = { status: "failed", circleTxId: "", circleState: "ERROR", error: err instanceof Error ? err.message : String(err) };
  }
  addResolution({ kind: "retried", receiptId: id, vault: business.vault, at: new Date().toISOString(), by: session.email, ruleId: state.ruleId, payment });
  return { payment };
});
