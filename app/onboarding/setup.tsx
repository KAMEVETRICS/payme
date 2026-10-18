"use client";
// First visit: create the owner's Circle wallet if needed, then the business's vault.
import { useEffect, useRef, useState } from "react";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { api, createSdk, loadAuth, runChallenge } from "../circle-client";

type Wallet = { id: string; address: string };

export function Setup({ appId }: { appId: string }) {
  const sdk = useRef<W3SSdk | null>(null);
  const started = useRef(false); // React runs effects twice in development; ask Circle once
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [status, setStatus] = useState("Preparing your wallet…");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [cap, setCap] = useState("5000");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const auth = loadAuth();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    (async () => {
      sdk.current = await createSdk(appId);
      let result = await api<{ wallet?: Wallet; challengeId?: string }>("/api/wallet", { userToken: auth.userToken });
      if (result.challengeId) {
        setStatus("Confirm in the Circle window to create your wallet.");
        await runChallenge(sdk.current, auth, result.challengeId);
        // Circle creates the wallet a moment after the challenge completes.
        for (let i = 0; i < 10 && !result.wallet; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          result = await api<{ wallet?: Wallet; challengeId?: string }>("/api/wallet", { userToken: auth.userToken });
        }
      }
      if (!result.wallet) throw new Error("Your wallet is taking longer than usual. Reload the page in a minute.");
      setWallet(result.wallet);
      setStatus("");
    })().catch((err) => setError((err as Error).message));
  }, [appId]);

  async function createBusiness(event: React.FormEvent) {
    event.preventDefault();
    const auth = loadAuth();
    if (!auth) return void (window.location.href = "/login");
    setBusy(true);
    setError("");
    try {
      const { next } = await api<{ next: string }>("/api/business", { userToken: auth.userToken, name, capUsdc: cap });
      window.location.href = next;
    } catch (err) {
      setBusy(false);
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="card">
        <strong>Your wallet</strong>
        {wallet ? (
          <p className="mono" style={{ marginTop: 4 }}>{wallet.address}</p>
        ) : (
          <p className="muted" style={{ marginTop: 4 }}>{status}</p>
        )}
        <p className="muted" style={{ fontSize: 14, marginBottom: 0 }}>
          Only you can sign with it. Payme can pay suppliers only under rules this wallet approves.
        </p>
      </div>

      {wallet && (
        <form className="card" onSubmit={createBusiness}>
          <label htmlFor="name">Business name</label>
          <input id="name" type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Imports" />
          <label htmlFor="cap">Most Payme may ever spend, in USDC</label>
          <input id="cap" type="number" min="1" step="any" required value={cap} onChange={(e) => setCap(e.target.value)} />
          <p className="muted" style={{ fontSize: 14 }}>
            You can change this later. New suppliers wait 24 hours before their first payment.
          </p>
          <p className="muted" style={{ fontSize: 12 }}>Next, add USDC or EURC to your vault from the dashboard. Your vault starts empty.</p>
          <button type="submit" disabled={busy}>{busy ? "Creating your vault…" : "Create my vault"}</button>
        </form>
      )}

      {error && <p className="error">{error}</p>}
    </>
  );
}
