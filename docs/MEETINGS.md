# Google appointment booking

The portal embeds Google appointment schedules in Meetings and the kickoff onboarding step. It does not connect to the Calendar API or synchronize events. Kickoff confirmation remains client-reported. Invitations, meeting links, and booking management live in Google and its confirmation emails.

## Current SKOX configuration (September 13, 2026)

All three portal meeting types use the existing **Check-In with Skox** Google schedule, with 30-minute calls and Google Meet. Both founders block their busy time on founders@skoxsoftware.com; conflict checking uses that shared calendar. Availability and booking rules are managed in Google Calendar. The same canonical embed URL is saved in all three workspace booking fields. The Gmail signature uses https://calendar.app.google/G91sfEJ7PQ8jQxVw7.

This single-schedule choice supersedes the separate 45/30/15-minute setup below. Do not create extra schedules or change the current availability to match the historical plan.

## Original separate-schedule plan (superseded)

1. Confirm the SKOX Google account and shared calendar to use. Multiple schedules and secondary-calendar scheduling require an eligible Workspace plan: https://support.google.com/calendar/answer/16287038?hl=en. Do not upgrade or purchase a plan automatically.
2. On that same calendar, create Kickoff (45 minutes), Project review (30 minutes), and Check-in (15 minutes), all with Google Meet.
3. Set each to Monday–Friday, 10 AM–4 PM in America/New_York, 24 hours minimum notice, 15-minute buffers, and a 30-day booking window. Enable calendar conflict checking on all three. Busy events must be present on this shared calendar; this setup does not check each founder's calendar.
4. Add a required Company / project booking-form field. Enable available Google email reminders (start with 24 hours and 1 hour before). Confirm the displayed account/calendar name is appropriate for clients. Google booking pages are accessible to anyone with their link; portal login does not restrict the Google page itself.
5. Test a booking using an authorized SKOX test attendee. Verify the event, Meet link, timezone, confirmation email, management links, and that the slot disappears from the other schedules. Cancel the test booking and confirm availability returns. Check rescheduling too, including daylight-saving dates, buffers, notice, and booking horizon.
6. Copy the iframe src URL from Sharing options → Website embed → Inline booking page. Do not paste HTML or the calendar.app.google short link. Reference: https://support.google.com/calendar/answer/10733297?hl=en.
7. Apply the additive migration with `npm run db:migrate` to the verified deployment database before deploying the new code. It adds nullable workspace settings without changing onboarding data.
8. In Mission control → Workspace settings, save the three verified links. Leave a type blank until ready; clients see a request-a-meeting fallback. Existing kickoff HTTPS links continue to work externally.

## Checks

Run `npm test`, `npm run lint`, and `npm run build`. Verify unauthorized visitors are redirected to sign-in, unrelated clients cannot access the project, and clients cannot change staff settings. Check Meetings and onboarding on desktop and mobile with keyboard navigation; one iframe should be present, only for the selected meeting. Always keep the external link available because cross-origin frame failures cannot be reliably detected by the portal.

No confirmation is inferred from loading or closing an iframe. Keep the manual kickoff selection, notes, reach-out option, and existing agreement/deposit steps. Existing 15-minute onboarding and 1-minute booking-step estimates describe form completion, not meeting lengths.

Google is the source of truth for meeting lengths; the portal labels in `lib/meetings.ts` are all 30 minutes. If staff later change the duration in Google, update these labels to match.

## Rollback

Clear the new scheduling links to disable booking. Preserve the nullable columns if rolling application code back; do not drop live workspace data. No OAuth credentials or recurring sync job need revocation.
