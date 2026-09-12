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

/**
 * Makes sure a sign-in account exists for an invited email before they first
 * sign in. Signing in with an emailed code would also create it; doing it at
 * invite time surfaces auth problems to SKOX instead of to the client.
 *
 * The account has no password: people always sign in with an emailed code.
 * Creating it requires the caller to hold Neon Auth's admin role (SKOX does).
 */
export async function ensureAuthAccount(email: string) {
  const { error } = await getAuth().admin.createUser({ email, name: email });
  if (!error || isAlreadyExists(error)) return { ok: true as const };
  console.error("[accounts] could not create sign-in account", { email, error });
  return { ok: false as const };
}
