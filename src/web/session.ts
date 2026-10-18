// The app's own session: a signed cookie naming the owner's Circle user.
// Circle's userToken stays in the browser and is sent with requests that need it;
// the server checks it belongs to the session's user before using it.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { requireEnv } from "../arc.ts";

const COOKIE = "payer_session";
const MAX_AGE = 7 * 24 * 60 * 60; // seconds

export type Session = { uid: string; email: string; exp: number };

const sign = (payload: string) => createHmac("sha256", requireEnv("SESSION_SECRET")).update(payload).digest("base64url");

export async function setSession(uid: string, email: string) {
  const payload = Buffer.from(JSON.stringify({ uid, email, exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function getSession(): Promise<Session | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
  return session.exp > Date.now() ? session : null;
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}
