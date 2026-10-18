"use client";
// Move from a v2 vault (USDC only) to a new one that also pays euro invoices in EURC.
import { useState } from "react";
import { api, clearAuth, createSdk, loadAuth, runChallenge } from "../circle-client";

export function Upgrade({ appId, suppliers }: { appId: string; suppliers: string[] }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function move() {
    const auth = loadAuth();
    if (!auth) return setMessage({ text: "Please sign in again.", error: true });
    setBusy(true);
    setMessage({ text: "Creating your new vault…" });
    try {
      const result = await api<{ vault: string; withdrawChallengeId?: string | null; leftover?: string }>("/api/business/upgrade", {
        userToken: auth.userToken,
      });
      if (result.withdrawChallengeId) {
        setMessage({ text: `New vault ready. Confirm in the Circle window to take the ${result.leftover} USDC left in your old vault back to your wallet…` });
        await runChallenge(await createSdk(appId), auth, result.withdrawChallengeId);
        await api("/api/vault/move/confirm", { userToken: auth.userToken, challengeId: result.withdrawChallengeId }).catch(() => undefined);
      }
      window.location.reload();
    } catch (err) {
      if (/sign in again/i.test((err as Error).message)) clearAuth();
      setBusy(false);
      setMessage({ text: (err as Error).message, error: true });
    }
  }

  return (
    <div className="card warning-card">
      <strong>Move to your new vault</strong>
      <p style={{ fontSize: 14 }}>
        Payme&apos;s vaults can now pay euro invoices in EURC as well as USDC. Your current vault only holds USDC, so Payme
        will create a new one, owned by your wallet as before, and stop using the old one. Any USDC left in the old vault
        goes back to your wallet; then add it to the new vault.
        {suppliers.length > 0 && ` After the move, approve your suppliers again (${suppliers.join(", ")}): rules don't carry over.`}
      </p>
      <button type="button" disabled={busy} onClick={move}>{busy ? "Working…" : "Move to a new vault"}</button>
      {message && <p className={message.error ? "error" : "muted"} style={{ marginTop: 8, marginBottom: 0 }}>{message.text}</p>}
    </div>
  );
}
