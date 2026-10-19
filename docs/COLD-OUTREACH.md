# Cold outreach release gate

Outreach is OFF by default. Do not set COLD_OUTREACH_ENABLED=true until the owner supplies a valid registered postal address and the following checks pass. Never substitute a placeholder address.

1. Apply migrations 0019 and 0020 before deploying. 0020 retains existing opt-outs in the independent outreach_recipients table. Do not delete recipient records when deleting deals.
2. Deploy with COLD_OUTREACH_ENABLED=false; leave SKOX_POSTAL_ADDRESS unset while the mailbox is unavailable. Verify Pipeline shows Sending blocked and prospect Inbox replies fail without provider calls. Transactional client messages use the existing channel.
3. Configure SKOX_POSTAL_ADDRESS with the owner's real address. Configure UNSUBSCRIBE_SECRET securely; retain it for all sent links (at least 30 days after the last message; preferably indefinitely). Never rotate it without supporting old links.
4. Verify outreach.skoxsoftware.com in Resend and its SPF/DKIM/DMARC configuration. Configure OUTREACH_RESEND_API_KEY restricted to that domain. The gateway sends as reiss@outreach.skoxsoftware.com and replies go to reiss@skoxsoftware.com. This separation does not guarantee reputation isolation from the parent domain.
5. Verify PORTAL_URL reaches the public /u/<token> route without authentication. On a test recipient, verify both GET and one-click POST suppress that address. Editing/deleting the deal or creating a new one must not restore permission. Links have no time expiry. Suppression applies to all SKOX outreach, across workspaces.
6. Review the actual rendered footer: Advertisement from SKOX Software, full postal address, clear reply opt-out and HTTPS unsubscribe link. Verify List-Unsubscribe and List-Unsubscribe-Post headers. Review subject and body for truthful claims.
7. Only after those checks, explicitly enable outreach. Test with owned recipient addresses first.

All prospect emails, including Inbox follow-ups, must use sendColdOutreach. Provider-side scheduling is deliberately unsupported: a future queue must call this gateway at dispatch, not enqueue messages with the provider in advance. Never run old direct-Resend outreach scripts. Existing temporary send/requeue scripts used for the October 19 campaign have been retired locally. Keep transactional credentials out of outreach jobs; application safeguards cannot constrain arbitrary scripts possessing a provider key.

Monitor reply-based opt-outs and record them using Do not email immediately (legal maximum: 10 business days). Keep the address suppression record permanently. Do not transfer suppressed addresses for marketing. True transactional invoices and login messages are separate from marketing; adding promotional content requires review.

The October 19 campaign already sent before these protections. Do not resend it. Its four bounced recipients must be verified before any later outreach; provider suppression remains in force.
