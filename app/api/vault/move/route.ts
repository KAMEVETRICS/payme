// Move money between the owner's wallet and their vault, step 1: check the amount and
// ask the owner's Circle wallet to send the transaction. Adding funds is a USDC transfer
// (or EURC) from the wallet to the vault; withdrawing calls the vault's withdraw, which only the
// owner's wallet may do. The owner confirms in Circle's window and pays the small gas fee.
import { randomUUID } from "node:crypto";
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits } from "viem";
import { TOKENS, artifact, publicClient, type TokenSymbol } from "../../../../src/arc.ts";
import { readVaultState } from "../../../../src/agent/vault.ts";
import { userWallets } from "../../../../src/web/circle-user.ts";
import { HttpError, limit, requireBusiness, route } from "../../../../src/web/http.ts";

const vaultAbi = artifact("PayerVault").abi;

export const POST = route(async (req) => {
  const { userToken, direction, amount, token } = (await req.json()) as { userToken?: string; direction?: string; amount?: string; token?: string };
  const { session, business } = await requireBusiness(userToken);
  limit(`move:${session.uid}`, 20, 60 * 60 * 1000, "transfers");
  if (direction !== "in" && direction !== "out") throw new HttpError(400, "Choose to add or withdraw.");
  if (!amount || !/^\d+(\.\d{1,6})?$/.test(amount.trim()) || Number(amount) <= 0) {
    throw new HttpError(400, "Enter an amount in USDC, such as 250.");
  }
  const symbol = (token ?? "USDC") as TokenSymbol;
  if (!TOKENS[symbol]) throw new HttpError(400, "Choose USDC or EURC.");
  const tokenAddress = TOKENS[symbol].address;
  const value = parseUnits(amount.trim(), 6);

  let contractAddress: `0x${string}`;
  let callData: `0x${string}`;
  if (direction === "in") {
    const held = await publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [business.ownerAddress] });
    if (value > held) throw new HttpError(400, `Your wallet holds ${formatUnits(held, 6)} ${symbol}. Add ${symbol} to your wallet first.`);
    contractAddress = tokenAddress;
    callData = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [business.vault, value] });
  } else {
    const vault = await readVaultState(business.vault);
    const held = vault.funds[symbol].balance;
    if (value > held) throw new HttpError(400, `Your vault holds ${formatUnits(held, 6)} ${symbol}.`);
    contractAddress = business.vault;
    callData = encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args: [tokenAddress, business.ownerAddress, value] });
  }

  const { data } = await userWallets().createUserTransactionContractExecutionChallenge({
    userToken: userToken!,
    walletId: business.ownerWalletId,
    contractAddress,
    callData,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    idempotencyKey: randomUUID(),
  });
  if (!data?.challengeId) throw new Error("Circle did not create the request.");
  return { challengeId: data.challengeId };
});
