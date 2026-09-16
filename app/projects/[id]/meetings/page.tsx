import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { BookingEmbed } from "@/components/BookingEmbed";
import { ProjectHeader } from "@/components/ProjectHeader";
import { getDb } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { MEETING_TYPES, meetingType, safeBookingUrl } from "@/lib/meetings";
import { loadProjectShell } from "@/lib/project-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Meetings" };

export default async function MeetingsPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const shell = await loadProjectShell(id);
  const { project, client } = shell;
  const [workspace] = await getDb().select().from(workspaces).where(eq(workspaces.id, project.workspaceId)).limit(1);
  const selected = MEETING_TYPES.find((meeting) => meeting.id === meetingType(sp.type))!;
  const bookingUrl = safeBookingUrl(workspace?.[selected.setting]);
  return (
    <>
      <ProjectHeader shell={shell} tab="meetings" title="Meetings" intro="A little time together, whenever you need it. Choose a meeting and find a time that works for you." />
      <main className="shell page page-after-band">
        <nav className="meeting-choices" aria-label="Meeting type">
          {MEETING_TYPES.map((meeting) => (
            <Link key={meeting.id} className="meeting-choice" href={`/projects/${project.id}/meetings?type=${meeting.id}`} aria-current={selected.id === meeting.id ? "page" : undefined} scroll={false}>
              <strong>{meeting.title}</strong>
              <span className="small muted">{meeting.duration}</span>
              <span className="small">{meeting.description}</span>
            </Link>
          ))}
        </nav>
        <section className="card meeting-card" aria-labelledby="meeting-title">
          <div className="card-head"><h2 id="meeting-title">{selected.title}</h2></div>
          {bookingUrl && <p className="small muted meeting-context">Booking for <strong>{client.name} · {project.name}</strong>. Use your project email address and check the time zone before confirming.</p>}
          <BookingEmbed key={selected.id} url={bookingUrl} title={selected.title} projectId={project.id} />
        </section>
      </main>
    </>
  );
}
