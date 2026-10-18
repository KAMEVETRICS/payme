import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ChatExchange = { id: string; at: string; message: string; reply: string };
function pathFor(ownerId: string, root: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ownerId)) throw new Error("Invalid chat owner.");
  return join(root, `${ownerId}.jsonl`);
}
export function readChat(ownerId: string, root = "data/chat"): ChatExchange[] {
  const path = pathFor(ownerId, root);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").flatMap((line) => {
    try {
      const value = JSON.parse(line) as ChatExchange;
      return typeof value.id === "string" && typeof value.at === "string" && typeof value.message === "string" && typeof value.reply === "string" ? [value] : [];
    } catch { return []; }
  }).slice(-100);
}
export function saveExchange(ownerId: string, exchange: ChatExchange, root = "data/chat"): ChatExchange {
  const path = pathFor(ownerId, root);
  const existing = readChat(ownerId, root).find((e) => e.id === exchange.id);
  if (existing) return existing;
  mkdirSync(root, { recursive: true });
  const separator = existsSync(path) && !readFileSync(path, "utf8").endsWith("\n") ? "\n" : "";
  appendFileSync(path, `${separator}${JSON.stringify(exchange)}\n`);
  return exchange;
}
