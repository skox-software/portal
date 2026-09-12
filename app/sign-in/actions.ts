"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/lib/auth/server";
import { normalizeEmail } from "@/lib/permissions";

export type SignInState =
  | { step: "email"; error?: string }
  | { step: "code"; email: string; error?: string; resent?: boolean };

/**
 * Two steps on one action: email a 6-digit code, then trade the code for a
 * session. Codes (not magic links) because Neon Auth's magic-link plugin is
 * off in this project, and a code also works when the email is opened on a
 * different device from the one signing in.
 */
export async function signInWithCode(
  previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const intent = String(formData.get("intent") ?? "send");
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!z.email().safeParse(email).success) {
    return { step: "email", error: "Enter the email address we invited." };
  }

  if (intent === "send" || intent === "resend") {
    const { error } = await getAuth().emailOtp.sendVerificationOtp({ email, type: "sign-in" });
    if (error) {
      console.error("[sign-in] code could not be sent", error);
      return { step: "email", error: "We couldn't send a code just now. Try again in a minute." };
    }
    return { step: "code", email, resent: intent === "resend" };
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
  redirect("/");
}
