/**
 * Pure permission rules, kept free of framework and database imports so they
 * can be tested directly (lib/permissions.test.ts). The matrix mirrors the
 * "Who uses it" table in the blueprint.
 */

export const PORTAL_ROLES = [
  "staff_owner",
  "staff",
  "client_approver",
  "client_member",
  "rep",
] as const;
export type PortalRole = (typeof PORTAL_ROLES)[number];
export type ClientRole = Extract<PortalRole, "client_approver" | "client_member">;

export type MembershipLike = {
  workspaceId: string;
  clientId: string | null;
  role: PortalRole;
};

export type ProjectAccess = {
  isStaff: boolean;
  clientRole: ClientRole | null;
};

export const STAFF_ROLES = ["staff_owner", "staff"] as const satisfies readonly PortalRole[];

export function isStaffRole(role: PortalRole) {
  return role === "staff_owner" || role === "staff";
}

export function isClientRole(role: PortalRole): role is ClientRole {
  return role === "client_approver" || role === "client_member";
}

/** Outside sales reps. Never staff, never a client: they see leads and earnings only. */
export function isRepRole(role: PortalRole) {
  return role === "rep";
}

/** The rep membership for a workspace, if the person is a sales rep. */
export function repMembershipIn<T extends MembershipLike>(memberships: T[], workspaceId?: string) {
  return memberships.find(
    (m) =>
      m.clientId === null &&
      isRepRole(m.role) &&
      (workspaceId === undefined || m.workspaceId === workspaceId),
  );
}

/** Approving and paying commission statements is the workspace owner's alone. */
export function canApproveCommissions(role: PortalRole) {
  return role === "staff_owner";
}

/** Rates are whole basis points from 10% to 20%. */
export const REP_RATE_MIN_BPS = 1000;
export const REP_RATE_MAX_BPS = 2000;
export function isValidRepRate(bps: number) {
  return Number.isInteger(bps) && bps >= REP_RATE_MIN_BPS && bps <= REP_RATE_MAX_BPS;
}

/**
 * A partner share is a commission profile on a staff membership (Reiss's 50%
 * on what he closes). It rides the same ledger as a rep, so only the cap
 * differs: staff may go from 10% up to 50%. Clients never earn.
 */
export const PARTNER_RATE_MAX_BPS = 5000;
export function isValidRateFor(role: PortalRole, bps: number) {
  if (isRepRole(role)) return isValidRepRate(bps);
  if (isStaffRole(role)) return Number.isInteger(bps) && bps >= REP_RATE_MIN_BPS && bps <= PARTNER_RATE_MAX_BPS;
  return false;
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

/** The staff membership for a workspace, if the person is on the SKOX team. */
export function staffMembershipIn<T extends MembershipLike>(
  memberships: T[],
  workspaceId?: string,
) {
  return memberships.find(
    (m) =>
      m.clientId === null &&
      isStaffRole(m.role) &&
      (workspaceId === undefined || m.workspaceId === workspaceId),
  );
}

/**
 * What someone may do on one project. Staff need a staff membership in the
 * project's workspace; clients need a client membership for the project's
 * client. A staff role attached to a client row grants nothing.
 */
export function accessToProject(
  memberships: MembershipLike[],
  project: { workspaceId: string; clientId: string },
): ProjectAccess | null {
  const isStaff = Boolean(staffMembershipIn(memberships, project.workspaceId));
  const client = memberships.find(
    (m) =>
      m.workspaceId === project.workspaceId &&
      m.clientId === project.clientId &&
      isClientRole(m.role),
  );
  if (!isStaff && !client) return null;
  return { isStaff, clientRole: client ? (client.role as ClientRole) : null };
}

export const can = {
  viewProject: (a: ProjectAccess) => a.isStaff || a.clientRole !== null,
  leaveFeedback: (a: ProjectAccess) => a.isStaff || a.clientRole !== null,
  approve: (a: ProjectAccess) => a.clientRole === "client_approver",
  inviteTeammates: (a: ProjectAccess) => a.isStaff || a.clientRole === "client_approver",
  manageProject: (a: ProjectAccess) => a.isStaff,
  uploadFiles: (a: ProjectAccess) => a.isStaff || a.clientRole !== null,
  requestSupport: (a: ProjectAccess) => a.clientRole !== null,
  respondToIdeas: (a: ProjectAccess) => a.clientRole !== null,
  /** Approvers can share read-only status with their boss or board. */
  createShareLink: (a: ProjectAccess) => a.isStaff || a.clientRole === "client_approver",
  seeBilling: (a: ProjectAccess) => a.isStaff || a.clientRole !== null,
};

/**
 * Only the named signer may sign, only while the document is out for
 * signature, and only once. Staff can see every document but cannot sign on a
 * client's behalf.
 */
export function canSign(
  viewerEmail: string,
  document: { status: "out_for_signature" | "completed" | "void" },
  signer: { email: string; status: "pending" | "viewed" | "signed" } | undefined,
) {
  return (
    document.status === "out_for_signature" &&
    signer !== undefined &&
    signer.status !== "signed" &&
    normalizeEmail(signer.email) === normalizeEmail(viewerEmail)
  );
}

/** Client-side invitations can only ever grant client roles. */
export function canInviteRole(inviter: ProjectAccess, role: PortalRole) {
  if (!isClientRole(role)) return false;
  return can.inviteTeammates(inviter);
}
