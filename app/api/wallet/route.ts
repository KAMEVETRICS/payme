// The owner's wallet: return it, or the challenge the browser completes to create it.
import { requireOwner, route } from "../../../src/web/http.ts";
import { ownerWallet, startOwnerWallet } from "../../../src/web/circle-user.ts";

export const POST = route(async (req) => {
  const { userToken } = (await req.json()) as { userToken?: string };
  await requireOwner(userToken);
  const wallet = await ownerWallet(userToken!);
  if (wallet) return { wallet };
  const challengeId = await startOwnerWallet(userToken!);
  if (!challengeId) throw new Error("Circle says your wallet exists but did not return it. Try again in a moment.");
  return { challengeId };
});
