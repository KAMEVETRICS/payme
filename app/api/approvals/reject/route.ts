// Reject an invoice waiting for the owner. Nothing is paid; the answer is recorded.
import { findDecision, receiptIdOf } from "../../../../src/web/activity.ts";
import { HttpError, requireBusiness, route } from "../../../../src/web/http.ts";
import { addResolution, itemState, resolutionsFor } from "../../../../src/web/resolutions.ts";
import { requireOpenInvoice, withInvoiceAction } from "../../../../src/web/invoice-actions.ts";

export const POST = route(async (req) => {
  const { receiptId } = (await req.json()) as { receiptId?: string };
  const { session, business } = await requireBusiness();
  const receipt = receiptId ? findDecision(business.vault, receiptId) : undefined;
  if (!receipt) throw new HttpError(404, "That item is not on file.");
  const id = receiptIdOf(receipt);
  return withInvoiceAction(business.vault, id, async () => {
  requireOpenInvoice(itemState(receipt, resolutionsFor(business.vault).get(id)).state);
  addResolution({ kind: "rejected", receiptId: id, vault: business.vault, at: new Date().toISOString(), by: session.email });
  return { ok: true };
  });
});
