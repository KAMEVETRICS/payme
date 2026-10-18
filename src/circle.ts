// Circle developer-controlled wallets: client setup and a helper that sends a
// contract call from a wallet and waits for a final state.
import { appendFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import type { Hex } from "viem";
import { requireEnv } from "./arc.ts";

export const ARC_TESTNET = "ARC-TESTNET";

export function circleClient() {
  return initiateDeveloperControlledWalletsClient({
    apiKey: requireEnv("CIRCLE_API_KEY"),
    entitySecret: requireEnv("CIRCLE_ENTITY_SECRET"),
  });
}

/** Append NAME=value to .env and to this process's environment. */
export function saveEnv(name: string, value: string) {
  const current = readFileSync(".env", "utf8");
  appendFileSync(".env", `${current.endsWith("\n") ? "" : "\n"}${name}=${value}\n`);
  process.env[name] = value;
}

const FINAL_STATES = new Set(["COMPLETE", "FAILED", "CANCELLED", "DENIED"]);

export type CircleTxResult = { id: string; state: string; txHash?: Hex; errorReason?: string; errorDetails?: string };

/** Network failures that are safe to retry (the request may never have reached Circle). */
export function isNetworkError(err: unknown) {
  const code = (err as { code?: string })?.code;
  return ["ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ECONNABORTED"].includes(code ?? "");
}

/** Retry `call` on network failures. Only for reads, or writes that carry an idempotency key. */
export async function withRetries<T>(call: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await call();
    } catch (err) {
      if (!isNetworkError(err) || i >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** i));
    }
  }
}

/**
 * Send `callData` to `contract` from a Circle wallet and wait until Circle reports a
 * final state. Network failures are retried with the same idempotency key, so a
 * retry can never create a second transaction. `gasLimit` sets a fixed gas limit
 * instead of a fee level; Circle still simulates the call before broadcasting.
 */
export async function execute(
  client: ReturnType<typeof circleClient>,
  { walletId, contract, callData, gasLimit }: { walletId: string; contract: string; callData: Hex; gasLimit?: bigint },
): Promise<CircleTxResult> {
  const fee = gasLimit
    ? ({ type: "absolute", config: { gasLimit: gasLimit.toString(), maxFee: "100", priorityFee: "5" } } as const)
    : ({ type: "level", config: { feeLevel: "MEDIUM" } } as const);
  const idempotencyKey = randomUUID();
  const created = await withRetries(() =>
    client.createContractExecutionTransaction({ walletId, contractAddress: contract, callData, fee, idempotencyKey }),
  );
  const id = created.data?.id;
  if (!id) throw new Error(`Circle did not return a transaction id: ${JSON.stringify(created.data)}`);

  const deadline = Date.now() + 120_000;
  for (;;) {
    const { data } = await withRetries(() => client.getTransaction({ id }));
    const tx = data?.transaction;
    if (tx && FINAL_STATES.has(tx.state)) {
      return {
        id,
        state: tx.state,
        txHash: tx.txHash as Hex | undefined,
        errorReason: tx.errorReason,
        errorDetails: tx.errorDetails,
      };
    }
    if (Date.now() > deadline) throw new Error(`Circle transaction ${id} still ${tx?.state} after 2 minutes`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
