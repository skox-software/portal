# The Floor

`/admin/floor` (Team & settings → The Floor) shows every desk and app UnBusy runs: jobs today, this week and in total, typical time, who uses it (initials), failures, the morning self-test, and a live feed. Staff only.

## How numbers get here

| App | How | Where |
| --- | --- | --- |
| Job Paperwork (Ireland) | **Pulled** when the Floor opens: the portal asks the app's `/api/floor` for what's new and stores it | `lib/floor-pull.ts`; app side `lib/collect/floor.ts`, `app/api/floor/route.ts` in quote-desk |
| The company | Read from `company_runs` | `app/admin/floor/page.tsx` |
| Future apps | Pulled the same way, or pushed to `POST /api/floor/events` (Bearer `FLOOR_INGEST_SECRET`) | `app/api/floor/events/route.ts` |

Pulling instead of pushing means a client's app never waits on the portal, and nothing runs (or wakes the database) while nobody is looking. Each pull asks only for events from a day before the newest one stored, gives up after 4 seconds and falls back to what's stored. Events are de-duplicated by app and id.

## What may leave a client's app

Counts and labels only: event id, time, job/self-test, done/stopped/error, seconds, staff initials, county, job type, documents found / one-click / missed, failed self-test counties. Never an address, lot, job number, name, email or document. The portal's schema (`floorEvent` in `lib/floor.ts`) rejects unknown fields, ids that could carry an email, and times in the future.

## Hours saved

Shown only when both measured numbers are set on the app in `lib/floor.ts`: `baselineMinutes` (the job by hand) and `withDeskMinutes` (staff time with the desk). Until a timing study sets them, the page says "Not measured yet".

## Settings

| Where | Variable |
| --- | --- |
| Portal (Vercel) | `FLOOR_PULL_SECRET`, `FLOOR_JOB_PAPERWORK_URL` (the app's `/irelandsurveying/api/floor`), optional `FLOOR_INGEST_SECRET` |
| Job Paperwork (Cloud Run, project ireland-512514) | `FLOOR_PULL_SECRET` from Secret Manager secret `floor-pull-secret` |

The page refreshes every 2 minutes while the tab is visible and someone has used it in the last 30 minutes.
