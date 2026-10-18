// Deploys VaultFactory and a first vault to Arc testnet, reads the vault back to
// confirm its settings, and records the addresses in deployments/arc-testnet.json.
// Run with: npm run deploy:testnet
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createWalletClient, formatUnits, parseEventLogs, parseUnits, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EURC, USDC, arcTestnet, artifact, explorer, publicClient, requireEnv, transport } from "../src/arc.ts";

// The first vault. The deployer stands in as the business owner until the app exists.
// The agent is AGENT_ADDRESS if set; otherwise nobody can pay until the owner calls setAgent.
const CAP = parseUnits("1000", 6);
const LIFETIME = 90n * 24n * 60n * 60n;
const PAYEE_DELAY = 24n * 60n * 60n;

const account = privateKeyToAccount(requireEnv("DEPLOYER_PRIVATE_KEY") as Hex);
const walletClient = createWalletClient({ account, chain: arcTestnet, transport });
const agent = (process.env.AGENT_ADDRESS ?? zeroAddress) as Address;

const balance = await publicClient.getBalance({ address: account.address });
if (balance === 0n) {
  throw new Error(`${account.address} has no USDC for gas. Fund it at https://faucet.circle.com (Arc Testnet).`);
}
console.log(`Deployer ${account.address} has ${formatUnits(balance, 18)} USDC`);

const factoryArtifact = artifact("VaultFactory");
const vaultArtifact = artifact("PayerVault");

// 1. Factory
const factoryHash = await walletClient.deployContract({
  abi: factoryArtifact.abi,
  bytecode: factoryArtifact.bytecode,
  args: [[USDC, EURC]], // every vault may hold and pay these
});
const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: factoryHash });
if (factoryReceipt.status !== "success" || !factoryReceipt.contractAddress) {
  throw new Error(`Factory deployment failed: ${explorer}/tx/${factoryHash}`);
}
const factory = factoryReceipt.contractAddress;
console.log(`VaultFactory ${factory}`);

// 2. First vault
const { timestamp } = await publicClient.getBlock();
const expiresAt = timestamp + LIFETIME;
const createHash = await walletClient.writeContract({
  address: factory,
  abi: factoryArtifact.abi,
  functionName: "createVault",
  args: [account.address, agent, CAP, expiresAt, PAYEE_DELAY],
});
const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
if (createReceipt.status !== "success") {
  throw new Error(`createVault failed: ${explorer}/tx/${createHash}`);
}
const [created] = parseEventLogs({
  abi: factoryArtifact.abi,
  logs: createReceipt.logs,
  eventName: "VaultCreated",
}) as unknown as [{ args: { vault: Address } }];
const vault = created.args.vault;
console.log(`PayerVault ${vault}`);

// 3. Read the vault back from the chain and confirm it matches what we asked for.
const read = (functionName: string) =>
  publicClient.readContract({ address: vault, abi: vaultArtifact.abi, functionName });
const onChain = {
  owner: (await read("owner")) as Address,
  agent: (await read("agent")) as Address,
  tokens: ((await read("tokens")) as Address[]).join(","),
  cap: (await publicClient.readContract({ address: vault, abi: vaultArtifact.abi, functionName: "capOf", args: [USDC] })) as bigint,
  capEurc: (await publicClient.readContract({ address: vault, abi: vaultArtifact.abi, functionName: "capOf", args: [EURC] })) as bigint,
  expiresAt: (await read("expiresAt")) as bigint,
  payeeDelay: (await read("payeeDelay")) as bigint,
};
const expected = { owner: account.address, agent, tokens: [USDC, EURC].join(","), cap: CAP, capEurc: CAP, expiresAt, payeeDelay: PAYEE_DELAY };
for (const [key, want] of Object.entries(expected)) {
  const got = onChain[key as keyof typeof onChain];
  if (String(got).toLowerCase() !== String(want).toLowerCase()) {
    throw new Error(`Vault ${key} is ${got}, expected ${want}`);
  }
}
console.log("Vault settings confirmed on chain.");

// 4. Record the deployment, keeping earlier factories (their vaults still exist).
mkdirSync("deployments", { recursive: true });
const RECORD = "deployments/arc-testnet.json";
const before = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) : null;
const previousFactories = [
  ...(before?.previousFactories ?? []),
  ...(before?.factory ? [{ ...before.factory, vaultVersion: before.vaultVersion ?? 2 }] : []),
];
const record = {
  network: "arc-testnet",
  chainId: arcTestnet.id,
  deployedAt: new Date(Number(timestamp) * 1000).toISOString(),
  deployer: account.address,
  usdc: USDC,
  eurc: EURC,
  vaultVersion: 3,
  factory: { address: factory, tx: factoryHash, block: Number(factoryReceipt.blockNumber) },
  vaults: [
    {
      address: vault,
      tx: createHash,
      block: Number(createReceipt.blockNumber),
      owner: onChain.owner,
      agent: onChain.agent,
      cap: formatUnits(onChain.cap, 6), // per token
      expiresAt: new Date(Number(onChain.expiresAt) * 1000).toISOString(),
      payeeDelaySeconds: Number(onChain.payeeDelay),
    },
  ],
  previousFactories,
};
writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");

console.log(`\nFactory: ${explorer}/address/${factory}`);
console.log(`Vault:   ${explorer}/address/${vault}`);
if (agent === zeroAddress) console.log("No agent set yet. The owner calls setAgent once the agent wallet exists.");
