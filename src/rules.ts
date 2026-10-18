// Rules: the owner signs a rule's terms through Circle; the agent submits them.
import { encodeFunctionData, hashTypedData, parseEventLogs, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { arcTestnet, artifact, publicClient } from "./arc.ts";
import { execute, type circleClient } from "./circle.ts";

export type RuleTerms = {
  payee: Address;
  token: Address; // the stablecoin it pays in: USDC or EURC
  budget: bigint; // in that token, 6 decimals; per period, or a lifetime total when period is 0
  period: bigint; // seconds
  startsAt: bigint;
  expiresAt: bigint;
  ref: Hex; // hash of the agreed terms
  salt: Hex;
};

export const vaultAbi = artifact("PayerVault").abi;

const RULE_TYPES = {
  Rule: [
    { name: "payee", type: "address" },
    { name: "token", type: "address" },
    { name: "budget", type: "uint256" },
    { name: "period", type: "uint256" },
    { name: "startsAt", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "ref", type: "bytes32" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

export function ruleTypedData(vault: Address, terms: RuleTerms) {
  return {
    domain: { name: "PayerVault", version: "3", chainId: arcTestnet.id, verifyingContract: vault },
    types: RULE_TYPES,
    primaryType: "Rule",
    message: terms,
  } as const;
}

/** The rule as the eth_signTypedData_v4 JSON Circle's wallets sign: EIP712Domain listed, numbers as strings. */
export function ruleTypedDataJson(vault: Address, terms: RuleTerms): string {
  const typedData = ruleTypedData(vault, terms);
  return JSON.stringify({
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...RULE_TYPES,
    },
    domain: typedData.domain,
    primaryType: "Rule",
    message: Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])),
  });
}

/** Throws unless `signature` is the owner's signature over exactly these terms, as the contract will hash them. */
export async function verifyRuleSignature(vault: Address, terms: RuleTerms, signature: Hex, owner: Address) {
  const typedData = ruleTypedData(vault, terms);
  const signer = await recoverTypedDataAddress({ ...typedData, signature });
  if (signer.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`The signature recovers to ${signer}, not the owner ${owner}.`);
  }
  const onChainDigest = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "hashRule", args: [terms] });
  if (onChainDigest !== hashTypedData(typedData)) {
    throw new Error("The signed typed-data digest does not match the contract's hashRule.");
  }
}

/** Have a developer-controlled Circle wallet sign the rule (the test owner stand-in), and verify it. */
export async function signRuleWithCircle(
  circle: ReturnType<typeof circleClient>,
  { ownerWalletId, owner, vault, terms, memo }: { ownerWalletId: string; owner: Address; vault: Address; terms: RuleTerms; memo: string },
): Promise<Hex> {
  const { data } = await circle.signTypedData({ walletId: ownerWalletId, data: ruleTypedDataJson(vault, terms), memo });
  const signature = data!.signature as Hex;
  await verifyRuleSignature(vault, terms, signature, owner);
  return signature;
}

/** The agent submits an owner-signed rule through Circle. Returns the new rule id. */
export async function addRuleWithCircle(
  circle: ReturnType<typeof circleClient>,
  { agentWalletId, vault, terms, signature }: { agentWalletId: string; vault: Address; terms: RuleTerms; signature: Hex },
): Promise<{ ruleId: bigint; txHash: Hex }> {
  const callData = encodeFunctionData({ abi: vaultAbi, functionName: "addRule", args: [terms, signature] });
  const result = await execute(circle, { walletId: agentWalletId, contract: vault, callData });
  if (result.state !== "COMPLETE" || !result.txHash) {
    throw new Error(`addRule failed in Circle: ${result.state} ${result.errorReason ?? ""} ${result.errorDetails ?? ""}`);
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash: result.txHash });
  const [added] = parseEventLogs({ abi: vaultAbi, logs: receipt.logs, eventName: "RuleAdded" }) as unknown as [
    { args: { ruleId: bigint } },
  ];
  return { ruleId: added.args.ruleId, txHash: result.txHash };
}
