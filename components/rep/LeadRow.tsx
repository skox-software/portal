import Link from "next/link";
import { Dial } from "@/components/rep/Dial";
import { RepTrack } from "@/components/rep/RepTrack";
import { formatDate } from "@/lib/format";
import { followUpState } from "@/lib/follow-up";
import type { RepLead } from "@/lib/rep-data";
import { repCanWork } from "@/lib/rep-status";

export function LeadRow({ lead, today }: { lead: RepLead; today: string }) {
  const state = followUpState(lead.nextStepOn, today);
  const due = !repCanWork(lead.status)
    ? null
    : state === "overdue" ? `Overdue · ${formatDate(lead.nextStepOn)}`
    : state === "today" ? "Call today"
    : state === "upcoming" ? `Next ${formatDate(lead.nextStepOn)}`
    : lead.lastContactedAt ? null : "Not called yet";
  const sub = [lead.contactName, lead.industry, lead.location].filter(Boolean).join(" · ") || lead.phone || lead.contactEmail || "No contact yet";
  return (
    <li className="rp-lead">
      <div className="rp-lead-row">
        <Link href={`/rep/leads/${lead.id}`} className="rp-lead-name">
          <strong>{lead.company}</strong>
          <small>{sub}</small>
        </Link>
        <RepTrack status={lead.status} mini />
        <span className="rp-due" data-state={due === "Not called yet" ? "today" : state}>{due ?? ""}</span>
        {repCanWork(lead.status) ? <Dial phone={lead.phone} email={lead.contactEmail} name={lead.company} bookHref={`/rep/leads/${lead.id}#book`} /> : <span className="rp-dial" />}
      </div>
    </li>
  );
}
