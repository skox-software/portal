"use server";

import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { memberships } from "@/lib/db/schema";
import { normalizeEmail } from "@/lib/permissions";
import { requestFingerprint } from "@/lib/project-access";
import { allow } from "@/lib/rate-limit";

export type SignInState =
  | { step: "email"; error?: string }
  | { step: "code"; email: string; error?: string; resent?: boolean };

const WINDOW = 15 * 60_000;
const SLOW_DOWN = "Too many attempts. Wait a few minutes and try again.";

/**
 * Two steps on one action: email a 6-digit code, then trade the code for a
 * session. The portal is invite-only, so codes only go to invited addresses
 * (everyone else sees the same "code sent" screen), and requests are throttled
 * per email and per IP so the form can't be used to spam inboxes.
 */
export async function signInWithCode(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const intent = String(formData.get("intent") ?? "send");
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!z.email().safeParse(email).success) {
    return { step: "email", error: "Enter the email address we invited." };
  }
  const { ip } = await requestFingerprint();

  if (intent === "send" || intent === "resend") {
    if (!(await allow(`otp:ip:${ip ?? "unknown"}`, 20, WINDOW)) || !(await allow(`otp:email:${email}`, 5, WINDOW))) {
      return { step: "email", error: SLOW_DOWN };
    }
    const [invited] = await getDb()
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.email, email))
      .limit(1);
    if (invited) {
      const { error } = await getAuth().emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      if (error) {
        console.error("[sign-in] code could not be sent", error);
        return { step: "email", error: "We couldn't send a code just now. Try again in a minute." };
      }
    }
    return { step: "code", email, resent: intent === "resend" };
  }

  if (!(await allow(`otp-verify:email:${email}`, 10, WINDOW))) {
    return { step: "code", email, error: SLOW_DOWN };
  }
  const otp = String(formData.get("otp") ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(otp)) {
    return { step: "code", email, error: "Enter the 6-digit code from the email." };
  }
  const { error } = await getAuth().signIn.emailOtp({ email, otp });
  if (error) {
    const expired = /expired/i.test(`${error.code ?? ""} ${error.message ?? ""}`);
    return {
      step: "code",
      email,
      error: expired
        ? "That code has expired. Send a new one."
        : "That code doesn't match. Check the latest email and try again.",
    };
  }

  // Proving the inbox makes this person the account's owner. Remove anything
  // someone else could have attached to the address beforehand: a password
  // and any older sessions.
  try {
    await getDb().execute(sql`
      with u as (select id from neon_auth."user" where lower(email) = ${email} limit 1)
      delete from neon_auth.account where "userId" in (select id from u) and "providerId" = 'credential'`);
    await getDb().execute(sql`
      with u as (select id from neon_auth."user" where lower(email) = ${email} limit 1)
      delete from neon_auth.session where "userId" in (select id from u) and "createdAt" < now() - interval '60 seconds'`);
  } catch (cleanupError) {
    console.error("[sign-in] could not tidy other credentials", cleanupError);
  }
  redirect("/");
}
