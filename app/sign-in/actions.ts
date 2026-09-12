"use server";

import { z } from "zod";
import { getAuth } from "@/lib/auth/server";
import { portalOrigin } from "@/lib/http";
import { normalizeEmail } from "@/lib/permissions";

export type SignInState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

export async function sendMagicLink(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!z.email().safeParse(email).success) {
    return { status: "error", message: "Enter the email address we invited." };
  }

  const origin = await portalOrigin();
  const { error } = await getAuth().signIn.magicLink({
    email,
    callbackURL: `${origin}/`,
  });

  if (error) {
    console.error("[sign-in] magic link could not be sent", error);
    return {
      status: "error",
      message: "We couldn't send a sign-in link just now. Try again in a minute.",
    };
  }
  return { status: "sent", email };
}
