"use client";
import { api, clearAuth } from "../circle-client";

export function SignOut() {
  async function signOut() {
    clearAuth();
    await api("/api/auth/sign-out", {}).catch(() => undefined);
    window.location.href = "/login";
  }
  return (
    <button className="secondary" onClick={signOut}>
      Sign out
    </button>
  );
}
