// One-time Circle setup for Arc testnet. Each step is skipped if already done:
//   1. Generate and register the entity secret (saved to .env first, recovery file to secrets/).
//   2. Create a wallet set and two developer-controlled EOA wallets on ARC-TESTNET:
//      the agent, and a stand-in owner for a test business. In the app, the owner
//      becomes the business's own Circle user-controlled wallet.
//   3. Fund both from the deployer for gas (and the owner's first deposit).
//   4. Create a fresh vault for the test business: owner and agent are the Circle wallets.
// Requires CIRCLE_API_KEY (a testnet key) in .env.
// Run with: npm run circle:setup
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";
import { createWalletClient, formatUnits, parseEventLogs, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, artifact, explorer, publicClient, requireEnv, transport } from "../src/arc.ts";
import { ARC_TESTNET, circleClient, saveEnv } from "../src/circle.ts";

const OWNER_FUNDING = parseUnits("6", 18); // native USDC: a 5 USDC deposit plus gas
const AGENT_FUNDING = parseUnits("1", 18); // native USDC for gas
const TEST_VAULT = { cap: parseUnits("1000", 6), lifetime: 90n * 86400n, payeeDelay: 120n };

const apiKey = requireEnv("CIRCLE_API_KEY");

// ---- 1. Entity secret ----

if (!process.env.CIRCLE_ENTITY_SECRET) {
  const entitySecret = randomBytes(32).toString("hex");
  saveEnv("CIRCLE_ENTITY_SECRET", entitySecret); // saved before registering so it can never be lost
  mkdirSync("secrets", { recursive: true });
  await registerEntitySecretCiphertext({ apiKey, entitySecret, recoveryFileDownloadPath: "secrets" });
  console.log("Registered the entity secret. Its recovery file is in secrets/ (keep a copy somewhere safe).");
}

const circle = circleClient();

// ---- 2. Wallet set and wallets ----

if (!process.env.CIRCLE_WALLET_SET_ID) {
  const { data } = await circle.createWalletSet({ name: "Payer testnet" });
  saveEnv("CIRCLE_WALLET_SET_ID", data!.walletSet.id);
  console.log(`Created wallet set ${data!.walletSet.id}`);
}

async function ensureWallet(prefix: string, name: string) {
  if (process.env[`${prefix}_WALLET_ID`]) return process.env[`${prefix}_ADDRESS`] as Address;
  const { data } = await circle.createWallets({
    walletSetId: requireEnv("CIRCLE_WALLET_SET_ID"),
    blockchains: [ARC_TESTNET],
    count: 1,
    accountType: "EOA",
    metadata: [{ name }],
  });
  const wallet = data!.wallets[0];
  saveEnv(`${prefix}_WALLET_ID`, wallet.id);
  saveEnv(`${prefix}_ADDRESS`, wallet.address);
  console.log(`Created ${name}: ${wallet.address}`);
  return wallet.address as Address;
}

const agent = await ensureWallet("CIRCLE_AGENT", "Payer agent");
// Circle rejects some characters in wallet names (parentheses gave "API parameter invalid").
const owner = await ensureWallet("CIRCLE_OWNER", "Test business owner");

// ---- 3. Gas and deposit money, from the deployer ----

const deployer = privateKeyToAccount(requireEnv("DEPLOYER_PRIVATE_KEY") as Hex);
const deployerWallet = createWalletClient({ account: deployer, chain: arcTestnet, transport });

async function topUp(address: Address, target: bigint, label: string) {
  const balance = await publicClient.getBalance({ address });
  if (balance >= target / 2n) return;
  const hash = await deployerWallet.sendTransaction({ to: address, value: target - balance });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Sent ${label} ${formatUnits(target - balance, 18)} USDC from the deployer.`);
}

await topUp(agent, AGENT_FUNDING, "the agent");
await topUp(owner, OWNER_FUNDING, "the owner");

// ---- 4. A fresh vault for the test business ----

const deployment = JSON.parse(readFileSync("deployments/arc-testnet.json", "utf8"));
const existing = deployment.vaults.find(
  (v: { owner: string; agent: string }) =>
    v.owner.toLowerCase() === owner.toLowerCase() && v.agent.toLowerCase() === agent.toLowerCase(),
);

if (existing) {
  console.log(`Test business vault already exists: ${existing.address}`);
} else {
  const factoryAbi = artifact("VaultFactory").abi;
  const { timestamp } = await publicClient.getBlock();
  const hash = await deployerWallet.writeContract({
    address: deployment.factory.address,
    abi: factoryAbi,
    functionName: "createVault",
    args: [owner, agent, TEST_VAULT.cap, timestamp + TEST_VAULT.lifetime, TEST_VAULT.payeeDelay],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`createVault failed: ${explorer}/tx/${hash}`);
  const [created] = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "VaultCreated" }) as unknown as [
    { args: { vault: Address } },
  ];
  deployment.vaults.push({
    label: "Test business (Circle wallets)",
    address: created.args.vault,
    tx: hash,
    block: Number(receipt.blockNumber),
    owner,
    agent,
    cap: formatUnits(TEST_VAULT.cap, 6),
    expiresAt: new Date(Number(timestamp + TEST_VAULT.lifetime) * 1000).toISOString(),
    payeeDelaySeconds: Number(TEST_VAULT.payeeDelay),
  });
  writeFileSync("deployments/arc-testnet.json", JSON.stringify(deployment, null, 2) + "\n");
  console.log(`Created the test business vault: ${explorer}/address/${created.args.vault}`);
}

console.log("\nCircle setup done.");
