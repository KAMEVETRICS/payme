// Step 1 of adding a supplier: build the rule and ask the owner's Circle wallet to
// sign it. Returns the challenge the browser shows the owner.
import { randomUUID } from "node:crypto";
import { getAddress, isAddress, keccak256, parseUnits, toBytes, toHex } from "viem";
import { TOKENS, publicClient, type TokenSymbol } from "../../../../src/arc.ts";
import { ruleTypedDataJson, type RuleTerms } from "../../../../src/rules.ts";
import { userWallets } from "../../../../src/web/circle-user.ts";
import { HttpError, limit, requireBusiness, route } from "../../../../src/web/http.ts";
import { savePending } from "../../../../src/web/pending.ts";

const PERIODS: Record<string, { seconds: bigint; words: string }> = {
  week: { seconds: 7n * 86400n, words: "a week" },
  month: { seconds: 30n * 86400n, words: "a month" },
  once: { seconds: 0n, words: "in total" },
};

export const POST = route(async (req) => {
  const body = (await req.json()) as {
    userToken?: string;
    name?: string;
    address?: string;
    budgetUsdc?: string; // in the chosen token
    token?: string;
    period?: string;
    terms?: string;
  };
  const { session, business } = await requireBusiness(body.userToken);
  limit(`sign:${session.uid}`, 30, 60 * 60 * 1000, "approval requests");
  const name = body.name?.trim();
  if (!name) throw new HttpError(400, "Enter the supplier's name.");
  if (!body.address || !isAddress(body.address)) throw new HttpError(400, "Enter the supplier's wallet address (0x...).");
  if (!body.budgetUsdc || !/^\d+(\.\d{1,6})?$/.test(body.budgetUsdc) || Number(body.budgetUsdc) <= 0) {
    throw new HttpError(400, "Enter a budget, such as 2000.");
  }
  const symbol = (body.token ?? "USDC") as TokenSymbol;
  if (!TOKENS[symbol]) throw new HttpError(400, "Choose USDC or EURC.");
  const period = PERIODS[body.period ?? ""];
  if (!period) throw new HttpError(400, "Choose how often the budget resets.");
  const termsText = body.terms?.trim() || `${name}: up to ${body.budgetUsdc} ${symbol} ${period.words}.`;

  const { timestamp } = await publicClient.getBlock();
  const terms: RuleTerms = {
    payee: getAddress(body.address),
    token: TOKENS[symbol].address,
    budget: parseUnits(body.budgetUsdc, 6),
    period: period.seconds,
    startsAt: timestamp,
    expiresAt: timestamp + 365n * 86400n,
    ref: keccak256(toBytes(termsText)),
    salt: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };
  const { data } = await userWallets().signTypedData({
    userToken: body.userToken!,
    walletId: business.ownerWalletId,
    data: ruleTypedDataJson(business.vault, terms),
    memo: `Let Payme pay ${name} up to ${body.budgetUsdc} ${symbol} ${period.words}`,
  });
  if (!data?.challengeId) throw new Error("Circle did not create the signing request.");

  const id = randomUUID();
  savePending({
    id,
    ownerId: session.uid,
    purpose: { kind: "supplier", name, terms: termsText },
    terms,
    challengeId: data.challengeId,
    createdAt: new Date().toISOString(),
  });
  return { pendingId: id, challengeId: data.challengeId };
});
