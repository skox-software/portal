import { initials } from "@/lib/pipeline";

/** A teammate's initials in the round avatar the Clients list uses; "Team" when nobody owns it. */
export function Owner({ email }: { email: string | null }) {
  if (!email) return <span className="crm-owner ov-owner-team" title="Team">T</span>;
  const label = initials(email);
  return (
    <span className="crm-owner" title={email} data-tone={label.charCodeAt(0) % 2 ? "amber" : "ink"}>
      {label}
    </span>
  );
}
