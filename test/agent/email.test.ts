import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { inboxKeyFrom, invoiceAddress, invoiceFiles, type InboundFile } from "../../src/web/email.ts";

describe("invoice addresses", () => {
  const key = "k3x9q2m7p1z4";
  it("names the business on our own inbound domain, and reads the key back", () => {
    const address = invoiceAddress(key, "Owner Test Imports Ltd.", { domain: "invoices.example.com" })!;
    assert.equal(address, `owner-test-imports-ltd-${key}@invoices.example.com`);
    assert.equal(inboxKeyFrom(address, "invoices.example.com"), key);
    assert.equal(inboxKeyFrom(address.toUpperCase(), "INVOICES.EXAMPLE.COM"), key);
  });
  it("uses plus addressing on a provider's shared address", () => {
    const address = invoiceAddress(key, "Acme", { address: "abc123@inbound.postmarkapp.com" })!;
    assert.equal(address, `abc123+${key}@inbound.postmarkapp.com`);
    assert.equal(inboxKeyFrom(address), key);
  });
  it("finds no key in an ordinary address", () => {
    assert.equal(inboxKeyFrom("accounts@lagosprints.test", "invoices.example.com"), null);
    assert.equal(invoiceAddress(key, "Acme", {}), null);
  });
});

const file = (name: string, contentType: string, bytes = 100): InboundFile => ({ name, contentType, content: Buffer.alloc(bytes) });
const names = (files: InboundFile[]) => files.map((f) => f.name);

describe("invoiceFiles", () => {
  it("takes only the PDFs when an email has any", () => {
    const picked = invoiceFiles([file("logo.png", "image/png", 50_000), file("INV-1.pdf", "application/pdf"), file("terms.txt", "text/plain")], "Invoice", "");
    assert.deepEqual(names(picked), ["INV-1.pdf"]);
  });
  it("skips small images such as signature logos but keeps scans", () => {
    const picked = invoiceFiles([file("sig.png", "image/png", 4_000), file("scan.jpg", "image/jpeg", 400_000)], "Invoice attached", "");
    assert.deepEqual(names(picked), ["scan.jpg"]);
  });
  it("ignores attachment types that cannot be invoices", () => {
    assert.deepEqual(names(invoiceFiles([file("meeting.ics", "text/calendar"), file("sig.png", "image/png", 2_000)], "Hello", "See you")), []);
  });
  it("reads the body only when it looks like an invoice", () => {
    const body = invoiceFiles([], "Invoice INV-77", "Amount due: USD 120.00\nPay to 0xabc");
    assert.equal(body.length, 1);
    assert.match(body[0].content.toString(), /Subject: Invoice INV-77/);
    assert.deepEqual(invoiceFiles([], "Lunch?", "Are you free on Friday?"), []);
  });
  it("matches content types regardless of case", () => {
    assert.deepEqual(names(invoiceFiles([file("INV.PDF", "Application/PDF")], "", "")), ["INV.PDF"]);
  });
});
