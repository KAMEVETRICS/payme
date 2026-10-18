"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function Upload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!(data.get("invoice") as File | null)?.size) return;
    setBusy(true);
    setMessage({ text: "Payme is reading the invoice…" });
    try {
      const response = await fetch("/api/invoices", { method: "POST", body: data });
      const result = (await response.json()) as { error?: string; decision?: { action: string; reason: string } };
      if (!response.ok) throw new Error(result.error ?? "Upload failed.");
      setMessage({ text: `${result.decision!.action.toUpperCase()}: ${result.decision!.reason}` });
      form.reset();
      router.refresh();
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="row">
        <input name="invoice" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" aria-label="Choose an invoice" required disabled={busy} />
        <button type="submit" disabled={busy}>{busy ? "Working…" : "Upload"}</button>
      </div>
      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "error" : ""} style={{ marginTop: 12, marginBottom: 0 }}>{message.text}</p>}
    </form>
  );
}
