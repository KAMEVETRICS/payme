// Set up a business: a fresh vault owned by the owner's Circle wallet, with Payme's
// agent as its agent.
import { HttpError, requireOwner, route } from "../../../src/web/http.ts";
import { ownerWallet } from "../../../src/web/circle-user.ts";
import { createVaultFor } from "../../../src/web/platform.ts";
import { ensureInboxKey } from "../../../src/web/inbox.ts";
import { CURRENT_VAULT_VERSION, getBusiness } from "../../../src/web/store.ts";

export const POST = route(async (req) => {
  const { userToken, name, capUsdc } = (await req.json()) as { userToken?: string; name?: string; capUsdc?: string };
  const session = await requireOwner(userToken);
  if (getBusiness(session.uid)) return { next: "/dashboard" };
  if (!name?.trim()) throw new HttpError(400, "Enter your business name.");
  if (!capUsdc || !/^\d+(\.\d{1,6})?$/.test(capUsdc) || Number(capUsdc) <= 0) {
    throw new HttpError(400, "Enter a spending cap in USDC, such as 5000.");
  }
  const wallet = await ownerWallet(userToken!);
  if (!wallet) throw new HttpError(400, "Your wallet is not ready yet.");

  const { vault, tx } = await createVaultFor(wallet.address, capUsdc);
  ensureInboxKey({
    business: name.trim(),
    vault,
    suppliers: [],
    ownerId: session.uid,
    ownerEmail: session.email,
    ownerWalletId: wallet.id,
    ownerAddress: wallet.address,
    vaultTx: tx,
    vaultVersion: CURRENT_VAULT_VERSION,
    createdAt: new Date().toISOString(),
  });
  return { next: "/dashboard" };
});
