# SKOX Client Portal roadmap

Goal: a client can do **everything** with SKOX in one place (follow the build,
give feedback, approve, sign, pay, send files, ask for changes, see results)
and enjoy it enough to stay on a care plan and refer friends.

Every page answers three questions:

| Before launch | After launch |
| --- | --- |
| When will it be done? | Is it healthy? |
| What's new? | What did it do for me this month? |
| What do you need from me? | What should we do next? |

## Shipped

### Phase 1: foundation (2026-09-12)
Sign-in with 6-digit email codes, clients and invitations, projects with
milestones, delivery date with reasons, tasks, weekly updates, audit log.

### Phase 2: one-stop shop (2026-09-13)
- **Overview**: greeting, one-line status, progress ring, unified *Your to-do*
  (sign, approve, pay, reply, tick off tasks, react to ideas), *Since your last
  visit*, read-only status link for bosses and boards.
- **Review**: SKOX posts design rounds; clients drop numbered pins on the
  design (Change / Must fix / Love it); approvers approve or request changes.
- **Documents & e-signature**: PDF sent to named signers, typed-name signature
  with consent, IP/device/time recorded, SHA-256 fingerprint checked at signing,
  signed copy with a signature certificate. Reminders every 3 days.
- **Files**: private uploads both ways (Vercel Blob, private store).
- **Billing**: invoices with due/overdue states, Pay now (Stripe Checkout when
  `STRIPE_SECRET_KEY` is set, else any pay link), auto-mark paid via webhook,
  reminders when due soon or overdue.
- **Requests**: "Request a change" with priority, threaded replies, status.
- **Results**: monthly report (visitors, leads, uptime, speed, trend lines),
  care plan with hours meter, "What we could build next" ideas with one-click
  interest, launch kit, referral link, review ask.
- **Mission control**: needs-attention queue, client health score, KPIs,
  referrals inbox, growth settings.
- **Email**: branded emails for every step via Resend (portal@skoxsoftware.com).

### Phase 3, slice 1 (2026-09-13)
- **Friday recap email** per client person and project (skipped when there's
  nothing new and nothing waiting).
- **Email preferences** page (click your email in the top bar).
- **Kickoff checklist**: every new project starts with logo/brand files,
  access, and content as client to-dos.
- **Walkthrough videos** (Loom, YouTube, Vimeo) play inline in updates.

### Phase 3, slice 2 (2026-09-13)
- **Get started flow**: a deposit invoice can be tied to an agreement. It stays
  locked until the agreement is signed, the client sees a 3-step card
  (sign → pay → we build), signing shows "Next: pay the deposit", and paying
  (Stripe or staff "mark paid") moves the project from Kickoff to Building,
  ticks the kickoff milestone and emails everyone.
- **Self-ticking to-dos**: "upload" checklist items complete when the client
  uploads a file.
- **Client team invites**: approvers invite teammates (view/comment or
  approve/sign/pay) and remove members from the Overview.

### Phase 3, slice 3: client onboarding (2026-09-13)
See [ONBOARDING.md](ONBOARDING.md). One email starts it; the agreement and
deposit come first; a calm, animated setup (vision card, call recap to
confirm, tailored project brief, brand studio with live preview, access
checklist, kickoff agenda); skipped steps become to-dos; reminders and staff
alerts; the printable project brief; launch dates "set at kickoff" until
confirmed.

### Sales pipeline (2026-09-22)
`/admin/pipeline`: a drag-and-drop board (Lead → Proposal sent → Negotiation →
Won → In build → Shipped) that reads the portal's own data. Projects place
themselves by status (kickoff = Won, launched = Shipped) with invoiced value,
milestone progress, due and paid state; unworked referrals appear as leads.
Only pre-sale deals live in the new `deals` table. "Start onboarding" on a Won
deal prefills the onboarding form and links the new project to the deal, which
keeps its owner, contact and agreed value. Moving a project card changes the
project's status, the same as its status menu.

### Clients list and Inbox (2026-09-25)
- **Clients** (`/admin/clients`): every account in one table (leads, deals,
  clients, shipped and lost) with contact, stage, value, days in stage,
  lead source, owner and last touch. Filters: All / Active / Shipped / Lost.
  Industry, location and lead source live on the deal.
- **Inbox** (`/admin/inbox`): email threads with clients and leads. Mail
  arrives by Resend inbound (`/api/inbound/resend`); a Google Workspace
  routing rule copies the team's mail to the receiving address. Threads file
  themselves by contact or company domain; the rest wait under "Needs a
  client" until assigned, and the address is remembered. Replies send from the
  staff member's own address, threaded, with a copy to their mailbox.
  Needs: `RESEND_WEBHOOK_SECRET`, `RESEND_INBOUND_API_KEY`, `INBOX_COPY_ADDRESS`.

### Sales rep portal and commissions (2026-10-16)
See [REPS.md](REPS.md). Outside 1099 reps sign in to `/rep`, a separate area
with only their leads and their money. They work leads SKOX assigns, submit
their own (first to submit wins), and mark scope calls booked. SKOX closes. Each
paid invoice on a client project credits the project's rep at their rate
(10–20%), care plans included. Refunds claw back, and months close into
statements the owner approves and marks paid. Staff manage reps at
`/admin/reps` and money at `/admin/commissions`. Migration 0013.

## Next

### Phase 3, remaining
1. **Stripe**: saved payment method for care plans, auto-billed monthly;
   receipts in Billing; ACH for large invoices. Needs a Stripe account.
2. **Kickoff questionnaire**: a short form (goals, audience, must-haves) whose
   answers land in Files and tick a to-do.
3. **Proposal page**: pricing options the client picks before the agreement
   is generated.

### Phase 4: results that sell renewals
1. **Live metrics**: connect Google Analytics / Plausible and uptime monitoring
   so monthly reports fill themselves.
2. **Quarterly business review** page generated from reports and requests.
3. **Care plan usage alerts** at 80% of hours.
4. **Case-study consent** at launch (one click), feeding skoxsoftware.com.

### Phase 5: product-grade
1. Team roles on the client side (billing contact vs approver).
2. Custom domain + white-label per workspace (portal as a product).
3. MFA for staff when Neon Auth supports it; audit log viewer.
4. Mobile push / PWA install.

## Operating notes
- Emails send only in production (or with `EMAIL_SEND_IN_DEV=1`).
- Required env: `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`,
  `PORTAL_URL`, `RESEND_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`.
- Optional: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (endpoint
  `/api/stripe/webhook`, events `checkout.session.completed` and
  `checkout.session.async_payment_succeeded`), `EMAIL_FROM`, `EMAIL_REPLY_TO`.
