import type { Metadata } from "next";
import { InboxThreads } from "@/components/InboxThreads";
import { Notice, readMessage } from "@/components/Notice";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inbox" };

export default async function Inbox({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { viewer, staff } = await requireStaff();
  return (
    <>
      <TopBar viewer={viewer} current="inbox" />
      <main className="shell page" style={{ width: "min(1320px, calc(100% - 48px))" }}>
        <div className="page-head">
          <div>
            <p className="eyebrow">Email</p>
            <h1>Inbox</h1>
          </div>
        </div>
        <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />
        <div className="inbox-layout">
          <InboxThreads workspaceId={staff.workspaceId} />
          <p className="empty">Pick a thread. Anything under “Needs a client” is waiting to be filed.</p>
        </div>
      </main>
    </>
  );
}
