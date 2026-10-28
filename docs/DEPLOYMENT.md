# Shared portal source and deployment

The shared source repository is `skox-software/portal`. Both maintainers should fetch and pull `main` before starting new work; keep feature work on separate branches and merge reviewed changes through pull requests.

## Recovered production baseline

On October 17, 2026, the source files from the active Vercel production deployment `dpl_GNHzEhCzbpo7ZFfK8pnxR6vCufSr` were recovered into this repository. That deployment was created on October 16 through the Vercel CLI, outside GitHub. The project is `skox-client-portal`, owned by the `skox` team. The publishing account is `founders@skoxsoftware.com` (plural).

The application is mounted at `/portal`. The marketing site forwards those requests to this project. Its public address is `https://www.skoxsoftware.com/portal`; the project also owns `portal.skoxsoftware.com`.

The recovered version includes the existing admin sidebar, overview, pipeline, client directory, inbox, billing, requests, activity, settings, and Stripe payment work. Older CRM files absent from the deployed version were removed from the current tree; their history remains in Git.

No production database migration is required merely to synchronize this source snapshot. Do not replay the older, divergent CRM migration history against the live database. Database changes must be reviewed against the current deployed schema and migration journal.

## Git deployment connection

Vercel is connected to `skox-software/portal`, with `main` as its production branch. Branch pushes create previews; merges to `main` publish production. Run CI and review the preview before merging. Avoid deploying uncommitted local edits directly, which would put production ahead of GitHub again.

## Verification and release

Run `npm install --no-audit --no-fund`, `npm test`, `npm run lint`, and `npm run build`. CI runs the same checks without production secrets.

Before any release, confirm the Vercel account, team, project, and source commit. Deploy from a clean committed checkout. Test a preview before promoting production. Keep credentials and environment files outside Git.

The sales rep portal (`/rep`, `/admin/reps`, `/admin/commissions`; see [REPS.md](REPS.md)) went to production on October 17 by CLI deploy from commit 7aaeb12. Its migration 0013 is already applied to the live database. The recovered baseline above was identical to that commit's parent, so the two histories were merged with the rep portal code kept. From here on, `main` matches production.

## Cutover to gounbusy.com

The portal names its public addresses in one place, `lib/brand.ts`, and reads every one from the environment. Unset, each falls back to today's skoxsoftware.com value, so the UnBusy rebrand can ship before the domain moves. The move itself is a configuration change, done in this order on the same day as the marketing site.

| Variable | Cutover value | Used for |
| --- | --- | --- |
| `PUBLIC_SITE_URL` | `https://gounbusy.com` | The marketing site: share-image base, links back to the site |
| `PORTAL_URL` | `https://gounbusy.com/portal` | Every link in an email, the welcome guide, status and referral links, unsubscribe links, Stripe Checkout's return URL |
| `EMAIL_FROM` | `UnBusy <portal@gounbusy.com>` | The From line of every portal email |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | the founders' gounbusy.com address | "Email us" on error pages, invoices, the welcome guide, and the Reply-To of portal email (unless `EMAIL_REPLY_TO` is set) |

The values are read when the server starts, and `NEXT_PUBLIC_SUPPORT_EMAIL` is built into the browser bundle, so a redeploy is needed after changing them.

1. **Resend.** Add `gounbusy.com` as a sending domain. Resend lists an SPF TXT record, a DKIM TXT record and an MX record for the bounce subdomain; add them exactly as shown to the gounbusy.com DNS (wherever the domain's nameservers point; Vercel DNS if it is managed there). Wait until Resend shows the domain as Verified. Do not remove `skoxsoftware.com`: it keeps sending until the variables change, and cold outreach still sends from `outreach.skoxsoftware.com`.
2. **Neon Auth.** In the Neon console, Auth, add `https://gounbusy.com` (and `https://www.gounbusy.com`) to the trusted domains. Without it the sign-in code email links and callbacks from the new address are refused. Keep the skoxsoftware.com entries for old bookmarks.
3. **Vercel, marketing project (`skox`).** Rewrite `/portal` and `/portal/:path*` on gounbusy.com to this project's production deployment, exactly as skoxsoftware.com forwards them today. Keep `skoxsoftware.com/portal/:path*` working with a permanent redirect to `https://gounbusy.com/portal/:path*`, so every link already emailed still lands.
4. **Vercel, this project (`skox-client-portal`).** Set the four variables above for Production. Server actions only accept forms posted from the hosts in `PUBLIC_SITE_URL` and `PORTAL_URL` (plus the old skoxsoftware.com hosts, kept for open tabs), so the new host has to be in those variables before anyone submits a form from it. Redeploy production.
5. **Smoke test** on `https://gounbusy.com/portal`: sign in with an emailed code; trigger an email (invite yourself to a test project) and check it arrives from `portal@gounbusy.com` with working links and the logo; open an invoice's Pay link and confirm Stripe returns to `gounbusy.com/portal/.../billing/paid`; open an old `https://www.skoxsoftware.com/portal/...` link and confirm it redirects; download a welcome guide and check its footer address.

Not part of the cutover: the preview sites stay on `previews.skoxsoftware.com`, and cold outreach keeps its `outreach.skoxsoftware.com` sender and SKOX wording until Josh decides what happens to the website outreach tools.
