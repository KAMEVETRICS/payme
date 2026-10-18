import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readChat, saveExchange } from "../../src/web/chat-store.ts";
import { validateMessage, answerChat } from "../../src/web/chat.ts";

test("chat accepts trimmed messages and rejects empty, oversized and non-text input", () => {
  assert.equal(validateMessage("  What is due?  "), "What is due?");
  for (const input of ["  ", null, {}, "a".repeat(4001)]) assert.throws(() => validateMessage(input));
});

test("chat exchanges persist per owner, duplicate requests are not appended, and partial lines are ignored", (t) => {
  const root = mkdtempSync(join(tmpdir(), "payer-chat-test-"));
  t.after(() => { if (!resolve(root).startsWith(resolve(tmpdir()) + "\\payer-chat-test-") && !resolve(root).startsWith(resolve(tmpdir()) + "/payer-chat-test-")) throw new Error("Unsafe test cleanup"); rmSync(root, { recursive: true, force: true }); });
  const turn = { id: "turn-1", at: "2026-10-17T12:00:00Z", message: "What is due?", reply: "One invoice needs review." };
  saveExchange("owner-a", turn, root);
  saveExchange("owner-a", turn, root);
  appendFileSync(join(root, "owner-a.jsonl"), '{"partial":');
  assert.deepEqual(readChat("owner-a", root), [turn]);
  assert.deepEqual(readChat("owner-b", root), []);
  assert.throws(() => readChat("../owner-a", root));
});

test("agent replies are returned as text; malformed model output is not accepted", async () => {
  assert.equal(await answerChat("Hello", { business: "Test" }, [], async () => ({ value: { reply: "  Hello.  " }, model: "test" })), "Hello.");
  await assert.rejects(answerChat("Hello", {}, [], async () => ({ value: { reply: "" }, model: "test" })));
  await assert.rejects(answerChat("Hello", {}, [], async () => ({ value: { reply: { execute: "pay" } }, model: "test" })));
});
