import type { MembershipLike } from "./permissions.ts";
export const OUTREACH_STAGES = ["lead", "initial_outreach", "follow_up_2", "follow_up_3", "persistent_follow_up", "lost"] as const;
export const OPPORTUNITY_STAGES = ["proposal_sent", "negotiation", "won", "in_build", "shipped"] as const;
export function canAccessSalesDeal(member: MembershipLike & { email: string }, deal: { workspaceId: string; ownerEmail: string | null }) {
  return !member.revokedAt && member.clientId === null && member.workspaceId === deal.workspaceId &&
    (member.role === "staff_owner" || (member.role === "staff" && member.email === deal.ownerEmail));
}
export function canChangeSalesDeal(member: MembershipLike & { email: string }, deal: { workspaceId: string; ownerEmail: string | null; stage: string; projectId: string | null }) {
  return canAccessSalesDeal(member, deal) && !deal.projectId && (member.role === "staff_owner" || deal.stage !== "won");
}
