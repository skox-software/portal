import { getAuth } from "@/lib/auth/server";

type AuthError = { code?: string; message?: string; status?: number } | null | undefined;

/** True when Neon Auth says the account already exists. */
function isAlreadyExists(error: AuthError) {
  if (!error) return false;
  return (
    error.status === 422 ||
    /already.?exists/i.test(error.code ?? "") ||
    /already exists/i.test(error.message ?? "")
  );
}

export function isUserNotFound(error: AuthError) {
  return Boolean(error) && (error?.code === "user_not_found" || error?.status === 404);
}

/**
 * Makes sure a sign-in account exists for an invited email, so their first
 * magic link works. Magic links in this Neon Auth project only go to existing
 * accounts, which also stops strangers creating accounts from the sign-in page.
 *
 * The account has no password: people always sign in by magic link. Creating
 * it requires the caller to hold Neon Auth's admin role (the SKOX team does).
 */
export async function ensureAuthAccount(email: string) {
  const { error } = await getAuth().admin.createUser({ email, name: email });
  if (!error || isAlreadyExists(error)) return { ok: true as const };
  console.error("[accounts] could not create sign-in account", { email, error });
  return { ok: false as const };
}
