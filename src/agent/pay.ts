// Pays an invoice from the vault through the agent's Circle wallet.
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, type Address, type Hex } from "viem";
import { publicClient, requireEnv } from "../arc.ts";
import { circleClient, execute } from "../circle.ts";
import { vaultAbi } from "../rules.ts";

export type Payment =
  | { status: "paid"; txHash: Hex; circleTxId: string }
  | { status: "refused"; reason: string; reasonArgs: unknown }
  | { status: "failed"; circleTxId: string; circleState: string; error: string };

/**
 * Check the payment against the contract first; only send it if the contract would
 * accept it. `payee` is the address the invoice asked for, so the contract refuses
 * it (PayeeMismatch) rather than quietly paying someone else.
 */
export async function payInvoice({
  vault,
  ruleId,
  invoiceId,
  payee,
  amount,
}: {
  vault: Address;
  ruleId: number;
  invoiceId: Hex;
  payee: Address;
  amount: bigint;
}): Promise<Payment> {
  const args = [BigInt(ruleId), invoiceId, payee, amount] as const;
  try {
    await publicClient.simulateContract({
      account: requireEnv("CIRCLE_AGENT_ADDRESS") as Address,
      address: vault,
      abi: vaultAbi,
      functionName: "pay",
      args,
    });
  } catch (err) {
    const revert = err instanceof BaseError ? err.walk((e) => e instanceof ContractFunctionRevertedError) : null;
    if (revert instanceof ContractFunctionRevertedError) {
      return { status: "refused", reason: revert.data?.errorName ?? "unknown", reasonArgs: revert.data?.args };
    }
    throw err;
  }
  const result = await execute(circleClient(), {
    walletId: requireEnv("CIRCLE_AGENT_WALLET_ID"),
    contract: vault,
    callData: encodeFunctionData({ abi: vaultAbi, functionName: "pay", args }),
  });
  if (result.state === "COMPLETE" && result.txHash) {
    return { status: "paid", txHash: result.txHash, circleTxId: result.id };
  }
  return {
    status: "failed",
    circleTxId: result.id,
    circleState: result.state,
    error: `${result.errorReason ?? ""} ${result.errorDetails ?? ""}`.trim(),
  };
}
