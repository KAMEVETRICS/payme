// Move money, step 2: wait until the owner has confirmed in Circle's window and the
// transaction is on chain. The challenge is looked up with the owner's own token, so
// one owner cannot follow another's.
import { waitForUserTransaction } from "../../../../../src/web/circle-user.ts";
import { HttpError, requireBusiness, route } from "../../../../../src/web/http.ts";

export const POST = route(async (req) => {
  const { userToken, challengeId } = (await req.json()) as { userToken?: string; challengeId?: string };
  await requireBusiness(userToken);
  if (!challengeId) throw new HttpError(400, "Missing the request to check.");
  const txHash = await waitForUserTransaction(userToken!, challengeId);
  return { txHash };
});
