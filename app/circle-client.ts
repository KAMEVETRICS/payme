"use client";
// Browser-side Circle helpers. The Circle userToken and encryptionKey live in this
// tab's sessionStorage: the Web SDK needs them to show the owner signing prompts.
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import type { EmailLoginResult, LoginCompleteCallback } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";

export type CircleAuth = { userToken: string; encryptionKey: string };

const KEY = "payer.circle";

export function loadAuth(): CircleAuth | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "null") as CircleAuth | null;
  } catch {
    return null;
  }
}

export function saveAuth(auth: CircleAuth) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(auth));
  } catch {
    // Storage blocked: signing prompts will ask the owner to sign in again.
  }
}

export function clearAuth() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The SDK touches window, so it is only ever loaded in the browser. */
export async function createSdk(appId: string, onLoginComplete?: LoginCompleteCallback): Promise<W3SSdk> {
  const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
  return new W3SSdk({ appSettings: { appId } }, onLoginComplete);
}

/** The SDK's code when Circle's window did not answer within 10 seconds. */
const NO_RESPONSE = 155706;

/**
 * Show the owner a Circle challenge (create wallet, sign) and resolve when they finish it.
 * If Circle's window is slow to answer, resolves with `pending: true`: the window stays
 * open for the owner, and the server asks Circle for the result instead.
 */
export function runChallenge(
  sdk: W3SSdk,
  auth: CircleAuth,
  challengeId: string,
): Promise<{ signature?: string; pending?: boolean }> {
  sdk.setAuthentication(auth);
  return new Promise((resolve, reject) => {
    let settled = false;
    sdk.execute(challengeId, (error, result) => {
      if (settled) return;
      settled = true;
      if (error) {
        if ((error as { code?: number }).code === NO_RESPONSE) return resolve({ pending: true });
        return reject(new Error(error.message || "The request was not completed."));
      }
      const data = (result as { data?: { signature?: string } } | undefined)?.data;
      resolve({ signature: data?.signature });
    });
  });
}

export type { EmailLoginResult };

/**
 * The owner approves something by signing it: the server prepares a Circle signing
 * request, the owner signs in Circle's window, and the server confirms and acts on it.
 */
export async function signAndConfirm<T>({
  appId,
  prepare,
  confirm,
  body,
  onStatus,
}: {
  appId: string;
  prepare: string;
  confirm: string;
  body: Record<string, unknown>;
  onStatus?: (text: string) => void;
}): Promise<T> {
  const auth = loadAuth();
  if (!auth) throw new Error("Please sign in again to approve.");
  try {
    const { pendingId, challengeId } = await api<{ pendingId: string; challengeId: string }>(prepare, {
      userToken: auth.userToken,
      ...body,
    });
    onStatus?.("Approve it in the Circle window…");
    const { signature, pending } = await runChallenge(await createSdk(appId), auth, challengeId);
    if (!signature && !pending) throw new Error("Circle did not return a signature.");
    onStatus?.(signature ? "Approved. Working on it…" : "Waiting for your approval in the Circle window…");
    return await api<T>(confirm, { userToken: auth.userToken, pendingId, signature });
  } catch (err) {
    if (/sign in again/i.test((err as Error).message)) clearAuth();
    throw err;
  }
}

/** POST JSON to one of the app's routes; throws with the route's error message. */
export async function api<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data;
}
