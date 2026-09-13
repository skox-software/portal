import Link from "next/link";
import { googleBookingEmbedUrl, safeBookingUrl } from "@/lib/meetings";

export function BookingEmbed({ url, title, projectId }: { url?: string | null; title: string; projectId: string }) {
  const href = safeBookingUrl(url);
  const src = googleBookingEmbedUrl(url);
  if (!href) {
    return (
      <div className="booking-unavailable stack">
        <p>Online scheduling for this meeting is not available yet.</p>
        <p className="small muted">Send us a request with a few times that work for you and we&apos;ll arrange it together.</p>
        <p><Link className="btn btn-ghost" href={`/projects/${projectId}/support`}>Request a meeting</Link></p>
      </div>
    );
  }
  return (
    <div className="booking stack">
      <div className="booking-toolbar">
        <p className="small muted">
          {src ? "Choose a time below. Meeting details and booking-management options arrive in Google’s confirmation email." : "Use our booking page to choose a time and follow the confirmation email to manage your meeting."}
        </p>
        <a className="btn btn-ghost btn-small" href={href} target="_blank" rel="noopener noreferrer">Open booking page ↗</a>
      </div>
      {src && (
        <iframe className="booking-frame" src={src} title={`${title} appointment booking`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
      )}
      {src && <p className="small muted">If the booking page doesn&apos;t load, use “Open booking page” above. Check the time zone shown before confirming.</p>}
    </div>
  );
}
