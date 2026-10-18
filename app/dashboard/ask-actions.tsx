"use client";
// The owner's answer to an "ask": approve (sign a one-off rule, then the agent pays) or
// reject. Also the retry for an approved payment that has not gone out yet.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, signAndConfirm } from "../circle-client";

type Payment = { status: string; txHash?: string; reason?: string; error?: string };

export function AskActions({
  appId,
  receiptId,
  canApprove,
  blockers,
  warnings,
}: {
  appId: string;
  receiptId: string;
  canApprove: boolean;
  blockers: string[];
  warnings: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function approve() {
    setBusy(true);
    setMessage({ text: "Checking it can still be paid…" });
    try {
      const { payment } = await signAndConfirm<{ payment: Payment }>({
        appId,
        prepare: "/api/approvals/prepare",
        confirm: "/api/approvals/confirm",
        body: { receiptId },
        onStatus: (text) => setMessage({ text }),
      });
      setMessage({ text: payment.status === "paid" ? "Approved and paid." : "Approved; the payment has not gone out yet." });
      router.refresh();
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true });
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await api("/api/approvals/reject", { receiptId });
      router.refresh();
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true });
      setBusy(false);
    }
  }

  return (
    <div className="actions">
      {blockers.map((b) => (
        <p key={b} className="muted" style={{ marginBottom: 6 }}>
          Payme cannot pay this: {b}
        </p>
      ))}
      {canApprove &&
        warnings.map((w) => (
          <p key={w} className="warning">
            {w}
          </p>
        ))}
      <div className="row">
        {canApprove && (
          <button onClick={approve} disabled={busy}>
            Approve and pay once
          </button>
        )}
        <button className={canApprove ? "secondary" : "dismiss-action"} onClick={reject} disabled={busy}>
          {canApprove ? "Reject" : busy ? "Dismissing…" : "Dismiss invoice"}
        </button>
      </div>
      {message && <p className={message.error ? "error" : "muted"} style={{ marginTop: 8, marginBottom: 0 }}>{message.text}</p>}
    </div>
  );
}

export function RetryPayment({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function retry() {
    setBusy(true);
    setError("");
    try {
      await api("/api/approvals/retry", { receiptId });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="secondary" onClick={retry} disabled={busy} style={{ marginTop: 8 }}>
        {busy ? "Trying…" : "Try the payment again"}
      </button>
      {error && <p className="error" style={{ marginTop: 8, marginBottom: 0 }}>{error}</p>}
    </>
  );
}
