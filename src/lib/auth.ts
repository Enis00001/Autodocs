import { supabase } from "@/lib/supabase";

export type SignupPlan = "monthly" | "annual" | null;

export function getSignupEmailRedirectTo(plan: SignupPlan = null): string {
  const redirectUrl = new URL(plan ? "/abonnement" : "/app", window.location.origin);
  if (plan) redirectUrl.searchParams.set("plan", plan);
  return redirectUrl.toString();
}

export async function getCurrentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error("getCurrentUserId:", error);
    return null;
  }
  return data.user?.id ?? null;
}

