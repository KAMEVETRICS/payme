// Which email each browser (Circle device id) asked to sign in with, for 15 minutes.
// Step 2 of sign-in takes the email from here instead of from the browser.
const TTL = 15 * 60 * 1000;
const byDevice = new Map<string, { email: string; at: number }>();

export function rememberSignInEmail(deviceId: string, email: string) {
  byDevice.set(deviceId, { email, at: Date.now() });
}

export function signInEmailFor(deviceId: string): string | null {
  const entry = byDevice.get(deviceId);
  if (!entry || Date.now() - entry.at > TTL) return null;
  return entry.email;
}
