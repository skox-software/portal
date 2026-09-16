# Billing hub

Owner entry: `/portal/admin/billing` (Billing in the main navigation). Project entry: `/portal/projects/[id]/billing`.

- Create an invoice without emailing, or create and email it to client approvers. Creating makes it visible in the client portal; this is not a hidden draft.
- Email an existing open invoice, copy its payment link, and inspect delivery history recorded by the new send action.
- Invoice details and paid receipts have a print/save-PDF view. They remain protected by project membership.
- Payment links lead to invoice details. Billing destinations survive email-code sign-in, with server-side validation to prevent external redirects.
- Staff may open embedded Checkout only with test keys. Client approvers may pay; view-only members may not. Page, navigation action, and checkout-secret action enforce the same rule.
- Project Billing shows the next payment, invoiced/paid/outstanding totals, unpaid invoices, paid receipts, and a contextual billing-question link to Requests.
- Deposits linked to agreements remain locked until signed. The existing Stripe webhook handles settlement and kickoff.

## Current deployment

Stripe remains in sandbox mode. Deploying the app to production does not switch the Stripe account or keys to live mode. Sandbox payments still change portal invoice/project records, and explicitly sending an invoice sends real email. Use a test project.

## Validation

`npm run lint`, `npm test` (37 tests), `npm run build`, and `npx tsc --noEmit` passed before release. Added tests cover staff sandbox-only checkout, payment authorization, and safe sign-in destinations. No client payment was submitted and no client invoice email was sent by the agent.
