// Approve an invoice, step 2: the owner signed. Check it is their signature over exactly
// this one-off rule, have the agent add the rule, then pay the invoice under it.
import type { Address, Hex } from "viem";
import { requireEnv } from "../../../../src/arc.ts";
import { circleClient } from "../../../../src/circle.ts";
import { parseAmount } from "../../../../src/agent/checks.ts";
import { payInvoice, type Payment } from "../../../../src/agent/pay.ts";
import { addRuleWithCircle, verifyRuleSignature } from "../../../../src/rules.ts";
import { findDecision } from "../../../../src/web/activity.ts";
import { waitForSignature } from "../../../../src/web/circle-user.ts";
import { HttpError, requireBusiness, route } from "../../../../src/web/http.ts";
import { dropPending, takePending } from "../../../../src/web/pending.ts";
import { addResolution, itemState, resolutionsFor } from "../../../../src/web/resolutions.ts";
import { requireOpenInvoice, withInvoiceAction } from "../../../../src/web/invoice-actions.ts";

export const POST = route(async (req) => {
  const { userToken, pendingId, signature } = (await req.json()) as { userToken?: string; pendingId?: string; signature?: string };
  const { session, business } = await requireBusiness(userToken);
  const pending = pendingId ? takePending(pendingId, session.uid) : null;
  if (!pending || pending.purpose.kind !== "invoice") throw new HttpError(404, "That approval has expired. Please approve again.");
  const receipt = findDecision(business.vault, pending.purpose.receiptId);
  if (!receipt?.invoiceId) throw new HttpError(404, "That invoice is no longer on file.");
  const invoiceId = receipt.invoiceId;
  const receiptId = pending.purpose.receiptId;
  requireOpenInvoice(itemState(receipt, resolutionsFor(business.vault).get(receiptId)).state);

  const signed = signature ?? (await waitForSignature(userToken!, pending.challengeId));
  if (!/^0x[0-9a-fA-F]+$/.test(signed)) throw new HttpError(400, "The signature is not valid.");
  await verifyRuleSignature(business.vault, pending.terms, signed as Hex, business.ownerAddress).catch((err) => {
    throw new HttpError(400, `That signature does not approve this payment: ${err.message}`);
  });
  return withInvoiceAction(business.vault, receiptId, async () => {
  // Signing can take time. Re-read under the same claim used by rejection before any chain call.
  requireOpenInvoice(itemState(receipt, resolutionsFor(business.vault).get(receiptId)).state);
  const { ruleId } = await addRuleWithCircle(circleClient(), {
    agentWalletId: requireEnv("CIRCLE_AGENT_WALLET_ID"),
    vault: business.vault,
    terms: pending.terms,
    signature: signed as Hex,
  });
  dropPending(pending.id);

  // The rule is on chain now; record the approval even if this first payment attempt fails,
  // so the owner can retry without signing again.
  let payment: Payment;
  try {
    payment = await payInvoice({
      vault: business.vault,
      ruleId: Number(ruleId),
      invoiceId,
      payee: receipt.invoice.payToAddress as Address,
      amount: parseAmount(receipt.invoice.total)!,
    });
  } catch (err) {
    payment = { status: "failed", circleTxId: "", circleState: "ERROR", error: err instanceof Error ? err.message : String(err) };
  }
  addResolution({
    kind: "approved",
    receiptId,
    vault: business.vault,
    at: new Date().toISOString(),
    by: session.email,
    ruleId: Number(ruleId),
    payment,
  });
  return { payment };
  });
});
