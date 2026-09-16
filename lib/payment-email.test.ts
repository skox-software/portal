import assert from "node:assert/strict";
import { test } from "node:test";
import { paymentEmailDetails } from "./payment-email.ts";
import { renderEmail } from "./email.ts";

test("payment notice uses the actual payer and the project's company", () => {
  const details = paymentEmailDetails({
    id: "cs_test_example", customer_email: "invited@example.com",
    customer_details: { individual_name: "Alex Payer", name: "Billing Name", email: "alex@example.com", business_name: "Other billing name", address: null, phone: null, tax_exempt: null, tax_ids: [] },
  }, "Acme & Co", "Website");
  assert.equal(details.find(d => d.label === "Company")?.value, "Acme & Co");
  assert.equal(details.find(d => d.label === "Paid by")?.value, "Alex Payer");
  assert.equal(details.find(d => d.label === "Payer email")?.value, "alex@example.com");
});

test("old sessions never attribute a payment to an assumed company contact", () => {
  const details = paymentEmailDetails({ id: "cs_old", customer_details: null, customer_email: "payer@example.com" }, "Acme", "Website");
  assert.equal(details.find(d => d.label === "Paid by")?.value, "Name not provided");
  assert.equal(details.find(d => d.label === "Payer email")?.value, "payer@example.com");
});

test("email details are escaped in HTML and readable in plain text", () => {
  const { html, text } = renderEmail({ subject: "Receipt", heading: "Payment received", preheader: "Thank you", paragraphs: [], details: [{ label: "Company", value: '<script>alert("x")</script> & Co' }] });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(text.includes('Company: <script>alert("x")</script> & Co'));
});
