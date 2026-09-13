/** Google owns durations and availability; these are the initial schedule labels. */
export const MEETING_TYPES = [
  { id: "kickoff", title: "Kickoff", duration: "45 minutes", description: "Confirm the plan, walk through your goals, and set the launch date together.", setting: "schedulingUrl" },
  { id: "review", title: "Project review", duration: "30 minutes", description: "Review progress, share feedback, and agree on the next steps.", setting: "projectReviewSchedulingUrl" },
  { id: "check-in", title: "Check-in", duration: "15 minutes", description: "Talk through a question or get a quick project update.", setting: "checkInSchedulingUrl" },
] as const;

export type MeetingType = (typeof MEETING_TYPES)[number]["id"];

export function meetingType(value: unknown): MeetingType {
  return MEETING_TYPES.find((meeting) => meeting.id === value)?.id ?? "kickoff";
}

/** External legacy links may be opened, but never embedded. */
export function safeBookingUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Only canonical Google appointment pages can become frame sources. */
export function googleBookingEmbedUrl(value: string | null | undefined): string | null {
  const safe = safeBookingUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.hostname !== "calendar.google.com" || url.port ||
      !/^\/calendar\/appointments\/schedules\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null;
  // Discard arbitrary query parameters and fragments; never propagate identity or redirects.
  return `${url.origin}${url.pathname}?gv=true`;
}
