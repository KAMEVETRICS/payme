import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseRawEmail } from "../../src/web/raw-email.ts";

const pdf = Buffer.from("%PDF-1.4 test invoice");
const raw = Buffer.from(
  [
    "From: Lagos Prints Accounts <accounts@lagosprints.test>",
    "To: Owner <owner@example.test>",
    "Subject: Invoice INV-LP-009",
    "Message-ID: <inv-lp-009@lagosprints.test>",
    "Date: Sat, 17 Oct 2026 09:00:00 +0000",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b1"',
    "",
    "--b1",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Please find our invoice attached.",
    "--b1",
    'Content-Type: application/pdf; name="INV-LP-009.pdf"',
    'Content-Disposition: attachment; filename="INV-LP-009.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    pdf.toString("base64"),
    "--b1",
    'Content-Type: image/png; name="logo.png"',
    "Content-Disposition: inline",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.alloc(64).toString("base64"),
    "--b1--",
    "",
  ].join("\r\n"),
);

describe("parseRawEmail", () => {
  it("reads sender, subject, id, body and attachments", async () => {
    const mail = await parseRawEmail(raw);
    assert.equal(mail.from, "accounts@lagosprints.test");
    assert.equal(mail.subject, "Invoice INV-LP-009");
    assert.equal(mail.messageId, "<inv-lp-009@lagosprints.test>");
    assert.match(mail.text, /invoice attached/);
    const invoice = mail.attachments.find((a) => a.contentType === "application/pdf");
    assert.equal(invoice?.name, "INV-LP-009.pdf");
    assert.deepEqual(invoice?.content, pdf);
    assert.equal(mail.spam, false);
  });
  it("includes the envelope recipient, which forwarded and Bcc'd mail does not show in its headers", async () => {
    const mail = await parseRawEmail(raw, { to: "acme-k3x9q2m7p1z4@invoices.example.com" });
    assert.ok(mail.recipients.includes("acme-k3x9q2m7p1z4@invoices.example.com"));
    assert.ok(mail.recipients.includes("owner@example.test"));
  });
});
