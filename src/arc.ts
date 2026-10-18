// Shared Arc testnet setup for the scripts.
import { readFileSync } from "node:fs";
import { createPublicClient, http, type Abi, type Address, type Hex } from "viem";
import { arcTestnet } from "viem/chains";

export { arcTestnet };

// USDC's ERC-20 interface on Arc (6 decimals). Same address on testnet and mainnet.
export const USDC: Address = "0x3600000000000000000000000000000000000000";
// Circle's euro stablecoin on Arc testnet (6 decimals). https://docs.arc.io/arc/references/contract-addresses
export const EURC: Address = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

/** The stablecoins a vault can pay in, and the invoice currencies each one settles. */
export const TOKENS = {
  USDC: { address: USDC, currencies: ["USD", "USDC"] },
  EURC: { address: EURC, currencies: ["EUR", "EURC"] },
} as const;
export type TokenSymbol = keyof typeof TOKENS;
export const TOKEN_SYMBOLS = Object.keys(TOKENS) as TokenSymbol[];

/** The token that settles an invoice currency ("EUR" -> "EURC"), or null if none does. */
export function tokenForCurrency(currency: string): TokenSymbol | null {
  const code = currency.trim().toUpperCase();
  return TOKEN_SYMBOLS.find((s) => (TOKENS[s].currencies as readonly string[]).includes(code)) ?? null;
}

/** "USDC" or "EURC" for a token address; null for anything else. */
export function tokenSymbol(address: string): TokenSymbol | null {
  return TOKEN_SYMBOLS.find((s) => TOKENS[s].address.toLowerCase() === address.toLowerCase()) ?? null;
}

export const transport = http(process.env.ARC_TESTNET_RPC_URL ?? arcTestnet.rpcUrls.default.http[0]);
export const publicClient = createPublicClient({ chain: arcTestnet, transport });
export const explorer = arcTestnet.blockExplorers.default.url;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

export function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(`artifacts/contracts/${name}.sol/${name}.json`, "utf8"));
  return { abi: json.abi, bytecode: json.bytecode };
}
