// Shared plumbing for the app's API routes.
import { NextResponse } from "next/server";
import { userIdFor } from "./circle-user.ts";
import { allow, clientIp } from "./rate-limit.ts";
import { getSession, type Session } from "./session.ts";
import { getBusiness, type Business } from "./store.ts";
import { InvoiceBusyError, InvoiceStateError } from "./invoice-actions.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** JSON that can carry chain values: bigints (amounts, times) become decimal strings. */
function json(data: unknown, status = 200) {
  const body = JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, { status, headers: { "Content-Type": "application/json" } });
}

/**
 * State-changing requests from the owner's browser must come from this site. Browsers
 * always send Origin on cross-site POSTs, so a page elsewhere cannot act for a signed-in owner.
 */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // not a browser cross-site request (curl, server to server)
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

/**
 * Wrap a handler so it returns JSON, and errors come back as { error } with a status.
 * Routes called by other services with their own secret (inbound email, cron) pass
 * `{ external: true }` to skip the same-origin check.
 */
export function route(handler: (req: Request) => Promise<unknown>, { external = false }: { external?: boolean } = {}) {
  return async (req: Request) => {
    if (!external && req.method !== "GET" && !sameOrigin(req)) return json({ error: "Not allowed." }, 403);
    let result: unknown;
    try {
      result = await handler(req);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err instanceof InvoiceBusyError || err instanceof InvoiceStateError ? 409 : 500;
      if (status === 500) {
        console.error(err);
        // Unexpected errors can carry internals (URLs, request bodies); show those only in development.
        if (process.env.NODE_ENV === "production") return json({ error: "Something went wrong. Please try again." }, 500);
      }
      const code = (err as { code?: unknown })?.code;
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: code && status === 500 ? `${message} (Circle code ${code})` : message }, status);
    }
    return json(result);
  };
}

/** Throw 429 if `key` has used up its attempts. */
export function limit(key: string, max: number, windowMs: number, what = "requests") {
  if (!allow(key, max, windowMs)) throw new HttpError(429, `Too many ${what}. Please wait a few minutes and try again.`);
}

export { clientIp };

/** The signed-in owner. If a Circle userToken is given, it must belong to them. */
export async function requireOwner(userToken?: unknown): Promise<Session> {
  const session = await getSession();
  if (!session) throw new HttpError(401, "Please sign in.");
  if (userToken !== undefined) {
    if (typeof userToken !== "string" || !userToken) throw new HttpError(401, "Please sign in again.");
    if ((await userIdFor(userToken).catch(() => null)) !== session.uid) {
      throw new HttpError(401, "Your Circle sign-in has expired. Please sign in again.");
    }
  }
  return session;
}

export async function requireBusiness(userToken?: unknown): Promise<{ session: Session; business: Business }> {
  const session = await requireOwner(userToken);
  const business = getBusiness(session.uid);
  if (!business) throw new HttpError(404, "Set up your business first.");
  return { session, business };
}
