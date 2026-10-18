// Step 1 of sign-in: ask Circle to email the owner a one-time code.
// The server remembers which email this browser asked for, so step 2 does not have to
// trust an email address sent by the browser.
import { HttpError, clientIp, limit, route } from "../../../../src/web/http.ts";
import { userWallets } from "../../../../src/web/circle-user.ts";
import { rememberSignInEmail } from "../../../../src/web/sign-in-emails.ts";

const TEN_MINUTES = 10 * 60 * 1000;

export const POST = route(async (req) => {
  const { deviceId, email } = (await req.json()) as { deviceId?: string; email?: string };
  if (!deviceId || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  const address = email.trim().toLowerCase();
  // Each code is an email Circle sends for us; cap them per visitor and per address.
  limit(`otp-ip:${clientIp(req)}`, 10, TEN_MINUTES, "sign-in codes");
  limit(`otp-email:${address}`, 3, TEN_MINUTES, "sign-in codes for this email");

  const { data } = await userWallets()
    .createDeviceTokenForEmailLogin({ deviceId, email: address })
    .catch((err) => {
      // 155160: Circle could not hand the email to the mail server (often a sending limit).
      if ((err as { code?: number })?.code === 155160) {
        throw new HttpError(503, "We couldn't send your sign-in code just now. Please try again in a minute.");
      }
      throw err;
    });
  if (!data?.deviceToken) throw new Error("Circle did not start the email sign-in.");
  rememberSignInEmail(deviceId, address);
  return { deviceToken: data.deviceToken, deviceEncryptionKey: data.deviceEncryptionKey, otpToken: data.otpToken };
});
