"use client";
// Sign in with an email code. Circle sends the code and shows its own code screen;
// once verified, the owner's Circle userToken starts the app session.
import { useEffect, useRef, useState } from "react";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { api, createSdk, saveAuth } from "./circle-client";

const DEVICE_KEY = "payer.deviceId";

/**
 * Circle identifies the browser with a device id, fetched through a hidden Circle page
 * the SDK waits only 10 seconds for. Always ask for the current one: the code is bound to
 * it, and a browser that does not let Circle's page keep its storage gets a new id per
 * visit. A remembered id is only a fallback when Circle's page is too slow to answer.
 */
async function deviceIdFor(sdk: W3SSdk): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const id = await sdk.getDeviceId();
      try {
        localStorage.setItem(DEVICE_KEY, id);
      } catch {
        // Not remembered; fine.
      }
      return id;
    } catch (err) {
      if (attempt < 3) continue;
      try {
        const known = localStorage.getItem(DEVICE_KEY);
        if (known) return known;
      } catch {
        // Storage blocked.
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}

export function SignIn({ appId }: { appId: string }) {
  const sdk = useRef<W3SSdk | null>(null);
  const emailRef = useRef("");
  const deviceRef = useRef(""); // the SDK's callback is created before the device id is known
  const [deviceId, setDeviceId] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [verified, setVerified] = useState<string | null>(null); // the verified userToken

  // The code is verified once; if starting the session fails (say, a network blip),
  // the owner can try again with the same verified sign-in instead of a new code.
  // The server takes the email from step 1, keyed by this browser's device id.
  async function startSession(userToken: string) {
    setBusy(true);
    setMessage({ text: "Signing you in…" });
    try {
      const { next } = await api<{ next: string }>("/api/auth/session", { userToken, deviceId: deviceRef.current });
      window.location.href = next;
    } catch (err) {
      setBusy(false);
      setMessage({ text: (err as Error).message, error: true });
    }
  }

  useEffect(() => {
    let cancelled = false;
    createSdk(appId, async (error, result) => {
      if (error || !result) {
        setBusy(false);
        setMessage({ text: error?.message || "The code was not accepted. Try again.", error: true });
        return;
      }
      saveAuth({ userToken: result.userToken, encryptionKey: result.encryptionKey });
      setVerified(result.userToken);
      await startSession(result.userToken);
    })
      .then(async (instance) => {
        if (cancelled) return;
        sdk.current = instance;
        const id = await deviceIdFor(instance);
        deviceRef.current = id;
        setDeviceId(id);
      })
      .catch((err) => {
        console.error("Circle Web SDK failed to start", err);
        setMessage({ text: `Could not load Circle's sign-in (${(err as Error)?.message ?? err}). Check your connection and reload.`, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    if (!sdk.current || !deviceId) return;
    setBusy(true);
    setMessage(null);
    emailRef.current = email.trim();
    try {
      const tokens = await api<{ deviceToken: string; deviceEncryptionKey: string; otpToken: string }>("/api/auth/email-otp", {
        deviceId,
        email: emailRef.current,
      });
      sdk.current.updateConfigs({
        appSettings: { appId },
        loginConfigs: {
          deviceToken: tokens.deviceToken,
          deviceEncryptionKey: tokens.deviceEncryptionKey,
          otpToken: tokens.otpToken,
        },
      });
      setMessage({ text: "We sent you a code. Enter it in the window that opens." });
      sdk.current.verifyOtp();
    } catch (err) {
      setBusy(false);
      setMessage({ text: (err as Error).message, error: true });
    }
  }

  return (
    <form onSubmit={sendCode} className="card">
      <label htmlFor="email">Work email</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@business.com"
      />
      <div className="row" style={{ marginTop: 16 }}>
        <button type="submit" disabled={busy || !deviceId}>
          {!deviceId ? "Preparing secure sign-in…" : busy ? "Waiting for your code…" : "Email me a sign-in code"}
        </button>
      </div>
      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "error" : "muted"} style={{ marginTop: 12 }}>{message.text}</p>}
      {verified && message?.error && (
        <button type="button" className="secondary" disabled={busy} onClick={() => startSession(verified)}>
          Try again
        </button>
      )}
    </form>
  );
}
