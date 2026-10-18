// The owner's side of Circle: user-controlled wallets, signed in by email code.
import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import type { Address } from "viem";
import { requireEnv } from "../arc.ts";
import { ARC_TESTNET, withRetries } from "../circle.ts";

let client: ReturnType<typeof initiateUserControlledWalletsClient> | undefined;
export function userWallets() {
  client ??= initiateUserControlledWalletsClient({ apiKey: requireEnv("CIRCLE_API_KEY") });
  return client;
}

/** The Circle user a userToken belongs to. Throws if the token is invalid or expired. */
export async function userIdFor(userToken: string): Promise<string> {
  const { data } = await withRetries(() => userWallets().getUserStatus({ userToken }));
  if (!data?.id) throw new Error("Circle did not recognise this sign-in. Please sign in again.");
  return data.id;
}

/** The owner's Arc testnet wallet, if it has been created. */
export async function ownerWallet(userToken: string): Promise<{ id: string; address: Address } | null> {
  const { data } = await withRetries(() => userWallets().listWallets({ userToken, blockchain: ARC_TESTNET }));
  const wallet = data?.wallets?.[0];
  return wallet ? { id: wallet.id, address: wallet.address as Address } : null;
}

/**
 * Wait for the owner to finish a signing request and return the signature. The browser
 * SDK gives up after 10 seconds without hearing from Circle's window, but the owner may
 * still approve it, so the server asks Circle directly.
 */
export async function waitForSignature(userToken: string, challengeId: string, timeoutMs = 120_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { data } = await withRetries(() => userWallets().getUserChallenge({ userToken, challengeId }));
    // Circle returns the signature on completed signing challenges; the SDK's types omit it.
    const challenge = data?.challenge as { status?: string; signature?: string; errorMessage?: string } | undefined;
    if (challenge?.status === "COMPLETE") {
      if (!challenge.signature) throw new Error("Circle finished the request but returned no signature.");
      return challenge.signature;
    }
    if (challenge?.status === "FAILED" || challenge?.status === "EXPIRED") {
      throw new Error(`The approval ${challenge.status === "EXPIRED" ? "expired" : "failed"}${challenge.errorMessage ? `: ${challenge.errorMessage}` : ""}.`);
    }
    if (Date.now() > deadline) throw new Error("Still waiting for your approval in the Circle window. Try again once you have approved it.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/**
 * Start creating the owner's wallet. Returns the challenge the browser must complete,
 * or null if the user already has one. Owner wallets are plain accounts (EOA): a smart
 * account is not deployed until its first transaction, so the vault could not check
 * its signature before then.
 */
export async function startOwnerWallet(userToken: string): Promise<string | null> {
  try {
    const { data } = await userWallets().createUserPinWithWallets({
      userToken,
      blockchains: [ARC_TESTNET],
      accountType: "EOA",
    });
    return data?.challengeId ?? null;
  } catch (err) {
    // 155106: the user is already initialised (their wallet exists).
    if ((err as { code?: number })?.code === 155106) return null;
    throw err;
  }
}

/**
 * Wait for the owner to confirm a transaction in the Circle window, then for Circle to
 * send it. Returns the transaction hash once it is on chain. Gives up within 90 seconds,
 * under the 100 seconds Cloudflare allows a request.
 */
export async function waitForUserTransaction(userToken: string, challengeId: string, timeoutMs = 90_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let transactionId: string | undefined;
  for (;;) {
    if (!transactionId) {
      const { data } = await withRetries(() => userWallets().getUserChallenge({ userToken, challengeId }));
      const challenge = data?.challenge as { status?: string; correlationIds?: string[]; errorMessage?: string } | undefined;
      if (challenge?.status === "FAILED" || challenge?.status === "EXPIRED") {
        throw new Error(`The request ${challenge.status === "EXPIRED" ? "expired" : "failed"}${challenge.errorMessage ? `: ${challenge.errorMessage}` : ""}.`);
      }
      if (challenge?.status === "COMPLETE") transactionId = challenge.correlationIds?.[0];
    }
    if (transactionId) {
      const { data } = await withRetries(() => userWallets().getTransaction({ userToken, id: transactionId! }));
      const tx = data?.transaction;
      if (tx?.state === "FAILED" || tx?.state === "CANCELLED" || tx?.state === "DENIED") {
        throw new Error(`Circle could not send it: ${tx.errorReason ?? tx.state}.`);
      }
      if ((tx?.state === "CONFIRMED" || tx?.state === "COMPLETE") && tx.txHash) return tx.txHash;
    }
    if (Date.now() > deadline) throw new Error("Still waiting for this to go through. Refresh in a minute to see your balance.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
