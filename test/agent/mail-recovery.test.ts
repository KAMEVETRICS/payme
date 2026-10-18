import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mailFor, saveMail } from "../../src/web/mail.ts";
import { recoverLegacyMail } from "../../src/web/mail-recovery.ts";

function workspace(t: TestContext) {
  const previous = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "payme-mail-recovery-"));
  process.chdir(root);
  t.after(() => {
    process.chdir(previous);
    if (!root.startsWith(resolve(tmpdir()) + "/payme-mail-recovery-") && !root.startsWith(resolve(tmpdir()) + "\\payme-mail-recovery-")) throw new Error("Unsafe test cleanup");
    rmSync(root, { recursive: true, force: true });
  });
  for (const owner of ["owner-a", "owner-b"]) put(`data/businesses/${owner}.json`, JSON.stringify({ ownerId: owner }));
}

function put(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const source = { kind: "email" as const, from: "accounts@supplier.test", subject: "October invoices", messageId: "<october@supplier.test>", receivedAt: "2026-10-16T14:00:00.000Z" };
function queued(owner = "owner-a", id = "one", file = `data/uploads/${owner}/${id}.pdf`) {
  const path = `data/inbox/${owner}/${id}.done`;
  put(path, JSON.stringify({ id, ownerId: owner, file, source, attempts: 0 }));
  return path;
}

test("processed email parts are recovered as one readable inbox message with the retained attachments", (t) => {
  workspace(t);
  queued(); queued("owner-a", "two");
  put("data/uploads/owner-a/one.pdf", "%PDF-one");
  put("data/uploads/owner-a/two.pdf", "%PDF-two");
  const before = readFileSync("data/inbox/owner-a/one.done", "utf8");
  const result = recoverLegacyMail({ apply: true });
  assert.equal(result.recovered, 1);
  const [mail] = mailFor("owner-a");
  assert.equal(mail.from, "accounts@supplier.test");
  assert.equal(mail.subject, "October invoices");
  assert.equal(mail.receivedAt, "2026-10-16T14:00:00.000Z");
  assert.equal(mail.text, "");
  assert.deepEqual(mail.to, []);
  assert.equal(mail.recovered, true);
  assert.equal(mail.attachments.length, 2);
  assert.deepEqual(mail.attachments.map(a => readFileSync(a.file, "utf8")).sort(), ["%PDF-one", "%PDF-two"]);
  assert.equal(readFileSync("data/inbox/owner-a/one.done", "utf8"), before);
  assert.equal(existsSync("receipts"), false);
});

test("recovery can be previewed and repeated without duplicating messages or overwriting a saved email body", (t) => {
  workspace(t);
  queued(); put("data/uploads/owner-a/one.pdf", "%PDF-one");
  assert.equal(recoverLegacyMail().recovered, 1);
  assert.equal(existsSync("data/mail"), false);
  recoverLegacyMail({ apply: true });
  assert.equal(recoverLegacyMail({ apply: true }).recovered, 0);
  assert.equal(mailFor("owner-a").length, 1);

  queued("owner-b"); put("data/uploads/owner-b/one.pdf", "%PDF-other");
  saveMail("owner-b", { ...source, recipients: ["business@invoices.test"], text: "The original message body.", spam: false, attachments: [] }, "Invoice received.");
  recoverLegacyMail({ apply: true });
  const [original] = mailFor("owner-b");
  assert.equal(original.text, "The original message body.");
  assert.equal(original.recovered, undefined);
  assert.equal(original.attachments.length, 0);
});

test("recovery never imports another owner's attachment or a mismatched queue owner", (t) => {
  workspace(t);
  put("data/uploads/owner-b/private.pdf", "%PDF-private");
  queued("owner-a", "cross-owner", "data/uploads/owner-b/private.pdf");
  const mismatched = queued("owner-a", "mismatched");
  put(mismatched, JSON.stringify({ id: "mismatched", ownerId: "owner-b", file: "data/uploads/owner-b/private.pdf", source, attempts: 0 }));
  const result = recoverLegacyMail({ apply: true });
  assert.equal(result.recovered, 0);
  assert.equal(result.skipped, 2);
  assert.deepEqual(mailFor("owner-a"), []);
  assert.deepEqual(mailFor("owner-b"), []);
});

test("missing old invoice files leave an honest recovered message without a broken download", (t) => {
  workspace(t);
  queued();
  const result = recoverLegacyMail({ apply: true });
  assert.equal(result.recovered, 1);
  assert.equal(result.missingAttachments, 1);
  const [mail] = mailFor("owner-a");
  assert.equal(mail.recovered, true);
  assert.deepEqual(mail.attachments, []);
  assert.equal(mail.text, "");
});
