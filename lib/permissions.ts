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

export function isStaffRole(role: PortalRole) {
  return role === "staff_owner" || role === "staff";
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
      !isStaffRole(m.role),
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
};

/** Client-side invitations can only ever grant client roles. */
export function canInviteRole(inviter: ProjectAccess, role: PortalRole) {
  if (isStaffRole(role)) return false;
  return can.inviteTeammates(inviter);
}
