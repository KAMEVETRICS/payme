// Move a business from its v2 vault (USDC only) to a v3 vault (USDC and EURC). Payme's
// agent creates the new vault, owned by the same wallet, with the old vault's cap. Rules
// do not carry over: the owner signs each supplier again. If the old vault still holds
// USDC, the owner withdraws it to their wallet (returned as a Circle challenge) and can
// then add it to the new vault.
import { randomUUID } from "node:crypto";
import { encodeFunctionData, erc20Abi, formatUnits, parseAbi } from "viem";
import { USDC, publicClient } from "../../../../src/arc.ts";
import { userWallets } from "../../../../src/web/circle-user.ts";
import { HttpError, limit, requireBusiness, route } from "../../../../src/web/http.ts";
import { createVaultFor } from "../../../../src/web/platform.ts";
import { CURRENT_VAULT_VERSION, needsNewVault, saveBusiness } from "../../../../src/web/store.ts";

const v2Abi = parseAbi(["function cap() view returns (uint256)", "function withdraw(address to, uint256 amount)"]);

export const POST = route(async (req) => {
  const { userToken } = (await req.json()) as { userToken?: string };
  const { session, business } = await requireBusiness(userToken);
  limit(`upgrade:${session.uid}`, 3, 60 * 60 * 1000, "vault moves");
  if (!needsNewVault(business)) throw new HttpError(409, "Your vault is already up to date.");

  const old = business.vault;
  const [cap, leftover] = await Promise.all([
    publicClient.readContract({ address: old, abi: v2Abi, functionName: "cap" }),
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [old] }),
  ]);
  const { vault, tx } = await createVaultFor(business.ownerAddress, formatUnits(cap, 6));

  business.previousVaults = [...(business.previousVaults ?? []), { vault: old, suppliers: business.suppliers, movedAt: new Date().toISOString() }];
  business.vault = vault;
  business.vaultTx = tx;
  business.vaultVersion = CURRENT_VAULT_VERSION;
  business.suppliers = [];
  saveBusiness(business);

  if (leftover === 0n) return { vault };
  const { data } = await userWallets().createUserTransactionContractExecutionChallenge({
    userToken: userToken!,
    walletId: business.ownerWalletId,
    contractAddress: old,
    callData: encodeFunctionData({ abi: v2Abi, functionName: "withdraw", args: [business.ownerAddress, leftover] }),
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    idempotencyKey: randomUUID(),
  });
  return { vault, withdrawChallengeId: data?.challengeId ?? null, leftover: formatUnits(leftover, 6) };
});
