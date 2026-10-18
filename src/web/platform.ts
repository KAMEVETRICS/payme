// What the platform does on a business's behalf, through Payer's own Circle agent
// wallet: create the business's vault. The factory gives the caller no rights over
// the vault; the owner's wallet owns it from the start.
import { readFileSync } from "node:fs";
import { encodeFunctionData, parseEventLogs, parseUnits, type Address, type Hex } from "viem";
import { artifact, publicClient, requireEnv } from "../arc.ts";
import { circleClient, execute } from "../circle.ts";
import { HttpError } from "./http.ts";

const factoryAbi = artifact("VaultFactory").abi;
const NEW_SUPPLIER_DELAY = 24n * 60n * 60n;
const VAULT_LIFETIME = 365n * 24n * 60n * 60n;

export async function createVaultFor(owner: Address, capUsdc: string): Promise<{ vault: Address; tx: Hex }> {
  const factory: Address = JSON.parse(readFileSync("deployments/arc-testnet.json", "utf8")).factory.address;
  const agent = requireEnv("CIRCLE_AGENT_ADDRESS") as Address;
  const { timestamp } = await publicClient.getBlock();
  const callData = encodeFunctionData({
    abi: factoryAbi,
    functionName: "createVault",
    args: [owner, agent, parseUnits(capUsdc, 6), timestamp + VAULT_LIFETIME, NEW_SUPPLIER_DELAY],
  });
  const result = await execute(circleClient(), { walletId: requireEnv("CIRCLE_AGENT_WALLET_ID"), contract: factory, callData });
  if (result.errorReason === "INSUFFICIENT_NATIVE_TOKEN") {
    console.error("The agent wallet is out of gas: fund CIRCLE_AGENT_ADDRESS with testnet USDC.");
    throw new HttpError(503, "We can't create vaults right now. We've been alerted; please try again later.");
  }
  if (result.state !== "COMPLETE" || !result.txHash) {
    throw new Error(`Creating the vault failed: ${result.state} ${result.errorReason ?? ""}`);
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash: result.txHash });
  const [created] = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "VaultCreated" }) as unknown as [
    { args: { vault: Address } },
  ];
  return { vault: created.args.vault, tx: result.txHash };
}
