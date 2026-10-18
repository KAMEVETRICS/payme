// Step 2 of sign-in: the browser verified the code with Circle and got a userToken.
// Check it with Circle and start the app session, with the email this browser asked
// a code for in step 1.
import { HttpError, route } from "../../../../src/web/http.ts";
import { userIdFor } from "../../../../src/web/circle-user.ts";
import { setSession } from "../../../../src/web/session.ts";
import { signInEmailFor } from "../../../../src/web/sign-in-emails.ts";
import { getBusiness } from "../../../../src/web/store.ts";

export const POST = route(async (req) => {
  const { userToken, deviceId } = (await req.json()) as { userToken?: string; deviceId?: string };
  if (!userToken || !deviceId) throw new HttpError(400, "Missing sign-in details.");
  const email = signInEmailFor(deviceId);
  if (!email) throw new HttpError(400, "That sign-in has expired. Please request a new code.");
  const uid = await userIdFor(userToken);
  await setSession(uid, email);
  return { next: getBusiness(uid) ? "/dashboard" : "/onboarding" };
});
