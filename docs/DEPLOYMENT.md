# Shared portal source and deployment

The shared source repository is `skox-software/portal`. Both maintainers should fetch and pull `main` before starting new work; keep feature work on separate branches and merge reviewed changes through pull requests.

## Recovered production baseline

On October 17, 2026, the source files from the active Vercel production deployment `dpl_GNHzEhCzbpo7ZFfK8pnxR6vCufSr` were recovered into this repository. That deployment was created on October 16 through the Vercel CLI, outside GitHub. The project is `skox-client-portal`, owned by the `skox` team. The publishing account is `founders@skoxsoftware.com` (plural).

The application is mounted at `/portal`. The marketing site forwards those requests to this project. Its public address is `https://www.skoxsoftware.com/portal`; the project also owns `portal.skoxsoftware.com`.

The recovered version includes the existing admin sidebar, overview, pipeline, client directory, inbox, billing, requests, activity, settings, and Stripe payment work. Older CRM files absent from the deployed version were removed from the current tree; their history remains in Git.

No production database migration is required merely to synchronize this source snapshot. Do not replay the older, divergent CRM migration history against the live database. Database changes must be reviewed against the current deployed schema and migration journal.

## Verification and release

Run `npm install --no-audit --no-fund`, `npm test`, `npm run lint`, and `npm run build`. CI runs the same checks without production secrets.

Before any release, confirm the Vercel account, team, project, and source commit. Deploy from a clean committed checkout. Test a preview before promoting production. Keep credentials and environment files outside Git.

The role restrictions, employee invitations and assigned sales workspaces requested on October 17 are a separate change from this source recovery. The earlier implementation in the older local checkout must be adapted to this version's pipeline and billing schema before release.
