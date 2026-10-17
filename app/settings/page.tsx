import { eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { Notice, readMessage } from "@/components/Notice";
import { TopBar } from "@/components/TopBar";
import { requireViewer } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import { ROLE_LABEL } from "@/lib/format";
import { saveEmailPreferences } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Email preferences" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const viewer = await requireViewer();
  const clientIds = viewer.memberships.flatMap((m) => (m.clientId ? [m.clientId] : []));
  const names = clientIds.length
    ? await getDb().select({ id: clients.id, name: clients.name }).from(clients).where(inArray(clients.id, clientIds))
    : [];
  const nameOf = new Map(names.map((c) => [c.id, c.name]));
  void eq;

  return (
    <>
      <TopBar viewer={viewer} />
      <main className="shell page" style={{ maxWidth: 720 }}>
        <div className="page-head">
          <div>
            <p className="eyebrow">Your account</p>
            <h1>Email preferences</h1>
            <p className="page-intro">Signed in as {viewer.email}. Anything that needs your action (a signature, an approval, an invoice) always reaches you.</p>
          </div>
        </div>
        <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />
        <form action={saveEmailPreferences} className="card stack">
          {viewer.memberships.length === 0 ? (
            <p className="muted">You don&apos;t have access to any projects yet.</p>
          ) : (
            viewer.memberships.map((m) => (
              <label key={m.id} className="check" style={{ padding: "6px 0" }}>
                <input type="checkbox" name="emailUpdates" value={m.id} defaultChecked={m.emailUpdates} />
                <span>
                  <strong style={{ fontWeight: 500 }}>{m.clientId ? nameOf.get(m.clientId) ?? "Client" : "SKOX team"}</strong>
                  <span className="muted small"> · {ROLE_LABEL[m.role]}</span>
                  <br />
                  <span className="small muted">
                    Progress updates, new files, ideas and the Friday recap. Untick to only get emails that need you to act.
                  </span>
                </span>
              </label>
            ))
          )}
          <div>
            <button className="btn btn-primary" type="submit">
              Save preferences
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
