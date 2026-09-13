# Client onboarding: "Welcome to SKOX"

The client said yes on the call. From there, one email address starts
everything, and every material, question and signature lives in the portal.

**North star:** the client should finish feeling *heard, organized and
excited*, in about 15 minutes, on their phone if they want.

## When to start it
The same day they say yes, ideally within the hour, while the decision is
fresh. The **agreement and deposit come first** in the flow (right after a
short welcome): a client who has signed and paid feels committed. Longer
questions come after, when they can't feed second thoughts.

Protecting the decision:
- No empty video slot: the welcome shows a written note until a video is set.
- No guessed launch date: "set together at kickoff" until SKOX confirms it.
- Positive recap wording ("Yes, that's it" / "Almost, I'd add something").
- No prices on the welcome; reminders point to the next step, never "are you
  still interested?".
- One welcome email. The agreement doesn't send its own "please sign" email.

## What SKOX does manually
**Once:** Workspace settings in mission control: kickoff booking link
(Google appointment schedule, or an existing external link), team intro line, welcome video (optional, later). Keep a
lawyer-reviewed agreement template ready to fill in.

**Per client (about 5 minutes):**
1. Mission control → Onboard a new client → their email + 3–4 lines of recap.
2. Attach the filled-in agreement PDF and the deposit amount.
3. Send the welcome.

**At kickoff:** read the brief, confirm the launch date (Manage project → move
the date; that clears "set at kickoff").

## 1. Staff: start onboarding
`/admin/onboard` → `/admin/onboard/[projectId]`
- Required: client email. Optional: their name, company, project name and
  type, target delivery date, **call recap** ("what we heard"), internal notes.
- Creates the client, their approver login, the project, and the onboarding
  record, but **sends nothing yet**. The next screen attaches the agreement
  (quietly) and deposit, previews the client view, then sends one welcome.
- Pipeline: draft / not opened / progress, idle flag, recap flag, resend,
  copy link, brief.

## 2. Client: the welcome flow
`/projects/[id]/welcome`. One focused screen per step, autosaved per step,
resumable, skippable. Progress bar with minutes left.

| Step | What they do | Why it matters |
| --- | --- | --- |
| Welcome | Founders' video (optional), what happens next, **confirm our call recap** or correct it | Feeling heard; alignment on day one |
| You | Name, role, phone, preferred contact + best times, company name, website | We know how to reach the right person |
| Team | Invite teammates; name who approves, signs and pays | No chasing the wrong person later |
| Project | Core brief + questions tailored to the project type | Everything a kickoff needs, in their words |
| Brand | Upload logos/guides, pick colours, fonts, 3 tone words, **live preview** of their product in their brand; "no brand yet" option | Delight + real design inputs |
| Access | Checklist tailored to the project; each with "add founders@ as a user, never share passwords"; mark done / need help / not needed | Security and zero back-and-forth |
| Agreement & deposit | Existing sign → pay flow (shown only if attached) | Money and paperwork, painless |
| Kickoff | Book in the Google embed (legacy links open externally); manually confirm booking; agenda built from their answers | A kickoff that's already productive |
| All set | Celebration, summary, next dates | The feeling they tell friends about |

Skipped steps become to-dos on their Overview (uploads tick themselves off).

## 3. Staff: the project brief
`/admin/projects/[id]/brief`: recap confirmation, contact, team roles, all
answers, brand kit with swatches and files, access status, kickoff choice.
Printable.

## 4. Automation
- Welcome email on start; reminders to the client after 2 days idle
  (max 3, spaced 3 days); staff alert after 5 days idle.
- Staff alerted instantly when the recap is flagged, and when onboarding
  completes (with a link to the brief).
- On completion: SKOX to-dos "Review the project brief" and "Confirm delivery
  date at kickoff"; client's skipped items become to-dos.
- Mission control: onboarding in progress, stuck, flagged, completed.

## 5. Settings
Workspace: scheduling link (Cal.com/Calendly), welcome video URL, founders'
intro line.

## Data
- `onboardings` (one per project): invited email, recap + confirmation,
  step states, contact, answers, brand, access, kickoff choice, timestamps.
- `files.category` (logo, brand, content, other) for the brand kit.
- `projects.date_tentative` so the client sees "Target date" until kickoff.
- `workspaces.scheduling_url`, `welcome_video_url`, `team_intro`.

Meeting setup and release checks: [Google appointment booking](MEETINGS.md).
