// Step 2 of adding a supplier: the owner signed in their Circle wallet. Check the
// signature is theirs over exactly these terms, then the agent puts the rule on chain.
import type { Hex } from "viem";
import { requireEnv } from "../../../../src/arc.ts";
import { circleClient } from "../../../../src/circle.ts";
import { addRuleWithCircle, verifyRuleSignature } from "../../../../src/rules.ts";
import { payeeActiveAt } from "../../../../src/agent/vault.ts";
import { waitForSignature } from "../../../../src/web/circle-user.ts";
import { HttpError, requireBusiness, route } from "../../../../src/web/http.ts";
import { dropPending, takePending } from "../../../../src/web/pending.ts";
import { saveBusiness } from "../../../../src/web/store.ts";

export const POST = route(async (req) => {
  const { userToken, pendingId, signature } = (await req.json()) as { userToken?: string; pendingId?: string; signature?: string };
  const { session, business } = await requireBusiness(userToken);
  const pending = pendingId ? takePending(pendingId, session.uid) : null;
  if (!pending || pending.purpose.kind !== "supplier") {
    throw new HttpError(404, "That approval has expired. Please add the supplier again.");
  }
  const supplier = pending.purpose;
  // The browser passes the signature when Circle's window answered in time; otherwise
  // ask Circle for it. Either way, it is checked against the owner below.
  const signed = signature ?? (await waitForSignature(userToken!, pending.challengeId));
  if (!/^0x[0-9a-fA-F]+$/.test(signed)) throw new HttpError(400, "The signature is not valid.");

  await verifyRuleSignature(business.vault, pending.terms, signed as Hex, business.ownerAddress).catch((err) => {
    throw new HttpError(400, `That signature does not approve this rule: ${err.message}`);
  });
  const { ruleId } = await addRuleWithCircle(circleClient(), {
    agentWalletId: requireEnv("CIRCLE_AGENT_WALLET_ID"),
    vault: business.vault,
    terms: pending.terms,
    signature: signed as Hex,
  });

  business.suppliers.push({ name: supplier.name, address: pending.terms.payee, ruleId: Number(ruleId), terms: supplier.terms });
  saveBusiness(business);
  dropPending(pending.id);

  const activeAt = await payeeActiveAt(business.vault, pending.terms.payee);
  return { ruleId: Number(ruleId), payableFrom: new Date(Number(activeAt) * 1000).toISOString() };
});
