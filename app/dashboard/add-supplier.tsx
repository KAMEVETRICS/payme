"use client";
// Add a supplier: the owner's Circle wallet signs the rule, then the agent puts it on chain.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signAndConfirm } from "../circle-client";

export function AddSupplier({ appId }: { appId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setBusy(true);
    setMessage({ text: "Preparing the rule…" });
    try {
      const { payableFrom } = await signAndConfirm<{ payableFrom: string }>({
        appId,
        prepare: "/api/suppliers/prepare",
        confirm: "/api/suppliers/confirm",
        body: fields,
        onStatus: (text) => setMessage({ text }),
      });
      setMessage({ text: `Added. Payme can pay them from ${new Date(payableFrom).toLocaleString()}.` });
      form.reset();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <>
        <button className="secondary" onClick={() => setOpen(true)}>Add a supplier</button>
        {message && <p className={message.error ? "error" : "muted"} style={{ marginTop: 12 }}>{message.text}</p>}
      </>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <label htmlFor="s-name">Supplier name</label>
      <input id="s-name" name="name" type="text" required placeholder="Adebayo Fabrics Ltd" />
      <label htmlFor="s-address">Their wallet address on Arc</label>
      <input id="s-address" name="address" type="text" required placeholder="0x…" className="mono" />
      <div className="row">
        <div style={{ flex: 1 }}>
          <label htmlFor="s-budget">Budget</label>
          <input id="s-budget" name="budgetUsdc" type="number" min="0.01" step="any" required placeholder="2000" />
        </div>
        <div>
          <label htmlFor="s-token">Pay in</label>
          <select id="s-token" name="token" defaultValue="USDC">
            <option value="USDC">USDC (dollar invoices)</option>
            <option value="EURC">EURC (euro invoices)</option>
          </select>
        </div>
        <div>
          <label htmlFor="s-period">Resets</label>
          <select id="s-period" name="period" defaultValue="week">
            <option value="week">Every week</option>
            <option value="month">Every month</option>
            <option value="once">Never (one order)</option>
          </select>
        </div>
      </div>
      <label htmlFor="s-terms">Agreed terms (optional)</label>
      <input id="s-terms" name="terms" type="text" placeholder="Cotton fabric, reordered weekly, net 7" />
      <div className="row" style={{ marginTop: 16 }}>
        <button type="submit" disabled={busy}>{busy ? "Working…" : "Approve and add"}</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
      </div>
      {message && <p className={message.error ? "error" : "muted"} style={{ marginTop: 12, marginBottom: 0 }}>{message.text}</p>}
    </form>
  );
}
