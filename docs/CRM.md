# CRM: pipeline, clients and inbox

Staff-only pages next to Mission control:

- **/admin/pipeline**: deals on a board, Lead → Proposal sent → Negotiation →
  Won → In build → Shipped. Drag a card or use its stage menu. Lost deals are
  on the clients list, not the board.
- **/admin/clients**: every deal in a table (Active / All / Shipped / Lost).
- **/admin/clients/[id]**: contacts, the deal, stage, one timeline of notes,
  calls, stage moves and email, the next action, and the build card from the
  linked portal project. `?deal=` picks the deal when a client has several.
- **/admin/inbox**: email threads. "Needs a client" at the top is mail from
  senders we don't know yet. File it once and that sender's next email goes
  straight to the client.

Clients, projects and milestones are the portal's own tables: a won deal links
to the project that delivers it, so the milestones staff see here are the ones
the client sees. Every change writes an `events` row, like the rest of the portal.

## Email setup

Nothing here touches MX records. `skoxsoftware.com` mail stays on Google Workspace.

1. **Resend → Domains**: `skoxsoftware.com` must be verified for sending. If
   it asks for an SPF TXT record on the root, merge its `include:` into the
   existing Google SPF record. Never add a second SPF record.
2. **Resend → Emails → Receiving**: copy the `<id>.resend.app` address.
3. **Resend → Webhooks → Add endpoint**:
   `https://portal.skoxsoftware.com/api/webhooks/resend`, event
   `email.received`. Copy the signing secret. Use the production URL: preview
   deployments sit behind Vercel protection and answer 401.
4. **Gmail** (as the CRM mailbox) → Settings → Forwarding → add the
   `.resend.app` address. Google's confirmation code lands in Resend
   (Emails → Receiving), not Gmail. Keep Gmail's copy in the inbox.
5. **Vercel env** (Production):
   - `RESEND_API_KEY`
   - `RESEND_WEBHOOK_SECRET` (`whsec_…`)
   - `CRM_FROM_EMAIL`, e.g. `Reiss at SKOX <reiss@skoxsoftware.com>`
   - `CRM_WORKSPACE_SLUG` only if more than one workspace exists.

## How inbound mail is filed

The webhook carries metadata only. The handler checks the Svix signature
against the raw body, logs the event in `inbound_events` (one row per Resend
email id), then fetches the body and headers from Resend and files it:

1. `In-Reply-To` / `References` naming a message we hold → that thread.
2. Sender is a known contact and the subject matches an open thread → that thread.
3. Sender is a known contact → new thread on their client.
4. Otherwise → new unassigned thread in "Needs a client".

Outbound mail sets its own `Message-ID`, `In-Reply-To` and `References`, so
step 1 catches most replies. Attachments are copied to private Blob storage
because Resend's download links expire.

Mail from `CRM_FROM_EMAIL` or the portal's notification sender (`EMAIL_FROM`)
is dropped on the way in: Gmail forwards our own sends back.

A delivery that was already processed is a no-op. One that failed (500) is
processed again when Resend retries. When something doesn't show up, look at
`inbound_events.error`.

In development, replies are saved but not sent unless `EMAIL_SEND_IN_DEV=1`,
the same rule as the rest of the portal's email.

## Checking it after deploy

1. Send a mail from an outside address to the CRM mailbox. An
   `inbound_events` row appears with `processed_at` set, and the thread shows
   under "Needs a client".
2. File it under a client (or "New lead from this email").
3. Reply from the portal, then reply again from the outside address. The
   second message should join the same thread.
