"use client";
// Add money to the vault from the owner's wallet, or take it back. The owner confirms
// each move in Circle's window.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, clearAuth, createSdk, loadAuth, runChallenge } from "../circle-client";
import { Icon } from "../ui";

export function Funds({ appId, walletAddress, walletBalances }: { appId: string; walletAddress: string; walletBalances: Record<string, string> }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("USDC");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  async function move(direction: "in" | "out") {
    const auth = loadAuth();
    if (!auth) return setMessage({ text: "Please sign in again.", error: true });
    setBusy(true);
    setMessage(null);
    try {
      const { challengeId } = await api<{ challengeId: string }>("/api/vault/move", { userToken: auth.userToken, direction, amount, token });
      setMessage({ text: "Confirm it in the Circle window…" });
      await runChallenge(await createSdk(appId), auth, challengeId);
      setMessage({ text: "Sending…" });
      await api<{ txHash: string }>("/api/vault/move/confirm", { userToken: auth.userToken, challengeId });
      setMessage({ text: direction === "in" ? `Added ${amount} ${token} to your vault.` : `Withdrew ${amount} ${token} to your wallet.` });
      setAmount("");
      router.refresh();
    } catch (err) {
      if (/sign in again/i.test((err as Error).message)) clearAuth();
      setMessage({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wallet-funds">
      <div className="wallet-address-card">
        <div className="wallet-address-heading"><span>Wallet address</span><button type="button" className="copy-address" onClick={copyAddress} aria-label="Copy wallet address"><Icon name="copy" size={15} />{copyStatus === "copied" ? "Copied" : "Copy address"}</button></div>
        <code className="wallet-address" title={walletAddress}>{walletAddress}</code>
        <p className="wallet-network">Receive USDC or EURC on <strong>Arc testnet</strong>.</p>
        {copyStatus === "copied" && <span className="sr-only" role="status">Wallet address copied.</span>}
        {copyStatus === "error" && <p className="error wallet-copy-error" role="alert">Copy is unavailable. Select the address and copy it manually.</p>}
      </div>
      <dl className="wallet-balances" aria-label="Wallet balances">
        {(["USDC", "EURC"] as const).map((symbol) => <div key={symbol}><dt>{symbol}</dt><dd>{walletBalances[symbol] ?? "—"}</dd></div>)}
      </dl>
      <p className="wallet-funding-help">
        Need testnet tokens? <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">Open Circle faucet ↗</a>
      </p>
      <div className="row">
        <input
          inputMode="decimal"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ maxWidth: 180 }}
          aria-label="Amount"
        />
        <select value={token} onChange={(e) => setToken(e.target.value)} aria-label="Token" style={{ maxWidth: 110 }}>
          <option value="USDC">USDC</option>
          <option value="EURC">EURC</option>
        </select>
        <button type="button" disabled={busy || !amount} onClick={() => move("in")}>Add to vault</button>
        <button type="button" className="secondary" disabled={busy || !amount} onClick={() => move("out")}>Withdraw</button>
      </div>
      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "error" : "muted"} style={{ marginTop: 8, marginBottom: 0 }}>{message.text}</p>}
    </div>
  );
}
