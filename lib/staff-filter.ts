import { and, eq, inArray, isNull } from "drizzle-orm";
import { memberships } from "@/lib/db/schema";
import { STAFF_ROLES } from "@/lib/permissions";

/**
 * SQL for "this membership row is SKOX staff". A null client alone is not
 * enough: sales reps have no client either, and must never pass for staff
 * (deal owners, inbox matching, document signers, staff emails).
 */
export const staffRow = () => and(isNull(memberships.clientId), inArray(memberships.role, [...STAFF_ROLES]));

/** Staff rows of one workspace. */
export const staffOf = (workspaceId: string) => and(eq(memberships.workspaceId, workspaceId), staffRow());
