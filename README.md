# SKOX Client Portal

One link for a client's whole relationship with SKOX: the delivery date, weekly
updates, what we need from them, previews, and (in later phases) feedback,
approvals, signatures and payments.

Live at **https://portal.skoxsoftware.com**. Plan: the "SKOX Client Portal
Blueprint" (phase 1).

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16 (App Router), deployed on Vercel (SKOX account) |
| Database | Neon Postgres (`skox-client-portal`, AWS us-east-2, database `portal`) + Drizzle |
| Sign-in | Neon Auth (Managed Better Auth): 6-digit email codes |
| Styling | Plain CSS with the skoxsoftware.com tokens (`app/globals.css`) |

## How access works

- **Sign-in proves who someone is; `memberships` decides what they can do.**
  Rules live in `lib/permissions.ts` (tested in `lib/permissions.test.ts`) and
  are enforced on the server for every page and action through `lib/access.ts`.
- **Staff** have a membership with no client (`staff_owner` / `staff`).
  **Clients** have `client_approver` or `client_member` on one client.
- **Invitations are memberships keyed by email.** They attach to an account the
  first time someone signs in with that address, and only if the address is
  verified (entering an emailed code verifies it), so nobody can claim an invite by signing up
  with someone else's email and a password.
- `proxy.ts` only redirects signed-out visitors; it is not the security layer.

Every table carries `workspace_id` (SKOX is one workspace), and every change
writes an `events` row in the same batch: that is the audit trail.

## Develop

```sh
npm install
cp .env.example .env.local   # fill in DATABASE_URL, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET
npm run dev                  # http://localhost:3300
npm test                     # permission and date rules
npm run lint
npm run build
```

Schema changes: edit `lib/db/schema.ts`, then

```sh
npm run db:generate          # writes SQL to drizzle/
npm run db:migrate           # applies it to the database in .env.local
```

Review generated SQL before migrating production.

## Deploy

Deploys use the Vercel CLI from the SKOX account (`npx vercel deploy --prod`).
Production env vars: `DATABASE_URL`, `NEON_AUTH_BASE_URL`,
`NEON_AUTH_COOKIE_SECRET`, `PORTAL_URL=https://portal.skoxsoftware.com`.
Don't run `vercel link` here: it rewrites `.env.local`.

Release accounts: GitHub CLI must use `skox-software`; Vercel CLI must use
`founders@skoxsoftware.com` (`founders-8267`) in the `skox` Hobby team.
Check `gh api user --jq .login` and `npx vercel whoami` before releasing.
This repository uses the company Git identity (set locally, not globally):

```sh
git config --local user.name skox-software
git config --local user.email 328514113+skox-software@users.noreply.github.com
```

Apply reviewed database migrations before deploying code that reads new columns.
Meeting booking setup and validation are documented in [docs/MEETINGS.md](docs/MEETINGS.md).
The CRM (pipeline, clients, inbox) and its email setup are in [docs/CRM.md](docs/CRM.md).

## Neon Auth settings that live in the Neon Console

- Sign-in uses the **Email OTP** endpoints (on by default). The Magic Link
  plugin is off in this project; don't switch the portal back to links unless
  it's enabled there.
- Trusted domains: `https://portal.skoxsoftware.com` and `http://localhost:3300`.
- Production email: your own SMTP provider rather than Neon's shared sender.

## What's built

See [docs/ROADMAP.md](docs/ROADMAP.md) for everything shipped and what's next.
Client project tabs: Overview, Meetings, Review, Documents, Files, Billing, Requests,
Results. Staff controls live on the same pages, marked "SKOX only".

Services: Resend (email from portal@skoxsoftware.com), Vercel Blob (private
store `skox-portal-files`), Vercel Cron (`/api/cron/reminders`, daily), and
optional Stripe Checkout (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
