// Approve an invoice the agent asked about, step 1: check it can still be paid, build
// a one-off rule for exactly this invoice, and ask the owner's Circle wallet to sign it.
import { randomUUID } from "node:crypto";
import { formatUnits, getAddress, keccak256, toBytes, toHex } from "viem";
import { TOKENS, tokenForCurrency } from "../../../../src/arc.ts";
import { parseAmount } from "../../../../src/agent/checks.ts";
import { isInvoicePaid, readVaultState } from "../../../../src/agent/vault.ts";
import { ruleTypedDataJson, type RuleTerms } from "../../../../src/rules.ts";
import { findDecision, receiptIdOf } from "../../../../src/web/activity.ts";
import { approvalFor } from "../../../../src/web/approvals.ts";
import { userWallets } from "../../../../src/web/circle-user.ts";
import { HttpError, limit, requireBusiness, route } from "../../../../src/web/http.ts";
import { savePending } from "../../../../src/web/pending.ts";
import { itemState, resolutionsFor } from "../../../../src/web/resolutions.ts";

const ONE_OFF_LIFETIME = 14n * 86400n;

export const POST = route(async (req) => {
  const { userToken, receiptId } = (await req.json()) as { userToken?: string; receiptId?: string };
  const { session, business } = await requireBusiness(userToken);
  limit(`sign:${session.uid}`, 30, 60 * 60 * 1000, "approval requests");
  const receipt = receiptId ? findDecision(business.vault, receiptId) : undefined;
  if (!receipt) throw new HttpError(404, "That item is not on file.");
  const state = itemState(receipt, resolutionsFor(business.vault).get(receiptIdOf(receipt)));
  if (state.state !== "open") throw new HttpError(409, "This one is not waiting for your answer.");
  const { canApprove, blockers } = approvalFor(receipt, state.checks);
  if (!canApprove) throw new HttpError(400, blockers[0]);

  const { invoice } = receipt;
  const amount = parseAmount(invoice.total)!;
  const payee = getAddress(invoice.payToAddress!);
  if (!receipt.invoiceId) throw new HttpError(400, "This invoice has no id to pay against.");

  // Check the parts that change over time now, before asking the owner to sign.
  const vault = await readVaultState(business.vault);
  if (await isInvoicePaid(business.vault, receipt.invoiceId)) throw new HttpError(409, "This invoice has already been paid.");
  if (vault.chainTime >= vault.expiresAt) throw new HttpError(400, "Your vault has expired.");
  const symbol = tokenForCurrency(invoice.currency);
  if (!symbol) throw new HttpError(400, `Payme cannot pay invoices in ${invoice.currency}.`);
  const funds = vault.funds[symbol];
  if (amount > funds.balance) {
    throw new HttpError(400, `Your vault holds ${formatUnits(funds.balance, 6)} ${symbol}, less than the ${invoice.total} due. Add ${symbol} first.`);
  }
  if (amount > funds.capRemaining) {
    throw new HttpError(400, `Paying ${invoice.total} would go over your ${symbol} cap (${formatUnits(funds.capRemaining, 6)} left).`);
  }

  const terms: RuleTerms = {
    payee,
    token: TOKENS[symbol].address,
    budget: amount,
    period: 0n,
    startsAt: vault.chainTime,
    expiresAt: vault.chainTime + ONE_OFF_LIFETIME,
    ref: keccak256(toBytes(`invoice:${receiptIdOf(receipt)}:${invoice.invoiceNumber}`)),
    salt: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };
  const { data } = await userWallets().signTypedData({
    userToken: userToken!,
    walletId: business.ownerWalletId,
    data: ruleTypedDataJson(business.vault, terms),
    memo: `Pay ${invoice.supplierName} ${invoice.total} ${invoice.currency} once, for invoice ${invoice.invoiceNumber}`,
  });
  if (!data?.challengeId) throw new Error("Circle did not create the signing request.");

  const id = randomUUID();
  savePending({
    id,
    ownerId: session.uid,
    purpose: { kind: "invoice", receiptId: receiptIdOf(receipt) },
    terms,
    challengeId: data.challengeId,
    createdAt: new Date().toISOString(),
  });
  return { pendingId: id, challengeId: data.challengeId };
});
